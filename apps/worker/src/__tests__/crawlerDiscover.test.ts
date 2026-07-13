import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "../index";

afterEach(() => { vi.restoreAllMocks(); });

// --- mock helpers ---

interface RunEntry { sql: string; args: unknown[] }

function makeMockD1(firstResponses: (Record<string, unknown> | null)[] = []) {
  const runLog: RunEntry[] = [];
  const queue = [...firstResponses];

  class MockStmt {
    private bound: unknown[] = [];
    constructor(public readonly sql: string) {}
    bind(...args: unknown[]): this { this.bound = args; return this; }
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      return (queue.shift() ?? null) as T | null;
    }
    async run() {
      runLog.push({ sql: this.sql, args: this.bound });
      return { success: true, results: [], meta: { changes: 1, last_row_id: 1 } };
    }
    async all<T = Record<string, unknown>>() { return { results: [] as T[] }; }
  }

  const db = { prepare: (sql: string) => new MockStmt(sql) } as unknown as D1Database;
  return { db, runLog };
}

function makeNooklynMock(count = 1) {
  return vi.fn().mockResolvedValue({
    ok: true, status: 200,
    headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
    json: async () => ({
      ok: true,
      page_count: 1,
      total_count: count,
      listings: Array.from({ length: count }, (_, i) => ({
        id: 10000 + i,
        price: 280000, // $2800 in cents
        bedrooms: 2,
        bathrooms: 1,
        neighborhood: { name: "Bushwick" },
        address: `${i + 1} Test St Brooklyn`,
        url: `/listings/listing-${10000 + i}-bushwick`,
      })),
    }),
  });
}

const NOOKLYN_TARGET = "nooklyn-url-first-bushwick-2br-max3100";
const ADMIN_TOKEN = "test-token";

async function callDiscover(body: unknown, db: D1Database) {
  return app.request(
    "/admin/crawler/discover",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
      body: JSON.stringify(body),
    },
    { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
  );
}

// --- tests ---

describe("POST /admin/crawler/discover — validation", () => {
  it("rejects requests with wrong admin token", async () => {
    const { db } = makeMockD1();
    const res = await app.request(
      "/admin/crawler/discover",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Token": "wrong" },
        body: JSON.stringify({ targetIds: [NOOKLYN_TARGET] }),
      },
      { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
    );
    expect(res.status).toBe(401);
  });

  it("rejects targetIds with more than 3 entries", async () => {
    const { db } = makeMockD1();
    const res = await callDiscover({ targetIds: ["a", "b", "c", "d"] }, db);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("validation failed");
  });

  it("rejects unknown target ids", async () => {
    const { db } = makeMockD1();
    const res = await callDiscover({ targetIds: ["does-not-exist"] }, db);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("unknown target ids");
  });

  it("rejects missing body", async () => {
    const { db } = makeMockD1();
    const res = await app.request(
      "/admin/crawler/discover",
      { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN }, body: "not json" },
      { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN } as unknown as Record<string, unknown>
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/crawler/discover — dryRun: true", () => {
  it("returns discovery results without writing to DB", async () => {
    vi.stubGlobal("fetch", makeNooklynMock(2));
    const { db, runLog } = makeMockD1();
    const res = await callDiscover({ targetIds: [NOOKLYN_TARGET], dryRun: true }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; dryRun: boolean; persistedCandidates: number };
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.persistedCandidates).toBe(0);
    // no crawl_run insert, no candidate inserts
    expect(runLog).toHaveLength(0);
  });

  it("defaults to dryRun: true when field is omitted", async () => {
    vi.stubGlobal("fetch", makeNooklynMock(1));
    const { db, runLog } = makeMockD1();
    const res = await callDiscover({ targetIds: [NOOKLYN_TARGET] }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as { dryRun: boolean };
    expect(json.dryRun).toBe(true);
    expect(runLog).toHaveLength(0);
  });
});

describe("POST /admin/crawler/discover — dryRun: false", () => {
  it("creates a crawl_run row and upserts candidates", async () => {
    vi.stubGlobal("fetch", makeNooklynMock(1));
    // one candidate → first() returns null (new insert) for source_listing_id lookup and canonical_url lookup
    const { db, runLog } = makeMockD1([null, null]);
    const res = await callDiscover({ targetIds: [NOOKLYN_TARGET], dryRun: false }, db);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean; dryRun: boolean; crawlRunId: string;
      insertedCandidates: number; persistedCandidates: number;
    };
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(false);
    expect(typeof json.crawlRunId).toBe("string");
    expect(json.insertedCandidates).toBe(1);
    expect(json.persistedCandidates).toBe(1);

    // crawl_runs insert + candidate insert + crawl_runs finish update
    const crawlRunInsert = runLog.find((r) => r.sql.includes("insert into crawl_runs"));
    const crawlRunUpdate = runLog.find((r) => r.sql.includes("update crawl_runs"));
    const candidateInsert = runLog.find((r) => r.sql.includes("insert into crawl_discovered_urls"));
    expect(crawlRunInsert).toBeDefined();
    expect(crawlRunUpdate).toBeDefined();
    expect(candidateInsert).toBeDefined();
  });

  it("does not insert into listings or import job tables", async () => {
    vi.stubGlobal("fetch", makeNooklynMock(1));
    const { db, runLog } = makeMockD1([null, null]);
    await callDiscover({ targetIds: [NOOKLYN_TARGET], dryRun: false }, db);
    const listingInserts = runLog.filter(
      (r) => r.sql.match(/insert into (?!crawl_)/i)
    );
    expect(listingInserts).toHaveLength(0);
  });

  it("records updatedCandidates when candidate already exists", async () => {
    vi.stubGlobal("fetch", makeNooklynMock(1));
    // candidate has a source_listing_id (nooklyn sets it), first lookup finds it
    const { db } = makeMockD1([{ id: "existing-uuid" }]);
    const res = await callDiscover({ targetIds: [NOOKLYN_TARGET], dryRun: false }, db);
    const json = await res.json() as {
      insertedCandidates: number; updatedCandidates: number; persistedCandidates: number;
    };
    expect(json.insertedCandidates).toBe(0);
    expect(json.updatedCandidates).toBe(1);
    expect(json.persistedCandidates).toBe(1);
  });
});
