import { describe, it, expect } from "vitest";
import { app } from "../index";
import { saveListing } from "../importers/saveListing";

const ADMIN_TOKEN = "test-token";

interface RunEntry { sql: string; args: unknown[] }

function makeMockD1(opts: {
  firstResponses?: (Record<string, unknown> | null)[];
  allResponses?: Record<string, unknown>[][];
  changeCount?: number;
} = {}) {
  const runLog: RunEntry[] = [];
  const firstQueue = [...(opts.firstResponses ?? [])];
  const allQueue = [...(opts.allResponses ?? [])];
  const changeCount = opts.changeCount ?? 1;

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
      return { success: true, results: [], meta: { changes: changeCount, last_row_id: 1 } };
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

// --- POST /listings/:id/hide ---

describe("POST /listings/:id/hide", () => {
  it("sets hidden_at on the listing", async () => {
    const { db, runLog } = makeMockD1();

    const res = await app.request("/listings/listing-abc/hide", {
      method: "POST",
      headers: { "X-Admin-Token": ADMIN_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ hidden_by: "Theo", hidden_reason: "wrong area" }),
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);

    const update = runLog.find((r) => r.sql.includes("hidden_at"));
    expect(update).toBeDefined();
    expect(update?.args).toContain("listing-abc");
    expect(update?.args).toContain("Theo");
    expect(update?.args).toContain("wrong area");
  });

  it("returns 404 when listing not found", async () => {
    const { db } = makeMockD1({ changeCount: 0 });

    const res = await app.request("/listings/nonexistent/hide", {
      method: "POST",
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });

    expect(res.status).toBe(404);
  });

  it("requires admin token", async () => {
    const { db } = makeMockD1();
    const res = await app.request("/listings/abc/hide", {
      method: "POST",
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(res.status).toBe(401);
  });

  it("works without a body", async () => {
    const { db } = makeMockD1();
    const res = await app.request("/listings/listing-abc/hide", {
      method: "POST",
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(res.status).toBe(200);
  });
});

// --- saveListing resurrection prevention ---

describe("saveListing hidden listing prevention", () => {
  it("skips save and returns existing ID when listing is hidden", async () => {
    const existingId = "existing-uuid";
    const { db, runLog } = makeMockD1({
      firstResponses: [{ id: existingId, hidden_at: "2026-07-12T10:00:00.000Z" }],
    });

    const result = await saveListing(db, {
      canonical_url: "https://example.com/listing/123",
      source: "test",
      rent: 2800,
      beds: 2,
      baths: 1,
      borough: "Brooklyn",
    });

    expect(result.listingId).toBe(existingId);
    expect(result.enrichmentWarnings).toContain("listing_is_hidden");

    // must not have run any INSERT or UPDATE
    const writes = runLog.filter((r) =>
      r.sql.toLowerCase().includes("insert into listings") ||
      (r.sql.toLowerCase().includes("update") && r.sql.toLowerCase().includes("listings"))
    );
    expect(writes).toHaveLength(0);
  });

  it("proceeds normally when listing is not hidden", async () => {
    const existingId = "existing-uuid";
    const { db, runLog } = makeMockD1({
      firstResponses: [
        { id: existingId, hidden_at: null }, // hidden_at check: exists but not hidden
        { id: existingId },                   // select id after upsert
      ],
    });

    await saveListing(db, {
      canonical_url: "https://example.com/listing/456",
      source: "test",
      rent: 2800,
      beds: 2,
      baths: 1,
      borough: "Brooklyn",
    });

    const insert = runLog.find((r) => r.sql.toLowerCase().includes("insert into listings"));
    expect(insert).toBeDefined();
  });

  it("proceeds normally when listing does not exist yet", async () => {
    const newId = "new-uuid";
    const { db, runLog } = makeMockD1({
      firstResponses: [
        null,          // hidden_at check: null = new listing, proceed
        { id: newId }, // select id after upsert
      ],
    });

    await saveListing(db, {
      canonical_url: "https://example.com/listing/new",
      source: "test",
      rent: 2800,
      beds: 2,
      baths: 1,
      borough: "Brooklyn",
    });

    const insert = runLog.find((r) => r.sql.toLowerCase().includes("insert into listings"));
    expect(insert).toBeDefined();
  });
});

// --- GET /listings excludes hidden ---

describe("GET /listings hidden_at filter", () => {
  it("SQL excludes hidden listings with hidden_at IS NULL check", async () => {
    // first allResponses entry is the listings query; others are estimates/photos/ratings
    const { db, runLog } = makeMockD1({
      allResponses: [[], [], [], []],
    });

    await app.request("/listings", {
      method: "GET",
    }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });

    const listingQuery = runLog.find((r) => r.sql.toLowerCase().includes("from listings"));
    expect(listingQuery).toBeDefined();
    expect(listingQuery?.sql.toLowerCase()).toContain("hidden_at is null");
  });
});

// --- both reviewers display ---

describe("ratings included in GET /listings", () => {
  it("fetches ratings via a query containing user_ratings", async () => {
    const { db, runLog } = makeMockD1({
      allResponses: [
        // listings query
        [{ id: "l1", rent: 2800, beds: 2, baths: 1, borough: "Brooklyn", status: "active",
           fit_score: 70, deal_score: 60, urgency_score: 65, risk_score: 20,
           first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-12T00:00:00Z",
           created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-12T00:00:00Z",
           hidden_at: null }],
        [], // subway estimates (parallel query 1)
        [], // photos (parallel query 2)
        [   // ratings (parallel query 3)
          { listing_id: "l1", user_name: "Theo", rating: 4, notes: "nice kitchen", decision: null },
          { listing_id: "l1", user_name: "Sam", rating: 3, notes: null, decision: null },
        ],
      ],
    });

    const res = await app.request("/listings", { method: "GET" }, { DB: db, API_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(res.status).toBe(200);

    const body = await res.json() as { listings: Record<string, unknown>[] };
    const ratings = body.listings[0]?.ratings as unknown[];
    expect(ratings).toHaveLength(2);

    const ratingsQuery = runLog.find((r) => r.sql.includes("user_ratings"));
    expect(ratingsQuery).toBeDefined();
  });
});
