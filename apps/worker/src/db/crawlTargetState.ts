import type { SearchTarget } from "../crawler/searchTargets";

export type CrawlTargetStateRow = {
  target_id: string;
  source: string;
  enabled: number;
  priority: number;
  last_discovery_at: string | null;
  next_discovery_at: string | null;
  last_discovery_status: string | null;
  last_discovery_run_id: string | null;
  consecutive_failures: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const PRIORITY_MAP: Record<string, number> = {
  primary: 3,
  secondary: 2,
  fallback: 1,
  experimental: 0,
};

const DISCOVERY_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function getNextDiscoveryAt(_source: string, now = new Date()): string {
  return new Date(now.getTime() + DISCOVERY_INTERVAL_MS).toISOString();
}

export async function ensureTargetStateRows(
  db: D1Database,
  targets: SearchTarget[]
): Promise<void> {
  if (targets.length === 0) return;
  const now = new Date().toISOString();
  const stmts = targets.map((t) =>
    db
      .prepare(
        `insert or ignore into crawl_target_state
           (target_id, source, enabled, priority, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        t.id,
        t.source,
        t.enabled ? 1 : 0,
        PRIORITY_MAP[t.priority] ?? 0,
        now,
        now
      )
  );
  await db.batch(stmts);
}

export async function getDueDiscoveryTargets(
  db: D1Database,
  options: { limit?: number; source?: string } = {}
): Promise<CrawlTargetStateRow[]> {
  const { limit = 10, source } = options;
  const sourceClause = source ? "and source = ?" : "";
  const args: unknown[] = source ? [source, limit] : [limit];
  const { results } = await db
    .prepare(
      `select * from crawl_target_state
       where enabled = 1
         and (next_discovery_at is null or next_discovery_at <= datetime('now'))
         ${sourceClause}
       order by priority desc, next_discovery_at asc, target_id asc
       limit ?`
    )
    .bind(...args)
    .all<CrawlTargetStateRow>();
  return results;
}

export async function markTargetDiscoverySucceeded(
  db: D1Database,
  targetId: string,
  runId: string,
  nextDiscoveryAt: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `update crawl_target_state set
         last_discovery_at = ?,
         next_discovery_at = ?,
         last_discovery_status = 'succeeded',
         last_discovery_run_id = ?,
         consecutive_failures = 0,
         last_error = null,
         updated_at = ?
       where target_id = ?`
    )
    .bind(now, nextDiscoveryAt, runId, now, targetId)
    .run();
}

export async function markTargetDiscoveryFailed(
  db: D1Database,
  targetId: string,
  error: string,
  nextDiscoveryAt: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `update crawl_target_state set
         last_discovery_at = ?,
         next_discovery_at = ?,
         last_discovery_status = 'failed',
         consecutive_failures = consecutive_failures + 1,
         last_error = ?,
         updated_at = ?
       where target_id = ?`
    )
    .bind(now, nextDiscoveryAt, error, now, targetId)
    .run();
}
