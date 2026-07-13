import { describe, it, expect } from "vitest";
import {
  createCrawlRun,
  finishCrawlRun,
  upsertDiscoveredCandidate,
  upsertDiscoveredCandidates,
  type DiscoveredCandidateParams,
} from "../crawlDiscovery";

interface RunEntry { sql: string; args: unknown[] }

function makeMockD1(firstResponses: (Record<string, unknown> | null)[] = []) {
  const runLog: RunEntry[] = [];
  const firstLog: RunEntry[] = [];
  const queue = [...firstResponses];

  class MockStmt {
    private bound: unknown[] = [];
    constructor(public readonly sql: string) {}
    bind(...args: unknown[]): this { this.bound = args; return this; }
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      firstLog.push({ sql: this.sql, args: this.bound });
      return (queue.shift() ?? null) as T | null;
    }
    async run() {
      runLog.push({ sql: this.sql, args: this.bound });
      return { success: true, results: [], meta: { changes: 1, last_row_id: 1 } };
    }
    async all<T = Record<string, unknown>>() {
      firstLog.push({ sql: this.sql, args: this.bound });
      return { results: [] as T[] };
    }
  }

  const db = { prepare: (sql: string) => new MockStmt(sql) } as unknown as D1Database;
  return { db, runLog, firstLog };
}

const BASE_CANDIDATE: DiscoveredCandidateParams = {
  source: "nooklyn",
  targetId: "nooklyn-bushwick-2br",
  crawlRunId: "run-123",
  listingUrl: "https://nooklyn.com/listings/123-main-st-brooklyn",
  canonicalUrl: "https://nooklyn.com/listings/123-main-st-brooklyn",
  sourceListingId: "99",
  price: 2800,
  beds: 2,
  baths: 1,
  neighborhood: "Bushwick",
};

const BASE_CANDIDATE_NO_SLUG: DiscoveredCandidateParams = {
  ...BASE_CANDIDATE,
  sourceListingId: undefined,
};

describe("createCrawlRun", () => {
  it("inserts into crawl_runs and returns a uuid", async () => {
    const { db, runLog } = makeMockD1();
    const id = await createCrawlRun(db, { runType: "discovery", targetsRequested: 1 });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(8);
    expect(runLog).toHaveLength(1);
    expect(runLog[0].sql).toContain("insert into crawl_runs");
  });

  it("sets status to running on creation", async () => {
    const { db, runLog } = makeMockD1();
    await createCrawlRun(db, { runType: "discovery", targetsRequested: 2 });
    expect(runLog[0].sql).toContain("'running'");
  });

  it("passes source and target_id when provided", async () => {
    const { db, runLog } = makeMockD1();
    await createCrawlRun(db, {
      runType: "discovery",
      source: "nooklyn",
      targetId: "nooklyn-bushwick",
      targetsRequested: 1,
    });
    expect(runLog[0].args).toContain("nooklyn");
    expect(runLog[0].args).toContain("nooklyn-bushwick");
  });
});

describe("finishCrawlRun", () => {
  it("updates crawl_runs with status, finished_at, and counts", async () => {
    const { db, runLog } = makeMockD1();
    const finishedAt = new Date().toISOString();
    await finishCrawlRun(db, "run-abc", {
      status: "completed",
      finishedAt,
      targetsCompleted: 1,
      candidatesFound: 5,
      candidatesAccepted: 4,
      candidatesRejected: 1,
    });
    expect(runLog).toHaveLength(1);
    expect(runLog[0].sql).toContain("update crawl_runs");
    expect(runLog[0].args).toContain("completed");
    expect(runLog[0].args).toContain(finishedAt);
    expect(runLog[0].args).toContain(5);
    expect(runLog[0].args).toContain(4);
    expect(runLog[0].args).toContain("run-abc");
  });
});

describe("upsertDiscoveredCandidate", () => {
  it("inserts a new row when not found by source_listing_id or canonical_url", async () => {
    // two nulls: source_listing_id lookup = null, canonical_url lookup = null
    const { db, runLog } = makeMockD1([null, null]);
    const result = await upsertDiscoveredCandidate(db, BASE_CANDIDATE);
    expect(result.inserted).toBe(true);
    expect(typeof result.id).toBe("string");
    const insertEntry = runLog.find((r) => r.sql.includes("insert into crawl_discovered_urls"));
    expect(insertEntry).toBeDefined();
  });

  it("inserts when no source_listing_id and canonical_url not found", async () => {
    const { db, runLog } = makeMockD1([null]); // only one lookup (no sourceListingId)
    const result = await upsertDiscoveredCandidate(db, BASE_CANDIDATE_NO_SLUG);
    expect(result.inserted).toBe(true);
    const insertEntry = runLog.find((r) => r.sql.includes("insert into crawl_discovered_urls"));
    expect(insertEntry).toBeDefined();
  });

  it("updates when found by source_listing_id", async () => {
    const { db, runLog } = makeMockD1([{ id: "existing-001" }]);
    const result = await upsertDiscoveredCandidate(db, BASE_CANDIDATE);
    expect(result.inserted).toBe(false);
    expect(result.id).toBe("existing-001");
    const updateEntry = runLog.find((r) => r.sql.includes("update crawl_discovered_urls"));
    expect(updateEntry).toBeDefined();
    expect(updateEntry?.args).toContain("existing-001");
  });

  it("updates when found by canonical_url (no source_listing_id provided)", async () => {
    const { db, runLog } = makeMockD1([{ id: "existing-002" }]);
    const result = await upsertDiscoveredCandidate(db, BASE_CANDIDATE_NO_SLUG);
    expect(result.inserted).toBe(false);
    expect(result.id).toBe("existing-002");
    const updateEntry = runLog.find((r) => r.sql.includes("update crawl_discovered_urls"));
    expect(updateEntry).toBeDefined();
  });

  it("falls back to canonical_url lookup when source_listing_id not found", async () => {
    // first lookup (by source_listing_id) returns null, second (by canonical_url) returns a row
    const { db, runLog, firstLog } = makeMockD1([null, { id: "existing-003" }]);
    const result = await upsertDiscoveredCandidate(db, BASE_CANDIDATE);
    expect(result.inserted).toBe(false);
    expect(firstLog).toHaveLength(2);
    expect(firstLog[0].sql).toContain("source_listing_id");
    expect(firstLog[1].sql).toContain("canonical_url");
    const updateEntry = runLog.find((r) => r.sql.includes("update crawl_discovered_urls"));
    expect(updateEntry).toBeDefined();
  });

  it("looks up by source_listing_id before canonical_url", async () => {
    const { db, firstLog } = makeMockD1([{ id: "existing-004" }]);
    await upsertDiscoveredCandidate(db, BASE_CANDIDATE);
    // only one lookup should happen (found on first try)
    expect(firstLog).toHaveLength(1);
    expect(firstLog[0].sql).toContain("source_listing_id");
  });

  it("increments times_seen on update", async () => {
    const { db, runLog } = makeMockD1([{ id: "existing-005" }]);
    await upsertDiscoveredCandidate(db, BASE_CANDIDATE_NO_SLUG);
    const updateEntry = runLog.find((r) => r.sql.includes("update crawl_discovered_urls"));
    expect(updateEntry?.sql).toContain("times_seen = times_seen + 1");
  });

  it("preserves first_seen_at on update (does not overwrite it)", async () => {
    const { db, runLog } = makeMockD1([{ id: "existing-006" }]);
    await upsertDiscoveredCandidate(db, BASE_CANDIDATE_NO_SLUG);
    const updateEntry = runLog.find((r) => r.sql.includes("update crawl_discovered_urls"));
    expect(updateEntry?.sql).not.toContain("first_seen_at");
  });

  it("updates last_seen_at on update", async () => {
    const { db, runLog } = makeMockD1([{ id: "existing-007" }]);
    await upsertDiscoveredCandidate(db, BASE_CANDIDATE_NO_SLUG);
    const updateEntry = runLog.find((r) => r.sql.includes("update crawl_discovered_urls"));
    expect(updateEntry?.sql).toContain("last_seen_at");
  });

  it("does not touch listings or import job tables", async () => {
    const { db, runLog } = makeMockD1([null]);
    await upsertDiscoveredCandidate(db, BASE_CANDIDATE_NO_SLUG);
    const bad = runLog.filter(
      (r) => r.sql.includes("listings") && !r.sql.includes("crawl_discovered_urls")
    );
    expect(bad).toHaveLength(0);
  });
});

describe("upsertDiscoveredCandidates", () => {
  it("returns inserted and updated counts", async () => {
    // first candidate: not found (insert) → 2 nulls
    // second candidate (no slug): not found (insert) → 1 null
    const { db } = makeMockD1([null, null, null]);
    const candidates = [BASE_CANDIDATE, BASE_CANDIDATE_NO_SLUG];
    const result = await upsertDiscoveredCandidates(db, candidates);
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.results).toHaveLength(2);
  });

  it("tracks mixed inserts and updates", async () => {
    // first: not found (insert) → 2 nulls (has slug)
    // second: found (update) → 1 row
    const { db } = makeMockD1([null, null, { id: "existing" }]);
    const result = await upsertDiscoveredCandidates(db, [BASE_CANDIDATE, BASE_CANDIDATE_NO_SLUG]);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(1);
  });
});
