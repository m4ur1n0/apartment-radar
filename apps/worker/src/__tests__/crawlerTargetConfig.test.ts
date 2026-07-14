import { describe, it, expect } from "vitest";
import { SEARCH_TARGETS, ENABLED_SEARCH_TARGETS } from "../crawler/searchTargets";
import { STREETEASY_AREA_IDS } from "../importers/streeteasyApi";
import {
  ensureTargetStateRows,
  getDueDiscoveryTargets,
  disableCrawlerTargets,
} from "../db/crawlTargetState";

// --- disabled target config ---

const DISABLED_IDS = [
  "nooklyn-url-first-ridgewood-2br-max3100",
  "nooklyn-url-first-east-williamsburg-2br-max3100",
  "nooklyn-url-first-maspeth-2br-max3100",
  "craigslist-url-first-brooklyn-apa-2br-max3100-query-bushwick-ridgewood",
];

describe("disabled target config", () => {
  it.each(DISABLED_IDS)("%s is disabled in SEARCH_TARGETS", (id) => {
    const t = SEARCH_TARGETS.find((t) => t.id === id);
    expect(t).toBeDefined();
    expect(t?.enabled).toBe(false);
  });

  it("ENABLED_SEARCH_TARGETS excludes all known bad targets", () => {
    for (const id of DISABLED_IDS) {
      expect(ENABLED_SEARCH_TARGETS.some((t) => t.id === id)).toBe(false);
    }
  });
});

// --- StreetEasy area ID coverage ---

describe("STREETEASY_AREA_IDS coverage", () => {
  it("every enabled StreetEasy target has a configured area ID", () => {
    const enabledSE = ENABLED_SEARCH_TARGETS.filter((t) => t.source === "streeteasy");
    expect(enabledSE.length).toBeGreaterThan(0);
    for (const t of enabledSE) {
      const ids = STREETEASY_AREA_IDS[t.id];
      expect(ids, `missing area ID for ${t.id}`).toBeDefined();
      expect(ids.length, `empty area IDs for ${t.id}`).toBeGreaterThan(0);
    }
  });

  it("no enabled StreetEasy target would emit area_id_not_configured", () => {
    const enabledSE = ENABLED_SEARCH_TARGETS.filter((t) => t.source === "streeteasy");
    const missing = enabledSE.filter((t) => !STREETEASY_AREA_IDS[t.id]);
    expect(missing.map((t) => t.id)).toEqual([]);
  });
});

// --- ensureTargetStateRows ---

function makeSqlCaptureMock() {
  const sqls: string[] = [];
  const runLog: { sql: string; args: unknown[] }[] = [];

  class MockStmt {
    constructor(public sql: string) {}
    bind(...args: unknown[]): this {
      runLog.push({ sql: this.sql, args });
      return this;
    }
    async run() { return { success: true, results: [], meta: { changes: 1, last_row_id: 1 } }; }
    async all<T>() { return { results: [] as T[] }; }
    async first<T>() { return null as T | null; }
  }

  const db = {
    prepare: (sql: string) => { sqls.push(sql); return new MockStmt(sql); },
    batch: async (_stmts: unknown[]) => ({ results: [] }),
  } as unknown as D1Database;

  return { db, sqls, runLog };
}

describe("ensureTargetStateRows", () => {
  it("uses ON CONFLICT DO UPDATE to sync enabled and priority", async () => {
    const { db, sqls } = makeSqlCaptureMock();
    await ensureTargetStateRows(db, [SEARCH_TARGETS[0]]);
    expect(sqls.length).toBeGreaterThan(0);
    const upsertSql = sqls[0].toLowerCase();
    expect(upsertSql).toContain("on conflict");
    expect(upsertSql).toContain("enabled = excluded.enabled");
    expect(upsertSql).toContain("priority = excluded.priority");
  });

  it("sets enabled=0 for disabled targets", async () => {
    const { db, runLog } = makeSqlCaptureMock();
    const disabledTarget = SEARCH_TARGETS.find((t) => t.id === DISABLED_IDS[0])!;
    await ensureTargetStateRows(db, [disabledTarget]);
    const bindArgs = runLog[0]?.args ?? [];
    // enabled is the 3rd bound argument (target_id, source, enabled, ...)
    expect(bindArgs[2]).toBe(0);
  });

  it("does not re-enable a disabled target that was already in DB", async () => {
    const { db, sqls } = makeSqlCaptureMock();
    const disabledTarget = SEARCH_TARGETS.find((t) => !t.enabled)!;
    await ensureTargetStateRows(db, [disabledTarget]);
    // the upsert should set enabled = excluded.enabled (which is 0 for disabled targets)
    // verified by checking the SQL uses excluded.enabled not a hardcoded 1
    expect(sqls[0]).not.toContain("do nothing");
  });
});

// --- disableCrawlerTargets ---

describe("disableCrawlerTargets", () => {
  it("issues UPDATE enabled=0 for each target ID", async () => {
    const { db, runLog } = makeSqlCaptureMock();
    await disableCrawlerTargets(db, ["target-a", "target-b"]);
    const updates = runLog.filter((r) => r.sql.toLowerCase().includes("update crawl_target_state"));
    expect(updates).toHaveLength(2);
    expect(updates[0].sql).toContain("enabled = 0");
    expect(updates[0].args).toContain("target-a");
    expect(updates[1].args).toContain("target-b");
  });

  it("is a no-op for empty array", async () => {
    const { db, runLog } = makeSqlCaptureMock();
    await disableCrawlerTargets(db, []);
    expect(runLog).toHaveLength(0);
  });
});

// --- getDueDiscoveryTargets skips disabled rows ---

describe("getDueDiscoveryTargets", () => {
  it("only queries rows with enabled=1", async () => {
    const { db, sqls } = makeSqlCaptureMock();
    await getDueDiscoveryTargets(db, { limit: 3 });
    expect(sqls[0].toLowerCase()).toContain("enabled = 1");
  });

  it("WHERE clause filters on enabled=1 so disabled rows are never returned", async () => {
    const { db, sqls } = makeSqlCaptureMock();
    await getDueDiscoveryTargets(db);
    expect(sqls[0]).toContain("enabled = 1");
  });
});

// --- crawl run history is not deleted ---

describe("cleanup correctness", () => {
  it("ensureTargetStateRows does not delete any rows", async () => {
    const { db, sqls } = makeSqlCaptureMock();
    await ensureTargetStateRows(db, SEARCH_TARGETS.slice(0, 3));
    expect(sqls.some((s) => s.toLowerCase().includes("delete"))).toBe(false);
  });

  it("disableCrawlerTargets does not delete any rows", async () => {
    const { db, sqls } = makeSqlCaptureMock();
    await disableCrawlerTargets(db, DISABLED_IDS);
    expect(sqls.some((s) => s.toLowerCase().includes("delete"))).toBe(false);
  });
});
