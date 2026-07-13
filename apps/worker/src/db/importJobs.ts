import { importPreview } from "../importers";
import { saveListing } from "../importers/saveListing";
import { SOURCE_CONFIG } from "../importers/sources";

export type ImportJobRow = {
  id: string;
  source: string;
  discovered_url_id: string;
  listing_url: string;
  canonical_url: string;
  source_listing_id: string | null;
  status: string;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  next_attempt_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DiscoveredUrlRow = {
  id: string;
  source: string;
  target_id: string;
  listing_url: string;
  canonical_url: string;
  source_listing_id: string | null;
  title: string | null;
  price: number | null;
  status: string;
};

export type PreviewEntry = {
  discoveredUrlId: string;
  source: string;
  canonicalUrl: string;
  title?: string;
  price?: number;
};

export type EnqueueOptions = {
  source?: string;
  targetId?: string;
  limit?: number;
  priority?: number;
  includeStatuses?: string[];
  dryRun?: boolean;
};

export type EnqueueResult = {
  selected: number;
  insertedJobs: number;
  skippedExistingJobs: number;
  updatedDiscoveredRows: number;
  preview: PreviewEntry[];
};

export type ClaimOptions = {
  source?: string;
  limit?: number;
  reclaimStaleMinutes?: number;
};

export type ProcessJobOptions = {
  scraperApiKeys?: string[];
  workerId?: string;
};

export type ProcessJobResult = {
  jobId: string;
  source: string;
  canonicalUrl: string;
  status: "succeeded" | "failed" | "dead" | "pending";
  listingId?: string;
  error?: string;
};

export type ProcessNextOptions = {
  source?: string;
  limit?: number;
  dryRun?: boolean;
  scraperApiKeys?: string[];
  workerId?: string;
};

export type ProcessNextResult = {
  dryRun: boolean;
  selectedJobs: number;
  processedJobs: number;
  succeeded: number;
  failed: number;
  dead: number;
  results: ProcessJobResult[];
};

export async function enqueueImportJobsFromDiscoveredUrls(
  db: D1Database,
  options: EnqueueOptions = {}
): Promise<EnqueueResult> {
  const {
    source,
    targetId,
    limit = 25,
    priority = 0,
    includeStatuses = ["discovered"],
    dryRun = true,
  } = options;

  const statusPlaceholders = includeStatuses.map(() => "?").join(", ");
  const params: unknown[] = [...includeStatuses];
  let sql = `select id, source, target_id, listing_url, canonical_url, source_listing_id, title, price, status
             from crawl_discovered_urls
             where status in (${statusPlaceholders})`;
  if (source) { sql += " and source = ?"; params.push(source); }
  if (targetId) { sql += " and target_id = ?"; params.push(targetId); }
  sql += " order by first_seen_at asc limit ?";
  params.push(limit);

  const rows = await db.prepare(sql).bind(...params).all<DiscoveredUrlRow>();
  const discovered = rows.results;

  let insertedJobs = 0;
  let skippedExistingJobs = 0;
  let updatedDiscoveredRows = 0;
  const preview: PreviewEntry[] = [];

  for (const row of discovered) {
    const existing = await db
      .prepare("select id from crawl_import_jobs where source = ? and canonical_url = ?")
      .bind(row.source, row.canonical_url)
      .first<{ id: string }>();

    if (existing) {
      skippedExistingJobs++;
      continue;
    }

    preview.push({
      discoveredUrlId: row.id,
      source: row.source,
      canonicalUrl: row.canonical_url,
      ...(row.title ? { title: row.title } : {}),
      ...(row.price != null ? { price: row.price } : {}),
    });

    if (!dryRun) {
      const jobId = crypto.randomUUID();
      await db
        .prepare(
          `insert into crawl_import_jobs
             (id, source, discovered_url_id, listing_url, canonical_url, source_listing_id,
              status, priority, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))`
        )
        .bind(
          jobId, row.source, row.id, row.listing_url, row.canonical_url,
          row.source_listing_id ?? null, priority
        )
        .run();

      await db
        .prepare("update crawl_discovered_urls set status = 'queued', updated_at = datetime('now') where id = ?")
        .bind(row.id)
        .run();

      insertedJobs++;
      updatedDiscoveredRows++;
    } else {
      insertedJobs++;
    }
  }

  return {
    selected: discovered.length,
    insertedJobs: dryRun ? 0 : insertedJobs,
    skippedExistingJobs,
    updatedDiscoveredRows,
    preview,
  };
}

export async function claimPendingImportJobs(
  db: D1Database,
  options: ClaimOptions = {}
): Promise<ImportJobRow[]> {
  const { source, limit = 1, reclaimStaleMinutes } = options;

  const params: unknown[] = [];
  let whereClause = `(status = 'pending' and (next_attempt_at is null or next_attempt_at <= datetime('now')))`;

  if (reclaimStaleMinutes) {
    whereClause += ` or (status = 'running' and locked_at <= datetime('now', '-${reclaimStaleMinutes} minutes'))`;
  }

  let sql = `select id, source, discovered_url_id, listing_url, canonical_url, source_listing_id,
                    status, priority, attempt_count, max_attempts, last_error,
                    locked_at, locked_by, next_attempt_at, started_at, completed_at, created_at, updated_at
             from crawl_import_jobs
             where (${whereClause})`;

  if (source) {
    sql += " and source = ?";
    params.push(source);
  }

  sql += " order by priority desc, created_at asc limit ?";
  params.push(limit);

  const rows = await db.prepare(sql).bind(...params).all<ImportJobRow>();
  const jobs = rows.results;
  if (jobs.length === 0) return [];

  const ids = jobs.map((j) => j.id);
  const placeholders = ids.map(() => "?").join(", ");
  const workerId = crypto.randomUUID().slice(0, 8);

  await db
    .prepare(
      `update crawl_import_jobs set
         status = 'running',
         locked_at = datetime('now'),
         locked_by = ?,
         started_at = coalesce(started_at, datetime('now')),
         attempt_count = attempt_count + 1,
         updated_at = datetime('now')
       where id in (${placeholders}) and status in ('pending', 'running')`
    )
    .bind(workerId, ...ids)
    .run();

  return jobs.map((j) => ({ ...j, attempt_count: j.attempt_count + 1 }));
}

export async function markImportJobSucceeded(
  db: D1Database,
  job: ImportJobRow
): Promise<void> {
  await db
    .prepare(
      `update crawl_import_jobs set
         status = 'succeeded',
         completed_at = datetime('now'),
         last_error = null,
         updated_at = datetime('now')
       where id = ?`
    )
    .bind(job.id)
    .run();

  await db
    .prepare(
      "update crawl_discovered_urls set status = 'imported', updated_at = datetime('now') where id = ?"
    )
    .bind(job.discovered_url_id)
    .run();
}

function backoffNextAttemptAt(attemptCount: number): string {
  const secondsOut =
    attemptCount <= 1 ? 15 * 60 :
    attemptCount <= 2 ? 60 * 60 :
    6 * 60 * 60;
  return new Date(Date.now() + secondsOut * 1000).toISOString();
}

export async function markImportJobFailed(
  db: D1Database,
  job: ImportJobRow,
  error: string
): Promise<void> {
  if (job.attempt_count >= job.max_attempts) {
    await db
      .prepare(
        `update crawl_import_jobs set
           status = 'dead',
           last_error = ?,
           completed_at = datetime('now'),
           updated_at = datetime('now')
         where id = ?`
      )
      .bind(error, job.id)
      .run();
    return;
  }

  const nextAttemptAt = backoffNextAttemptAt(job.attempt_count);
  await db
    .prepare(
      `update crawl_import_jobs set
         status = 'failed',
         last_error = ?,
         next_attempt_at = ?,
         updated_at = datetime('now')
       where id = ?`
    )
    .bind(error, nextAttemptAt, job.id)
    .run();
}

function fetchModeForSource(source: string): "direct" | "proxy" {
  const cfg = (SOURCE_CONFIG as Record<string, { defaultFetchMode: string } | undefined>)[source];
  if (!cfg) return "direct";
  return cfg.defaultFetchMode === "proxy" ? "proxy" : "direct";
}

export async function processImportJob(
  db: D1Database,
  job: ImportJobRow,
  options: ProcessJobOptions = {}
): Promise<ProcessJobResult> {
  const { scraperApiKeys = [], workerId: _workerId } = options;
  const fetchMode = fetchModeForSource(job.source);

  let previewResult;
  try {
    previewResult = await importPreview(job.canonical_url, { fetchMode, scraperApiKeys });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markImportJobFailed(db, job, `importPreview threw: ${msg}`);
    return { jobId: job.id, source: job.source, canonicalUrl: job.canonical_url, status: job.attempt_count >= job.max_attempts ? "dead" : "failed", error: msg };
  }

  const { fields } = previewResult;

  if (!fields.rent || !fields.beds || !fields.baths) {
    const missing = [!fields.rent && "rent", !fields.beds && "beds", !fields.baths && "baths"].filter(Boolean).join(", ");
    const err = `import failed: required fields missing (${missing})`;
    await markImportJobFailed(db, job, err);
    const finalStatus = job.attempt_count >= job.max_attempts ? "dead" : "failed";
    return { jobId: job.id, source: job.source, canonicalUrl: job.canonical_url, status: finalStatus, error: err };
  }

  let listingId: string;
  try {
    const saveResult = await saveListing(db, {
      canonical_url: job.canonical_url,
      source: job.source,
      source_listing_id: fields.source_listing_id ?? job.source_listing_id ?? null,
      title: fields.title ?? null,
      description: fields.description ?? null,
      address_text: fields.address_text ?? null,
      neighborhood: fields.neighborhood ?? null,
      borough: "Brooklyn",
      latitude: fields.latitude ?? null,
      longitude: fields.longitude ?? null,
      rent: fields.rent,
      beds: fields.beds,
      baths: fields.baths,
      sqft: fields.sqft ?? null,
      available_date: fields.available_date ?? null,
      fee_status: fields.fee_status ?? null,
      laundry: fields.laundry ?? null,
      dishwasher: fields.dishwasher ?? null,
      outdoor_space: fields.outdoor_space ?? null,
      pets: fields.pets ?? null,
      floor_number: fields.floor_number ?? null,
      elevator: fields.elevator ?? null,
      amenities: fields.amenities,
      image_urls: fields.image_urls,
    });
    listingId = saveResult.listingId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markImportJobFailed(db, job, `saveListing threw: ${msg}`);
    const finalStatus = job.attempt_count >= job.max_attempts ? "dead" : "failed";
    return { jobId: job.id, source: job.source, canonicalUrl: job.canonical_url, status: finalStatus, error: msg };
  }

  await markImportJobSucceeded(db, job);
  return { jobId: job.id, source: job.source, canonicalUrl: job.canonical_url, status: "succeeded", listingId };
}

export async function processNextImportJobs(
  db: D1Database,
  options: ProcessNextOptions = {}
): Promise<ProcessNextResult> {
  const { source, limit = 1, dryRun = true, scraperApiKeys = [], workerId } = options;

  if (dryRun) {
    const params: unknown[] = [];
    let sql = `select id, source, canonical_url, attempt_count, max_attempts
               from crawl_import_jobs
               where status = 'pending' and (next_attempt_at is null or next_attempt_at <= datetime('now'))`;
    if (source) { sql += " and source = ?"; params.push(source); }
    sql += " order by priority desc, created_at asc limit ?";
    params.push(limit);

    const rows = await db.prepare(sql).bind(...params).all<ImportJobRow>();
    return {
      dryRun: true,
      selectedJobs: rows.results.length,
      processedJobs: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      results: rows.results.map((j) => ({
        jobId: j.id,
        source: j.source,
        canonicalUrl: j.canonical_url,
        status: "pending" as const,
      })),
    };
  }

  const jobs = await claimPendingImportJobs(db, { source, limit });

  let succeeded = 0;
  let failed = 0;
  let dead = 0;
  const results: ProcessJobResult[] = [];

  for (const job of jobs) {
    const result = await processImportJob(db, job, { scraperApiKeys, workerId });
    results.push(result);
    if (result.status === "succeeded") succeeded++;
    else if (result.status === "dead") dead++;
    else failed++;
  }

  return {
    dryRun: false,
    selectedJobs: jobs.length,
    processedJobs: jobs.length,
    succeeded,
    failed,
    dead,
    results,
  };
}

export type ImportJobStats = {
  discoveredBySourceStatus: Record<string, Record<string, number>>;
  jobsBySourceStatus: Record<string, Record<string, number>>;
  recentCrawlRuns: Record<string, unknown>[];
  recentFailedJobs: Record<string, unknown>[];
};

export async function getImportJobStats(db: D1Database): Promise<ImportJobStats> {
  const [discoveredRows, jobRows, crawlRunRows, failedJobRows] = await Promise.all([
    db.prepare("select source, status, count(*) as count from crawl_discovered_urls group by source, status").all<{ source: string; status: string; count: number }>(),
    db.prepare("select source, status, count(*) as count from crawl_import_jobs group by source, status").all<{ source: string; status: string; count: number }>(),
    db.prepare("select id, source, target_id, status, started_at, finished_at, targets_completed, candidates_found, candidates_accepted from crawl_runs order by started_at desc limit 5").all<Record<string, unknown>>(),
    db.prepare("select id, source, canonical_url, status, attempt_count, last_error, updated_at from crawl_import_jobs where status in ('failed', 'dead') order by updated_at desc limit 5").all<Record<string, unknown>>(),
  ]);

  const discoveredBySourceStatus: Record<string, Record<string, number>> = {};
  for (const r of discoveredRows.results) {
    if (!discoveredBySourceStatus[r.source]) discoveredBySourceStatus[r.source] = {};
    discoveredBySourceStatus[r.source][r.status] = r.count;
  }

  const jobsBySourceStatus: Record<string, Record<string, number>> = {};
  for (const r of jobRows.results) {
    if (!jobsBySourceStatus[r.source]) jobsBySourceStatus[r.source] = {};
    jobsBySourceStatus[r.source][r.status] = r.count;
  }

  return {
    discoveredBySourceStatus,
    jobsBySourceStatus,
    recentCrawlRuns: crawlRunRows.results,
    recentFailedJobs: failedJobRows.results,
  };
}
