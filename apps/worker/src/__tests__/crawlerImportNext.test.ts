import { describe, it, expect, vi, afterEach } from "vitest";
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

async function callImportNext(body: unknown, db: D1Database) {
  return app.request(
    "/admin/crawler/import-next",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
      body: JSON.stringify(body),
    },
    { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
  );
}

const PENDING_JOB_ROW = {
  id: "job-001",
  source: "nooklyn",
  discovered_url_id: "disc-001",
  listing_url: "https://nooklyn.com/listings/test-listing-bushwick",
  canonical_url: "https://nooklyn.com/listings/test-listing-bushwick",
  source_listing_id: "10001",
  status: "pending",
  priority: 0,
  attempt_count: 0,
  max_attempts: 3,
  last_error: null,
  locked_at: null,
  locked_by: null,
  next_attempt_at: null,
  started_at: null,
  completed_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// --- validation ---

describe("POST /admin/crawler/import-next — validation", () => {
  it("rejects wrong admin token", async () => {
    const { db } = makeMockD1();
    const res = await app.request(
      "/admin/crawler/import-next",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Token": "wrong" },
        body: JSON.stringify({}),
      },
      { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
    );
    expect(res.status).toBe(401);
  });

  it("rejects limit > 5", async () => {
    const { db } = makeMockD1();
    const res = await callImportNext({ limit: 6 }, db);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("validation failed");
  });
});

// --- dryRun: true ---

describe("POST /admin/crawler/import-next — dryRun: true", () => {
  it("returns pending jobs without locking or processing", async () => {
    const { db, runLog } = makeMockD1({
      allResponses: [[PENDING_JOB_ROW]],
    });
    const res = await callImportNext({ dryRun: true }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean; dryRun: boolean; selectedJobs: number; processedJobs: number; results: { status: string }[];
    };
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.selectedJobs).toBe(1);
    expect(json.processedJobs).toBe(0);
    expect(json.results[0].status).toBe("pending");
    // no UPDATE runs (no locking)
    expect(runLog.filter((r) => r.sql.includes("update crawl_import_jobs"))).toHaveLength(0);
  });

  it("defaults to dryRun: true when omitted", async () => {
    const { db, runLog } = makeMockD1({ allResponses: [[PENDING_JOB_ROW]] });
    const res = await callImportNext({}, db);
    expect(res.status).toBe(200);
    const json = await res.json() as { dryRun: boolean };
    expect(json.dryRun).toBe(true);
    expect(runLog.filter((r) => r.sql.includes("update"))).toHaveLength(0);
  });

  it("returns zero jobs when queue is empty", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callImportNext({ dryRun: true }, db);
    const json = await res.json() as { selectedJobs: number };
    expect(json.selectedJobs).toBe(0);
  });
});

// --- dryRun: false ---

describe("POST /admin/crawler/import-next — dryRun: false", () => {
  it("claims and processes pending jobs using existing import path", async () => {
    // mock nooklyn detail API (the existing importPreview → fetchNooklynApi path)
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("nooklyn.com/api/v2/listings.fetch")) {
        return {
          ok: true, status: 200,
          headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
          json: async () => ({
            listing: {
              id: 10001, price: 280000, bedrooms: 2, bathrooms: 1,
              neighborhood: { name: "Bushwick" },
              address: "123 Test St Brooklyn NY",
              latitude: 40.6937, longitude: -73.9208,
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => [] };
    }));

    const { db, runLog } = makeMockD1({
      // claim: allResponses[0] = the pending job for SELECT
      // after claim UPDATE, process runs:
      //   first() calls: hidden_at check (null = new/not hidden), then select id after upsert
      allResponses: [[PENDING_JOB_ROW]],
      firstResponses: [null, { id: "listing-uuid-001" }],
    });

    const res = await callImportNext({ dryRun: false, limit: 1 }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean; dryRun: boolean; selectedJobs: number; processedJobs: number; succeeded: number;
      results: Array<{ status: string; listingId?: string }>;
    };
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(false);
    expect(json.selectedJobs).toBe(1);
    expect(json.processedJobs).toBe(1);
    expect(json.succeeded).toBe(1);
    expect(json.results[0].status).toBe("succeeded");
    expect(json.results[0].listingId).toBe("listing-uuid-001");

    // verify existing import path was used (listing inserted)
    expect(runLog.some((r) => r.sql.includes("insert into listings"))).toBe(true);
    // verify job was marked succeeded
    expect(runLog.some((r) => r.sql.includes("update crawl_import_jobs") && r.sql.includes("'succeeded'"))).toBe(true);
    // verify discovered URL was marked imported
    expect(runLog.some((r) => r.sql.includes("update crawl_discovered_urls") && r.sql.includes("'imported'"))).toBe(true);
    // verify no scheduler/cron added (nothing unrelated)
    expect(runLog.filter((r) => r.sql.includes("cron"))).toHaveLength(0);
  });

  it("returns failed status when import fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ listing: { id: 10002 } }), // no price/beds/baths
    })));

    const { db } = makeMockD1({
      allResponses: [[PENDING_JOB_ROW]],
    });

    const res = await callImportNext({ dryRun: false, limit: 1 }, db);
    const json = await res.json() as { succeeded: number; failed: number; results: Array<{ status: string; error?: string }> };
    expect(json.succeeded).toBe(0);
    expect(json.failed).toBe(1);
    expect(json.results[0].status).toBe("failed");
    expect(json.results[0].error).toMatch(/required fields missing/);
  });
});

// --- max limit enforcement ---

describe("POST /admin/crawler/import-next — max limit", () => {
  it("enforces max limit of 5", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callImportNext({ limit: 6, dryRun: true }, db);
    expect(res.status).toBe(400);
  });
});
