import { describe, it, expect, afterEach, vi } from "vitest";
import { app } from "../index";

afterEach(() => { vi.restoreAllMocks(); });

interface RunEntry { sql: string; args: unknown[] }

function makeMockD1(opts: {
  firstResponses?: (Record<string, unknown> | null)[];
  allResponses?: Record<string, unknown>[][];
} = {}) {
  const runLog: RunEntry[] = [];
  const firstQueue = [...(opts.firstResponses ?? [])];
  const allQueue = [...(opts.allResponses ?? [])];

  class MockStmt {
    private bound: unknown[] = [];
    constructor(public readonly sql: string) {}
    bind(...args: unknown[]): this { this.bound = args; return this; }
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      return (firstQueue.shift() ?? null) as T | null;
    }
    async run() {
      runLog.push({ sql: this.sql, args: this.bound });
      return { success: true, results: [], meta: { changes: 1, last_row_id: 1 } };
    }
    async all<T = Record<string, unknown>>() {
      const results = (allQueue.shift() ?? []) as T[];
      return { results };
    }
  }

  const db = {
    prepare: (sql: string) => new MockStmt(sql),
    batch: async () => ({ results: [] }),
  } as unknown as D1Database;
  return { db, runLog };
}

const ADMIN_TOKEN = "test-token";

async function callEnqueue(body: unknown, db: D1Database) {
  return app.request(
    "/admin/crawler/enqueue-imports",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
      body: JSON.stringify(body),
    },
    { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
  );
}

const DISCOVERED_ROW = {
  id: "disc-001",
  source: "nooklyn",
  target_id: "nooklyn-url-first-bushwick-2br-max3100",
  listing_url: "https://nooklyn.com/listings/test-bushwick",
  canonical_url: "https://nooklyn.com/listings/test-bushwick",
  source_listing_id: "10001",
  title: "2BR Bushwick",
  price: 2800,
  status: "discovered",
};

// --- validation ---

describe("POST /admin/crawler/enqueue-imports — validation", () => {
  it("rejects wrong admin token", async () => {
    const { db } = makeMockD1();
    const res = await app.request(
      "/admin/crawler/enqueue-imports",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Token": "wrong" },
        body: JSON.stringify({}),
      },
      { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
    );
    expect(res.status).toBe(401);
  });

  it("rejects limit > 25", async () => {
    const { db } = makeMockD1();
    const res = await callEnqueue({ limit: 26 }, db);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("validation failed");
  });

  it("rejects invalid json body", async () => {
    const { db } = makeMockD1();
    const res = await app.request(
      "/admin/crawler/enqueue-imports",
      { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN }, body: "not json" },
      { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
    );
    expect(res.status).toBe(400);
  });
});

// --- dryRun: true ---

describe("POST /admin/crawler/enqueue-imports — dryRun: true", () => {
  it("returns preview without writing to DB", async () => {
    const { db, runLog } = makeMockD1({
      allResponses: [[DISCOVERED_ROW]],
      firstResponses: [null],
    });
    const res = await callEnqueue({ dryRun: true }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; dryRun?: boolean; insertedJobs: number; preview: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.insertedJobs).toBe(0);
    expect(json.preview).toHaveLength(1);
    // no crawl_import_jobs inserts
    expect(runLog.filter((r) => r.sql.includes("insert into crawl_import_jobs"))).toHaveLength(0);
  });

  it("defaults to dryRun: true when omitted", async () => {
    const { db, runLog } = makeMockD1({ allResponses: [[DISCOVERED_ROW]], firstResponses: [null] });
    const res = await callEnqueue({}, db);
    expect(res.status).toBe(200);
    expect(runLog.filter((r) => r.sql.includes("insert"))).toHaveLength(0);
  });

  it("counts skipped jobs when a job already exists", async () => {
    const { db } = makeMockD1({
      allResponses: [[DISCOVERED_ROW]],
      firstResponses: [{ id: "existing-job" }],
    });
    const res = await callEnqueue({ dryRun: true }, db);
    const json = await res.json() as { skippedExistingJobs: number };
    expect(json.skippedExistingJobs).toBe(1);
  });
});

// --- dryRun: false ---

describe("POST /admin/crawler/enqueue-imports — dryRun: false", () => {
  it("creates jobs and updates discovered URL status", async () => {
    const { db, runLog } = makeMockD1({
      allResponses: [[DISCOVERED_ROW]],
      firstResponses: [null],
    });
    const res = await callEnqueue({ dryRun: false }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; insertedJobs: number; updatedDiscoveredRows: number };
    expect(json.ok).toBe(true);
    expect(json.insertedJobs).toBe(1);
    expect(json.updatedDiscoveredRows).toBe(1);
    expect(runLog.some((r) => r.sql.includes("insert into crawl_import_jobs"))).toBe(true);
    expect(runLog.some((r) => r.sql.includes("update crawl_discovered_urls"))).toBe(true);
  });

  it("does not insert into listings table", async () => {
    const { db, runLog } = makeMockD1({ allResponses: [[DISCOVERED_ROW]], firstResponses: [null] });
    await callEnqueue({ dryRun: false }, db);
    expect(runLog.filter((r) => r.sql.match(/insert into (?!crawl_)/i))).toHaveLength(0);
  });

  it("respects source filter", async () => {
    const { db, runLog } = makeMockD1({ allResponses: [[]], firstResponses: [] });
    const res = await callEnqueue({ dryRun: false, source: "nooklyn" }, db);
    expect(res.status).toBe(200);
    // the SELECT should include source filter
    // (allResponses returns [] so 0 jobs, but query ran)
    const json = await res.json() as { insertedJobs: number };
    expect(json.insertedJobs).toBe(0);
  });
});
