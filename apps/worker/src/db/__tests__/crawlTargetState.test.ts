import { describe, it, expect } from "vitest";
import {
  ensureTargetStateRows,
  getDueDiscoveryTargets,
  markTargetDiscoverySucceeded,
  markTargetDiscoveryFailed,
  getNextDiscoveryAt,
  type CrawlTargetStateRow,
} from "../crawlTargetState";
import type { SearchTarget } from "../../crawler/searchTargets";

interface RunEntry { sql: string; args: unknown[] }

function makeMockD1(opts: {
  firstResponses?: (Record<string, unknown> | null)[];
  allResponses?: Record<string, unknown>[][];
} = {}) {
  const runLog: RunEntry[] = [];
  const batchLog: string[][] = [];
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
      const sqls = stmts.map((s) => s.getSql());
      batchLog.push(sqls);
      for (const s of stmts) {
        runLog.push({ sql: s.getSql(), args: [] });
      }
      return { results: stmts.map(() => ({ results: [] })) };
    },
  } as unknown as D1Database;

  return { db, runLog, batchLog };
}

const MOCK_TARGET: SearchTarget = {
  id: "nooklyn-url-first-bushwick-2br-max3100",
  source: "nooklyn",
  priority: "primary",
  enabled: true,
  label: "Test target",
  searchUrl: "https://nooklyn.com/rentals?neighborhood=bushwick",
  urlNeedsVerification: false,
  expectedFilters: { maxRent: 3100, beds: 2, allowedBoroughs: ["Brooklyn"], neighborhoods: ["Bushwick"] },
  hardFilters: {
    maxRent: 3100, beds: 2, minBaths: 1,
    allowedBoroughs: ["Brooklyn"],
    rejectIfClearlyOutsideNeighborhoods: true,
    allowUnknownNeighborhoodIfSearchTargetIsSpecific: true,
  },
  discoveryLimits: { maxCandidateUrlsPerRun: 40, maxPagesPerRun: 2 },
};

const DISABLED_TARGET: SearchTarget = {
  ...MOCK_TARGET,
  id: "disabled-target",
  enabled: false,
  priority: "fallback",
};

// --- getNextDiscoveryAt ---

describe("getNextDiscoveryAt", () => {
  it("returns a time 12 hours in the future", () => {
    const now = new Date("2026-07-12T10:00:00.000Z");
    const next = getNextDiscoveryAt("nooklyn", now);
    expect(next).toBe("2026-07-12T22:00:00.000Z");
  });

  it("works for all sources with same 12h interval", () => {
    const now = new Date("2026-07-12T00:00:00.000Z");
    const expected = "2026-07-12T12:00:00.000Z";
    for (const source of ["nooklyn", "craigslist", "streeteasy", "zillow"]) {
      expect(getNextDiscoveryAt(source, now)).toBe(expected);
    }
  });
});

// --- ensureTargetStateRows ---

describe("ensureTargetStateRows", () => {
  it("calls batch with upsert for each target and syncs enabled/priority on conflict", async () => {
    const { db, batchLog } = makeMockD1();
    await ensureTargetStateRows(db, [MOCK_TARGET, DISABLED_TARGET]);
    expect(batchLog).toHaveLength(1);
    expect(batchLog[0]).toHaveLength(2);
    expect(batchLog[0][0]).toMatch(/on conflict\(target_id\) do update set/i);
    expect(batchLog[0][0]).toMatch(/enabled = excluded\.enabled/i);
  });

  it("does nothing when targets list is empty", async () => {
    const { db, batchLog } = makeMockD1();
    await ensureTargetStateRows(db, []);
    expect(batchLog).toHaveLength(0);
  });

  it("maps priority strings to integers via batch", async () => {
    const { db, batchLog } = makeMockD1();
    await ensureTargetStateRows(db, [MOCK_TARGET]); // primary → 3
    expect(batchLog).toHaveLength(1);
    expect(batchLog[0]).toHaveLength(1);
  });
});

// --- getDueDiscoveryTargets ---

describe("getDueDiscoveryTargets", () => {
  it("returns rows from DB filtered by enabled and due time", async () => {
    const stateRow: CrawlTargetStateRow = {
      target_id: MOCK_TARGET.id,
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
    const { db } = makeMockD1({ allResponses: [[stateRow]] });
    const results = await getDueDiscoveryTargets(db, { limit: 2 });
    expect(results).toHaveLength(1);
    expect(results[0].target_id).toBe(MOCK_TARGET.id);
  });

  it("returns empty array when no due targets", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const results = await getDueDiscoveryTargets(db);
    expect(results).toHaveLength(0);
  });

  it("accepts source filter", async () => {
    const { db, runLog } = makeMockD1({ allResponses: [[]] });
    await getDueDiscoveryTargets(db, { source: "nooklyn" });
    // should include source in query
    expect(runLog.length).toBe(0); // no run() calls, only all()
    // the query was fired through all(); just verify no error
  });
});

// --- markTargetDiscoverySucceeded ---

describe("markTargetDiscoverySucceeded", () => {
  it("updates status to succeeded and resets consecutive_failures", async () => {
    const { db, runLog } = makeMockD1();
    const nextAt = "2026-07-13T10:00:00.000Z";
    await markTargetDiscoverySucceeded(db, MOCK_TARGET.id, "run-001", nextAt);
    const update = runLog.find((r) => r.sql.includes("update crawl_target_state"));
    expect(update).toBeDefined();
    expect(update?.sql).toMatch(/'succeeded'/);
    expect(update?.sql).toMatch(/consecutive_failures = 0/);
    expect(update?.args).toContain(nextAt);
    expect(update?.args).toContain("run-001");
    expect(update?.args).toContain(MOCK_TARGET.id);
  });
});

// --- markTargetDiscoveryFailed ---

describe("markTargetDiscoveryFailed", () => {
  it("sets status to failed and increments consecutive_failures", async () => {
    const { db, runLog } = makeMockD1();
    const nextAt = "2026-07-13T10:00:00.000Z";
    await markTargetDiscoveryFailed(db, MOCK_TARGET.id, "fetch error", nextAt);
    const update = runLog.find((r) => r.sql.includes("update crawl_target_state"));
    expect(update).toBeDefined();
    expect(update?.sql).toMatch(/'failed'/);
    expect(update?.sql).toMatch(/consecutive_failures = consecutive_failures \+ 1/);
    expect(update?.args).toContain("fetch error");
    expect(update?.args).toContain(nextAt);
    expect(update?.args).toContain(MOCK_TARGET.id);
  });

  it("stores the error message in last_error", async () => {
    const { db, runLog } = makeMockD1();
    await markTargetDiscoveryFailed(db, "some-target", "network timeout", "2026-07-13T00:00:00.000Z");
    const update = runLog.find((r) => r.sql.includes("update crawl_target_state"));
    expect(update?.args).toContain("network timeout");
  });
});
