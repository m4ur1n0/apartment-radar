import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "../index";
import { runScheduledCrawler } from "../crawler/scheduledCrawler";

// mock search targets so scheduled crawler tests don't trigger real network calls
vi.mock("../crawler/searchTargets", () => ({
  SEARCH_TARGETS: [],
  ENABLED_SEARCH_TARGETS: [],
}));

afterEach(() => { vi.restoreAllMocks(); });

const ADMIN_TOKEN = "test-token";

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
      runLog.push({ sql: this.sql, args: this.bound });
      return (firstQueue.shift() ?? null) as T | null;
    }
    async run() {
      runLog.push({ sql: this.sql, args: this.bound });
      return { success: true, results: [], meta: { changes: 1, last_row_id: 1 } };
    }
    async all<T = Record<string, unknown>>() {
      runLog.push({ sql: this.sql, args: this.bound });
      const results = (allQueue.shift() ?? []) as T[];
      return { results };
    }
    getSql() { return this.sql; }
  }

  const db = {
    prepare: (sql: string) => new MockStmt(sql),
    batch: async (stmts: MockStmt[]) => {
      for (const s of stmts) runLog.push({ sql: s.getSql(), args: [] });
      return { results: stmts.map(() => ({ results: [] })) };
    },
  } as unknown as D1Database;
  return { db, runLog };
}

// --- crawler status ---

describe("GET /admin/crawler/status", () => {
  it("returns crawlerEnabled=true when setting is 'true'", async () => {
    const { db } = makeMockD1({
      firstResponses: [{ value: "true" }],
      allResponses: [[], []],
    });

    const res = await app.request("/admin/crawler/status", {
      method: "GET",
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.crawlerEnabled).toBe(true);
  });

  it("returns crawlerEnabled=false when setting is 'false'", async () => {
    const { db } = makeMockD1({
      firstResponses: [{ value: "false" }],
      allResponses: [[], []],
    });

    const res = await app.request("/admin/crawler/status", {
      method: "GET",
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });

    const body = await res.json() as Record<string, unknown>;
    expect(body.crawlerEnabled).toBe(false);
  });

  it("requires admin token", async () => {
    const { db } = makeMockD1();
    const res = await app.request("/admin/crawler/status", {
      method: "GET",
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(res.status).toBe(401);
  });

  it("returns pending and failed job counts", async () => {
    const { db } = makeMockD1({
      firstResponses: [{ value: "true" }],
      allResponses: [
        [
          { source: "zillow", status: "pending", count: 7 },
          { source: "zillow", status: "failed", count: 2 },
        ],
        [],
      ],
    });

    const res = await app.request("/admin/crawler/status", {
      method: "GET",
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });

    const body = await res.json() as Record<string, unknown>;
    expect(body.pendingImportJobs).toBe(7);
    expect(body.failedImportJobs).toBe(2);
  });
});

// --- pause ---

describe("POST /admin/crawler/pause", () => {
  it("sets crawler_enabled to false in DB", async () => {
    const { db, runLog } = makeMockD1();

    const res = await app.request("/admin/crawler/pause", {
      method: "POST",
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.crawlerEnabled).toBe(false);
    const upsert = runLog.find((r) => r.sql.includes("app_settings") && r.sql.includes("crawler_enabled"));
    expect(upsert).toBeDefined();
    expect(upsert?.sql).toContain("'false'");
  });
});

// --- resume ---

describe("POST /admin/crawler/resume", () => {
  it("sets crawler_enabled to true in DB", async () => {
    const { db, runLog } = makeMockD1();

    const res = await app.request("/admin/crawler/resume", {
      method: "POST",
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.crawlerEnabled).toBe(true);
    const upsert = runLog.find((r) => r.sql.includes("app_settings") && r.sql.includes("crawler_enabled"));
    expect(upsert?.sql).toContain("'true'");
  });
});

// --- scheduled crawler respects pause ---

describe("runScheduledCrawler pause behavior", () => {
  it("skips when mode=scheduled and crawler_enabled=false", async () => {
    const { db } = makeMockD1({
      firstResponses: [{ value: "false" }],
    });

    const result = await runScheduledCrawler(
      { DB: db },
      undefined,
      { mode: "scheduled", dryRun: false }
    );

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("crawler_paused");
    expect(result.dueTargetsSelected).toBe(0);
  });

  it("does NOT skip when mode=manual even if crawler_enabled is not checked", async () => {
    // manual mode never reads crawler_enabled; it always proceeds
    const { db } = makeMockD1({
      allResponses: [[], []],
    });

    const result = await runScheduledCrawler(
      { DB: db },
      undefined,
      { mode: "manual", dryRun: false }
    );

    expect(result.skipped).toBeFalsy();
  });

  it("does NOT skip when mode=scheduled and crawler_enabled=true", async () => {
    const { db } = makeMockD1({
      firstResponses: [{ value: "true" }],
      allResponses: [[], []],
    });

    const result = await runScheduledCrawler(
      { DB: db },
      undefined,
      { mode: "scheduled", dryRun: false }
    );

    expect(result.skipped).toBeFalsy();
  });

  it("dryRun skips crawler_enabled check and returns immediately", async () => {
    const { db } = makeMockD1({
      allResponses: [[]],
    });

    const result = await runScheduledCrawler(
      { DB: db },
      undefined,
      { mode: "scheduled", dryRun: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.skipped).toBeFalsy();
  });
});
