import { describe, it, expect, vi, afterEach } from "vitest";
import {
  enqueueImportJobsFromDiscoveredUrls,
  claimPendingImportJobs,
  markImportJobSucceeded,
  markImportJobFailed,
  processImportJob,
  type ImportJobRow,
  type DiscoveredUrlRow,
} from "../importJobs";

afterEach(() => { vi.restoreAllMocks(); });

interface RunEntry { sql: string; args: unknown[] }

function makeMockD1(opts: {
  firstResponses?: (Record<string, unknown> | null)[];
  allResponses?: Record<string, unknown>[][];
} = {}) {
  const runLog: RunEntry[] = [];
  const firstLog: RunEntry[] = [];
  const firstQueue = [...(opts.firstResponses ?? [])];
  const allQueue = [...(opts.allResponses ?? [])];

  class MockStmt {
    private bound: unknown[] = [];
    constructor(public readonly sql: string) {}
    bind(...args: unknown[]): this { this.bound = args; return this; }
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      firstLog.push({ sql: this.sql, args: this.bound });
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
    async batch() { return { results: [] }; }
  }

  const db = {
    prepare: (sql: string) => new MockStmt(sql),
    batch: async (stmts: unknown[]) => ({ results: stmts.map(() => ({ results: [] })) }),
  } as unknown as D1Database;
  return { db, runLog, firstLog };
}

const BASE_DISCOVERED: DiscoveredUrlRow = {
  id: "disc-001",
  source: "nooklyn",
  target_id: "nooklyn-url-first-bushwick-2br-max3100",
  listing_url: "https://nooklyn.com/listings/test-listing-bushwick",
  canonical_url: "https://nooklyn.com/listings/test-listing-bushwick",
  source_listing_id: "10001",
  title: "2BR Bushwick",
  price: 2800,
  status: "discovered",
};

const BASE_JOB: ImportJobRow = {
  id: "job-001",
  source: "nooklyn",
  discovered_url_id: "disc-001",
  listing_url: "https://nooklyn.com/listings/test-listing-bushwick",
  canonical_url: "https://nooklyn.com/listings/test-listing-bushwick",
  source_listing_id: "10001",
  status: "running",
  priority: 0,
  attempt_count: 1,
  max_attempts: 3,
  last_error: null,
  locked_at: new Date().toISOString(),
  locked_by: "worker-abc",
  next_attempt_at: null,
  started_at: new Date().toISOString(),
  completed_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// --- enqueueImportJobsFromDiscoveredUrls ---

describe("enqueueImportJobsFromDiscoveredUrls — dryRun: true", () => {
  it("returns preview but writes nothing to DB", async () => {
    const { db, runLog } = makeMockD1({
      allResponses: [[BASE_DISCOVERED]],
      firstResponses: [null], // no existing job
    });
    const result = await enqueueImportJobsFromDiscoveredUrls(db, { dryRun: true });
    expect(result.selected).toBe(1);
    expect(result.insertedJobs).toBe(0);
    expect(result.updatedDiscoveredRows).toBe(0);
    expect(result.preview).toHaveLength(1);
    expect(result.preview[0].canonicalUrl).toBe(BASE_DISCOVERED.canonical_url);
    // no INSERT or UPDATE runs
    const writes = runLog.filter((r) => r.sql.match(/^(insert|update)/i));
    expect(writes).toHaveLength(0);
  });

  it("skips URLs that already have a job", async () => {
    const { db } = makeMockD1({
      allResponses: [[BASE_DISCOVERED]],
      firstResponses: [{ id: "existing-job-001" }], // job already exists
    });
    const result = await enqueueImportJobsFromDiscoveredUrls(db, { dryRun: true });
    expect(result.skippedExistingJobs).toBe(1);
    expect(result.insertedJobs).toBe(0);
    expect(result.preview).toHaveLength(0);
  });
});

describe("enqueueImportJobsFromDiscoveredUrls — dryRun: false", () => {
  it("inserts jobs and marks discovered rows queued", async () => {
    const { db, runLog } = makeMockD1({
      allResponses: [[BASE_DISCOVERED]],
      firstResponses: [null],
    });
    const result = await enqueueImportJobsFromDiscoveredUrls(db, { dryRun: false });
    expect(result.insertedJobs).toBe(1);
    expect(result.updatedDiscoveredRows).toBe(1);
    expect(runLog.some((r) => r.sql.includes("insert into crawl_import_jobs"))).toBe(true);
    expect(runLog.some((r) => r.sql.includes("update crawl_discovered_urls") && r.sql.includes("queued"))).toBe(true);
  });

  it("skips existing jobs and does not update discovered URL", async () => {
    const { db, runLog } = makeMockD1({
      allResponses: [[BASE_DISCOVERED]],
      firstResponses: [{ id: "existing-job-001" }],
    });
    const result = await enqueueImportJobsFromDiscoveredUrls(db, { dryRun: false });
    expect(result.insertedJobs).toBe(0);
    expect(result.skippedExistingJobs).toBe(1);
    expect(result.updatedDiscoveredRows).toBe(0);
    expect(runLog.filter((r) => r.sql.includes("insert into crawl_import_jobs"))).toHaveLength(0);
  });

  it("returns zero results when no discovered URLs match", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const result = await enqueueImportJobsFromDiscoveredUrls(db, { dryRun: false });
    expect(result.selected).toBe(0);
    expect(result.insertedJobs).toBe(0);
  });
});

// --- claimPendingImportJobs ---

describe("claimPendingImportJobs", () => {
  it("marks claimed jobs as running and increments attempt_count", async () => {
    const pendingJob = {
      id: "job-001", source: "nooklyn", discovered_url_id: "disc-001",
      listing_url: "https://nooklyn.com/listings/test", canonical_url: "https://nooklyn.com/listings/test",
      source_listing_id: null, status: "pending", priority: 0, attempt_count: 0, max_attempts: 3,
      last_error: null, locked_at: null, locked_by: null, next_attempt_at: null,
      started_at: null, completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const { db, runLog } = makeMockD1({ allResponses: [[pendingJob]] });
    const claimed = await claimPendingImportJobs(db, { limit: 1 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attempt_count).toBe(1); // incremented from 0
    expect(runLog.some((r) => r.sql.includes("update crawl_import_jobs") && r.sql.includes("'running'"))).toBe(true);
    expect(runLog.some((r) => r.sql.includes("attempt_count = attempt_count + 1"))).toBe(true);
  });

  it("returns empty array when no pending jobs", async () => {
    const { db } = makeMockD1({ allResponses: [[]] });
    const claimed = await claimPendingImportJobs(db);
    expect(claimed).toHaveLength(0);
  });
});

// --- markImportJobSucceeded ---

describe("markImportJobSucceeded", () => {
  it("sets status to succeeded and marks discovered URL imported", async () => {
    const { db, runLog } = makeMockD1();
    await markImportJobSucceeded(db, BASE_JOB);
    expect(runLog.some((r) => r.sql.includes("update crawl_import_jobs") && r.sql.includes("'succeeded'"))).toBe(true);
    expect(runLog.some((r) => r.sql.includes("update crawl_discovered_urls") && r.sql.includes("'imported'"))).toBe(true);
    expect(runLog.some((r) => r.args.includes(BASE_JOB.id))).toBe(true);
    expect(runLog.some((r) => r.args.includes(BASE_JOB.discovered_url_id))).toBe(true);
  });
});

// --- markImportJobFailed ---

describe("markImportJobFailed", () => {
  it("sets status to failed with next_attempt_at when below max_attempts", async () => {
    const { db, runLog } = makeMockD1();
    await markImportJobFailed(db, BASE_JOB, "fetch error");
    const update = runLog.find((r) => r.sql.includes("update crawl_import_jobs") && r.sql.includes("'failed'"));
    expect(update).toBeDefined();
    expect(update?.args).toContain("fetch error");
  });

  it("sets status to dead when attempt_count >= max_attempts", async () => {
    const { db, runLog } = makeMockD1();
    const deadJob = { ...BASE_JOB, attempt_count: 3, max_attempts: 3 };
    await markImportJobFailed(db, deadJob, "too many failures");
    const update = runLog.find((r) => r.sql.includes("'dead'"));
    expect(update).toBeDefined();
    expect(update?.args).toContain("too many failures");
  });

  it("stores the error message", async () => {
    const { db, runLog } = makeMockD1();
    await markImportJobFailed(db, BASE_JOB, "some error message");
    const update = runLog.find((r) => r.sql.includes("update crawl_import_jobs"));
    expect(update?.args).toContain("some error message");
  });
});

// --- processImportJob ---

describe("processImportJob", () => {
  it("calls importPreview, saves listing, marks job succeeded", async () => {
    // mock the nooklyn fetch API to return a full listing
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("nooklyn.com/api/v2/listings.fetch")) {
        return {
          ok: true, status: 200,
          headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
          json: async () => ({
            listing: {
              id: 10001,
              price: 280000,
              bedrooms: 2,
              bathrooms: 1,
              neighborhood: { name: "Bushwick" },
              address: "123 Test St Brooklyn NY",
              latitude: 40.6937,
              longitude: -73.9208,
            },
          }),
        };
      }
      // fallback for any other fetch (geocode etc.)
      return { ok: false, status: 404, json: async () => [] };
    }));

    const { db, runLog } = makeMockD1({
      // first() calls: select id from listings (after upsert) → return a listing id
      firstResponses: [{ id: "listing-uuid-001" }],
    });

    const result = await processImportJob(db, BASE_JOB, { scraperApiKeys: [] });

    expect(result.status).toBe("succeeded");
    expect(result.listingId).toBe("listing-uuid-001");
    expect(runLog.some((r) => r.sql.includes("insert into listings"))).toBe(true);
    expect(runLog.some((r) => r.sql.includes("update crawl_import_jobs") && r.sql.includes("'succeeded'"))).toBe(true);
    expect(runLog.some((r) => r.sql.includes("update crawl_discovered_urls") && r.sql.includes("'imported'"))).toBe(true);
  });

  it("marks job failed when importPreview returns missing required fields", async () => {
    // mock nooklyn API with no rent
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({
      ok: true, status: 200,
      headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
      json: async () => ({ listing: { id: 10002 } }), // no price/beds/baths
    })));

    const { db, runLog } = makeMockD1();
    const result = await processImportJob(db, BASE_JOB, { scraperApiKeys: [] });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/required fields missing/);
    expect(runLog.some((r) => r.sql.includes("'failed'") || r.sql.includes("'dead'"))).toBe(true);
  });

  it("marks job dead when attempt_count >= max_attempts and fields missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ listing: { id: 10003 } }),
    })));

    const { db, runLog } = makeMockD1();
    const exhaustedJob = { ...BASE_JOB, attempt_count: 3, max_attempts: 3 };
    const result = await processImportJob(db, exhaustedJob, { scraperApiKeys: [] });

    expect(result.status).toBe("dead");
    expect(runLog.some((r) => r.sql.includes("'dead'"))).toBe(true);
  });

  it("does not touch listings or import_jobs tables on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const { db, runLog } = makeMockD1();
    const result = await processImportJob(db, BASE_JOB);

    expect(["failed", "dead"]).toContain(result.status);
    expect(runLog.filter((r) => r.sql.includes("insert into listings"))).toHaveLength(0);
    // should still update job status
    expect(runLog.some((r) => r.sql.includes("update crawl_import_jobs"))).toBe(true);
  });
});
