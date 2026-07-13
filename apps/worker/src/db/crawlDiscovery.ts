export type CrawlRunParams = {
  runType: string;
  source?: string;
  targetId?: string;
  targetsRequested: number;
};

export type CrawlRunFinishParams = {
  status: string;
  finishedAt: string;
  targetsCompleted: number;
  candidatesFound: number;
  candidatesAccepted: number;
  candidatesRejected: number;
  warningsJson?: string;
  errorMessage?: string;
};

export type DiscoveredCandidateParams = {
  source: string;
  targetId: string;
  crawlRunId: string;
  listingUrl: string;
  canonicalUrl: string;
  sourceListingId?: string;
  title?: string;
  price?: number;
  beds?: number;
  baths?: number;
  neighborhood?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  discoveryConfidence?: string;
};

export type UpsertResult = {
  inserted: boolean;
  id: string;
  canonicalUrl: string;
};

export type UpsertCandidatesResult = {
  inserted: number;
  updated: number;
  results: UpsertResult[];
};

export async function createCrawlRun(db: D1Database, params: CrawlRunParams): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `insert into crawl_runs (id, run_type, source, target_id, status, started_at, targets_requested, created_at, updated_at)
       values (?, ?, ?, ?, 'running', ?, ?, ?, ?)`
    )
    .bind(id, params.runType, params.source ?? null, params.targetId ?? null, now, params.targetsRequested, now, now)
    .run();
  return id;
}

export async function finishCrawlRun(db: D1Database, id: string, params: CrawlRunFinishParams): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `update crawl_runs set
         status = ?, finished_at = ?, targets_completed = ?, candidates_found = ?,
         candidates_accepted = ?, candidates_rejected = ?,
         warnings_json = ?, error_message = ?, updated_at = ?
       where id = ?`
    )
    .bind(
      params.status, params.finishedAt, params.targetsCompleted,
      params.candidatesFound, params.candidatesAccepted, params.candidatesRejected,
      params.warningsJson ?? null, params.errorMessage ?? null, now, id
    )
    .run();
}

export async function upsertDiscoveredCandidate(
  db: D1Database,
  params: DiscoveredCandidateParams
): Promise<UpsertResult> {
  const now = new Date().toISOString();
  let existing: { id: string } | null = null;

  if (params.sourceListingId) {
    existing = await db
      .prepare("select id from crawl_discovered_urls where source = ? and source_listing_id = ?")
      .bind(params.source, params.sourceListingId)
      .first<{ id: string }>();
  }

  if (!existing) {
    existing = await db
      .prepare("select id from crawl_discovered_urls where source = ? and canonical_url = ?")
      .bind(params.source, params.canonicalUrl)
      .first<{ id: string }>();
  }

  if (existing) {
    await db
      .prepare(
        `update crawl_discovered_urls set
           last_seen_at = ?,
           times_seen = times_seen + 1,
           title = coalesce(?, title),
           price = coalesce(?, price),
           beds = coalesce(?, beds),
           baths = coalesce(?, baths),
           neighborhood = coalesce(?, neighborhood),
           address = coalesce(?, address),
           latitude = coalesce(?, latitude),
           longitude = coalesce(?, longitude),
           source_listing_id = coalesce(?, source_listing_id),
           updated_at = ?
         where id = ?`
      )
      .bind(
        now,
        params.title ?? null, params.price ?? null,
        params.beds ?? null, params.baths ?? null,
        params.neighborhood ?? null, params.address ?? null,
        params.latitude ?? null, params.longitude ?? null,
        params.sourceListingId ?? null,
        now, existing.id
      )
      .run();
    return { inserted: false, id: existing.id, canonicalUrl: params.canonicalUrl };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `insert into crawl_discovered_urls (
         id, source, target_id, crawl_run_id, listing_url, canonical_url,
         source_listing_id, title, price, beds, baths, neighborhood, address,
         latitude, longitude, discovery_confidence,
         first_seen_at, last_seen_at, times_seen, status,
         created_at, updated_at
       ) values (
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?,
         ?, ?, 1, 'discovered',
         ?, ?
       )`
    )
    .bind(
      id, params.source, params.targetId, params.crawlRunId,
      params.listingUrl, params.canonicalUrl,
      params.sourceListingId ?? null, params.title ?? null,
      params.price ?? null, params.beds ?? null, params.baths ?? null,
      params.neighborhood ?? null, params.address ?? null,
      params.latitude ?? null, params.longitude ?? null,
      params.discoveryConfidence ?? null,
      now, now,
      now, now
    )
    .run();
  return { inserted: true, id, canonicalUrl: params.canonicalUrl };
}

export async function upsertDiscoveredCandidates(
  db: D1Database,
  candidates: DiscoveredCandidateParams[]
): Promise<UpsertCandidatesResult> {
  const results: UpsertResult[] = [];
  let inserted = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const r = await upsertDiscoveredCandidate(db, candidate);
    results.push(r);
    if (r.inserted) inserted++;
    else updated++;
  }

  return { inserted, updated, results };
}
