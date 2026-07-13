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

const ADMIN_TOKEN = "test-token";

async function callRunOnce(body: unknown, db: D1Database) {
  return app.request(
    "/admin/crawler/run-once",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
      body: JSON.stringify(body),
    },
    { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
  );
}

// --- validation ---

describe("POST /admin/crawler/run-once — validation", () => {
  it("rejects wrong admin token", async () => {
    const { db } = makeMockD1();
    const res = await app.request(
      "/admin/crawler/run-once",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Token": "wrong" },
        body: JSON.stringify({}),
      },
      { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
    );
    expect(res.status).toBe(401);
  });

  it("rejects maxDiscoveryTargets > 3", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({ maxDiscoveryTargets: 4 }, db);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("validation failed");
  });

  it("rejects maxEnqueueJobs > 25", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({ maxEnqueueJobs: 26 }, db);
    expect(res.status).toBe(400);
  });

  it("rejects maxImportJobs > 5", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({ maxImportJobs: 6 }, db);
    expect(res.status).toBe(400);
  });

  it("rejects invalid json body", async () => {
    const { db } = makeMockD1();
    const res = await app.request(
      "/admin/crawler/run-once",
      { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN }, body: "bad" },
      { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
    );
    expect(res.status).toBe(400);
  });
});

// --- dryRun: true ---

describe("POST /admin/crawler/run-once — dryRun: true", () => {
  it("returns structured result with no DB writes", async () => {
    // dryRun: true only queries getDueDiscoveryTargets (one .all() call)
    const { db, runLog } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({ dryRun: true }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean; mode: string; dryRun: boolean;
      dueTargetsSelected: number; discoveryRunsCompleted: number;
      importJobsInserted: number; importJobsProcessed: number;
      durationMs: number; warnings: string[];
    };
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("manual");
    expect(json.dryRun).toBe(true);
    expect(typeof json.dueTargetsSelected).toBe("number");
    expect(typeof json.durationMs).toBe("number");
    expect(Array.isArray(json.warnings)).toBe(true);
    // no writes at all in dry run
    expect(runLog.filter((r) => r.sql.startsWith("insert") || r.sql.startsWith("update"))).toHaveLength(0);
  });

  it("defaults to dryRun: true when omitted", async () => {
    const { db, runLog } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({}, db);
    expect(res.status).toBe(200);
    const json = await res.json() as { dryRun: boolean };
    expect(json.dryRun).toBe(true);
    expect(runLog.filter((r) => r.sql.startsWith("update"))).toHaveLength(0);
  });

  it("returns zero discovery runs when no due targets", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({ dryRun: true }, db);
    const json = await res.json() as { dueTargetsSelected: number; discoveryRunsCompleted: number };
    expect(json.dueTargetsSelected).toBe(0);
    expect(json.discoveryRunsCompleted).toBe(0);
  });
});

// --- dryRun: false ---

describe("POST /admin/crawler/run-once — dryRun: false", () => {
  it("runs discovery + enqueue + import and returns full summary", async () => {
    // mock fetch for nooklyn discovery (the list search API) and detail API
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      // nooklyn list search (POST)
      if (urlStr.includes("nooklyn.com/api/v2/listings.search")) {
        return {
          ok: true, status: 200,
          headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
          json: async () => ({ listings: [] }), // no listings → 0 candidates discovered
        };
      }
      return { ok: false, status: 404, json: async () => [] };
    }));

    // DB responses for the full pipeline:
    // 1. getDueDiscoveryTargets → one due target
    // 2. ensureTargetStateRows → batch (no allResponses needed)
    // 3. getDueDiscoveryTargets again (actual) → one due target
    // 4. createCrawlRun → run()
    // 5. discoverListingUrlsForTarget → fetch (mocked above)
    // 6. upsertDiscoveredCandidates → (0 candidates, no queries)
    // 7. finishCrawlRun → run()
    // 8. markTargetDiscoverySucceeded → run()
    // 9. enqueueImportJobsFromDiscoveredUrls → allResponses (no discovered urls ready)
    // 10. processNextImportJobs → allResponses (no pending jobs)
    const dueTargetRow = {
      target_id: "nooklyn-url-first-bushwick-2br-max3100",
      source: "nooklyn",
      enabled: 1,
      priority: 3,
      last_discovery_at: null,
      next_discovery_at: null,
      last_discovery_status: null,
      last_discovery_run_id: null,
      consecutive_failures: 0,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { db } = makeMockD1({
      allResponses: [
        [dueTargetRow], // getDueDiscoveryTargets
        [],             // enqueueImportJobsFromDiscoveredUrls selected urls
        [],             // processNextImportJobs selected jobs
      ],
      firstResponses: [],
    });

    const res = await callRunOnce({
      dryRun: false,
      maxDiscoveryTargets: 1,
      maxEnqueueJobs: 3,
      maxImportJobs: 1,
    }, db);

    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean; mode: string; dryRun: boolean;
      dueTargetsSelected: number; discoveryRunsCompleted: number; discoveryRunsFailed: number;
      candidatesPersisted: number; importJobsInserted: number;
      importJobsProcessed: number; importJobsSucceeded: number; importJobsFailed: number;
      durationMs: number; warnings: string[];
    };
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("manual");
    expect(json.dryRun).toBe(false);
    expect(json.dueTargetsSelected).toBe(1);
    expect(json.discoveryRunsCompleted).toBe(1);
    expect(json.discoveryRunsFailed).toBe(0);
    expect(typeof json.durationMs).toBe("number");
    expect(Array.isArray(json.warnings)).toBe(true);
  });

  it("continues to next target when one fails (createCrawlRun throws)", async () => {
    const dueTargetRow = {
      target_id: "nooklyn-url-first-bushwick-2br-max3100",
      source: "nooklyn",
      enabled: 1,
      priority: 3,
      last_discovery_at: null,
      next_discovery_at: null,
      last_discovery_status: null,
      last_discovery_run_id: null,
      consecutive_failures: 0,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // make the first .run() call (createCrawlRun's INSERT) throw to simulate a DB error
    let runCallCount = 0;
    const runLog: RunEntry[] = [];
    class FailFirstRunStmt {
      private bound: unknown[] = [];
      constructor(public readonly sql: string) {}
      bind(...args: unknown[]): this { this.bound = args; return this; }
      async first<T = Record<string, unknown>>(): Promise<T | null> { return null; }
      async run() {
        runCallCount++;
        if (runCallCount === 1) throw new Error("D1 write error");
        runLog.push({ sql: this.sql, args: this.bound });
        return { success: true, results: [], meta: { changes: 1, last_row_id: 1 } };
      }
      async all<T = Record<string, unknown>>() {
        if (this.sql.includes("crawl_target_state") && this.sql.includes("select")) {
          return { results: [dueTargetRow] as T[] };
        }
        return { results: [] as T[] };
      }
      getSql() { return this.sql; }
    }

    const db = {
      prepare: (sql: string) => new FailFirstRunStmt(sql),
      batch: async (stmts: FailFirstRunStmt[]) => {
        return { results: stmts.map(() => ({ results: [] })) };
      },
    } as unknown as D1Database;

    const res = await callRunOnce({ dryRun: false, maxDiscoveryTargets: 1, maxImportJobs: 0, maxEnqueueJobs: 0 }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean; discoveryRunsCompleted: number; discoveryRunsFailed: number; warnings: string[];
    };
    expect(json.ok).toBe(true);
    expect(json.discoveryRunsFailed).toBe(1);
    expect(json.discoveryRunsCompleted).toBe(0);
    expect(json.warnings.length).toBeGreaterThan(0);
    // markTargetDiscoveryFailed should have been called (updates crawl_target_state to 'failed')
    expect(runLog.some((r) => r.sql.includes("update crawl_target_state") && r.sql.includes("'failed'"))).toBe(true);
  });

  it("respects source filter", async () => {
    const { db } = makeMockD1({ allResponses: [[], [], []] });
    const res = await callRunOnce({ dryRun: false, source: "nooklyn", maxImportJobs: 0, maxEnqueueJobs: 0 }, db);
    expect(res.status).toBe(200);
  });

  it("does not add scheduled cron logic (no cron table writes)", async () => {
    const { db, runLog } = makeMockD1({ allResponses: [[]] });
    await callRunOnce({ dryRun: true }, db);
    expect(runLog.filter((r) => r.sql.includes("cron"))).toHaveLength(0);
  });
});

// --- scheduled runner limits ---

describe("POST /admin/crawler/run-once — limits", () => {
  it("enforces maxDiscoveryTargets hard max of 3", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({ maxDiscoveryTargets: 4 }, db);
    expect(res.status).toBe(400);
  });

  it("enforces maxImportJobs hard max of 5", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({ maxImportJobs: 6 }, db);
    expect(res.status).toBe(400);
  });

  it("enforces maxEnqueueJobs hard max of 25", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const res = await callRunOnce({ maxEnqueueJobs: 26 }, db);
    expect(res.status).toBe(400);
  });
});
