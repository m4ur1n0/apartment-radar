import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { MiddlewareHandler } from "hono";
import { importPreview } from "./importers";
import { enrichListingLocation } from "./location/enrichListingLocation";
import { SUBWAY_STATIONS } from "./location/generatedSubwayStations";
import { geocodeAddress } from "./location/geocodeAddress";
import { SEARCH_TARGETS, ENABLED_SEARCH_TARGETS } from "./crawler/searchTargets";
import { discoverListingUrlsForTarget } from "./crawler/discovery";
import {
  createCrawlRun,
  finishCrawlRun,
  upsertDiscoveredCandidates,
  type DiscoveredCandidateParams,
} from "./db/crawlDiscovery";
import { saveListing } from "./importers/saveListing";
import type { ListingFieldsForSave } from "./importers/saveListing";
import {
  enqueueImportJobsFromDiscoveredUrls,
  processNextImportJobs,
  getImportJobStats,
} from "./db/importJobs";
import { runScheduledCrawler } from "./crawler/scheduledCrawler";

type Env = {
  DB: D1Database;
  API_ADMIN_TOKEN?: string;
  SCRAPERAPI_KEY?: string;
  SCRAPERAPI_KEY_01?: string;
  SCRAPERAPI_KEY_02?: string;
  SCRAPERAPI_KEY_03?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "X-Admin-Token"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  })
);

const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const token = c.req.header("X-Admin-Token");
  if (!c.env.API_ADMIN_TOKEN || token !== c.env.API_ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

const ManualListingSchema = z.object({
  canonical_url: z.string().url(),
  source: z.string().min(1),
  source_listing_id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  address_text: z.string().optional(),
  neighborhood: z.string().optional(),
  borough: z.string().default("Brooklyn"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  rent: z.number().int().positive(),
  beds: z.number().positive(),
  baths: z.number().positive(),
  sqft: z.number().int().positive().optional(),
  available_date: z.string().optional(),
  nearest_subway_station: z.string().optional(),
  nearest_subway_lines: z.string().optional(),
  subway_walk_minutes: z.number().int().nonnegative().optional(),
  manhattan_commute_minutes: z.number().int().nonnegative().optional(),
  fee_status: z.string().optional(),
  laundry: z.string().optional(),
  dishwasher: z.boolean().optional(),
  outdoor_space: z.boolean().optional(),
  pets: z.string().optional(),
  floor_number: z.number().int().optional(),
  elevator: z.boolean().optional(),
  amenities: z.array(z.string()).optional(),
  image_urls: z.array(z.string().min(8).max(2000)).max(30).optional().default([]),
});

const RatingSchema = z.object({
  user_name: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  decision: z.string().optional(),
  notes: z.string().optional(),
});

type ListingInput = z.infer<typeof ManualListingSchema>;

app.get("/health", (c) => c.json({ ok: true, service: "apt-radar-api" }));

app.get("/subway-stations", (c) => {
  const stations = SUBWAY_STATIONS.map((s) => ({
    id: s.id,
    name: s.name,
    latitude: s.latitude,
    longitude: s.longitude,
    lines: s.lines,
    borough: s.borough,
  }));
  return c.json({ stations });
});

app.get("/listings", async (c) => {
  const status = c.req.query("status") ?? "active";
  const limitRaw = parseInt(c.req.query("limit") ?? "200", 10);
  const limit = Math.min(isNaN(limitRaw) ? 200 : limitRaw, 200);

  const rows = await c.env.DB.prepare(
    `select * from listings where status = ? and hidden_at is null order by urgency_score desc, fit_score desc, created_at desc limit ?`
  )
    .bind(status, limit)
    .all();

  const listings = rows.results as Record<string, unknown>[];
  const listingIds = listings.map((l) => l.id as string);

  let estimatesByListing: Record<string, unknown[]> = {};
  let photosByListing: Record<string, string[]> = {};
  let ratingsByListing: Record<string, unknown[]> = {};

  if (listingIds.length > 0) {
    const subquery = `select id from listings where status = ? and hidden_at is null order by urgency_score desc, fit_score desc, created_at desc limit ?`;

    const [estimateRows, photoRows, ratingRows] = await Promise.all([
      c.env.DB.prepare(
        `select * from listing_subway_estimates where listing_id in (${subquery}) order by estimated_walk_minutes asc`
      ).bind(status, limit).all(),
      c.env.DB.prepare(
        `select listing_id, source_url from listing_photos where listing_id in (${subquery}) order by listing_id, coalesce(position, 999) asc`
      ).bind(status, limit).all(),
      c.env.DB.prepare(
        `select listing_id, user_name, rating, notes, decision from user_ratings where listing_id in (${subquery}) order by listing_id, created_at desc`
      ).bind(status, limit).all(),
    ]);

    for (const e of estimateRows.results as Record<string, unknown>[]) {
      const lid = e.listing_id as string;
      if (!estimatesByListing[lid]) estimatesByListing[lid] = [];
      if (estimatesByListing[lid].length < 5) estimatesByListing[lid].push(e);
    }

    for (const row of photoRows.results as Record<string, unknown>[]) {
      const lid = row.listing_id as string;
      if (!photosByListing[lid]) photosByListing[lid] = [];
      if (photosByListing[lid].length < 10) photosByListing[lid].push(row.source_url as string);
    }

    // keep only the most recent rating per user per listing
    const seenUserForListing = new Set<string>();
    for (const row of ratingRows.results as Record<string, unknown>[]) {
      const lid = row.listing_id as string;
      const key = `${lid}:${row.user_name as string}`;
      if (seenUserForListing.has(key)) continue;
      seenUserForListing.add(key);
      if (!ratingsByListing[lid]) ratingsByListing[lid] = [];
      ratingsByListing[lid].push(row);
    }
  }

  const enriched = listings.map((l) => {
    let amenities: string[] = [];
    try {
      if (l.amenities_json) amenities = JSON.parse(l.amenities_json as string) as string[];
    } catch { /* ignore malformed */ }
    return {
      ...l,
      amenities,
      subway_estimates: estimatesByListing[l.id as string] ?? [],
      image_urls: photosByListing[l.id as string] ?? [],
      ratings: ratingsByListing[l.id as string] ?? [],
    };
  });

  return c.json({ listings: enriched });
});

app.post("/admin/seed-subway-stations", requireAdmin, async (c) => {
  const stmts = SUBWAY_STATIONS.map((s) =>
    c.env.DB.prepare(
      `insert into subway_stations (id, name, borough, latitude, longitude, lines, gtfs_stop_ids, created_at)
       values (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       on conflict(id) do update set
         name = excluded.name,
         borough = excluded.borough,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         lines = excluded.lines,
         gtfs_stop_ids = excluded.gtfs_stop_ids`
    ).bind(
      s.id,
      s.name,
      s.borough,
      s.latitude,
      s.longitude,
      s.lines.join(","),
      s.gtfs_stop_ids ?? null
    )
  );

  const batchSize = 50;
  let upserted = 0;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await c.env.DB.batch(stmts.slice(i, i + batchSize));
    upserted += Math.min(batchSize, stmts.length - i);
  }

  return c.json({ ok: true, upserted });
});

app.post("/listings/manual", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = ManualListingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
  }

  const d = parsed.data;

  const input: ListingFieldsForSave = {
    canonical_url: d.canonical_url,
    source: d.source,
    source_listing_id: d.source_listing_id ?? null,
    title: d.title ?? null,
    description: d.description ?? null,
    address_text: d.address_text ?? null,
    neighborhood: d.neighborhood ?? null,
    borough: d.borough,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    rent: d.rent,
    beds: d.beds,
    baths: d.baths,
    sqft: d.sqft ?? null,
    available_date: d.available_date ?? null,
    nearest_subway_station: d.nearest_subway_station ?? null,
    nearest_subway_lines: d.nearest_subway_lines ?? null,
    subway_walk_minutes: d.subway_walk_minutes ?? null,
    manhattan_commute_minutes: d.manhattan_commute_minutes ?? null,
    fee_status: d.fee_status ?? null,
    laundry: d.laundry ?? null,
    dishwasher: d.dishwasher ?? null,
    outdoor_space: d.outdoor_space ?? null,
    pets: d.pets ?? null,
    floor_number: d.floor_number ?? null,
    elevator: d.elevator ?? null,
    amenities: d.amenities,
    image_urls: d.image_urls,
  };

  const saveResult = await saveListing(c.env.DB, input);
  const listing = await c.env.DB.prepare("select * from listings where canonical_url = ?")
    .bind(d.canonical_url)
    .first();

  return c.json({ listing, enrichment_warnings: saveResult.enrichmentWarnings });
});

app.post("/listings/import-preview", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = z
    .object({
      url: z.string().url(),
      fetchMode: z.enum(["direct", "proxy"]).optional().default("direct"),
      debugText: z.boolean().optional().default(false),
      debugFetchProfiles: z.boolean().optional().default(false),
    })
    .safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "url required" }, 400);
  }

  const { url, fetchMode, debugText, debugFetchProfiles } = parsed.data;

  const scraperApiKeys = [
    c.env.SCRAPERAPI_KEY,
    c.env.SCRAPERAPI_KEY_01,
    c.env.SCRAPERAPI_KEY_02,
    c.env.SCRAPERAPI_KEY_03,
  ].filter((k): k is string => Boolean(k));

  if (fetchMode === "proxy" && scraperApiKeys.length === 0) {
    return c.json({ error: "missing_proxy_key" }, 500);
  }

  const result = await importPreview(url, {
    fetchMode,
    scraperApiKeys,
    debugText,
    debugFetchProfiles,
  });

  // geocode from address if no coords extracted from scrape
  if ((!result.fields.latitude || !result.fields.longitude) && result.fields.address_text) {
    const geo = await geocodeAddress(result.fields.address_text);
    if (geo) {
      result.fields.latitude = geo.latitude;
      result.fields.longitude = geo.longitude;
      result.warnings.push("coordinates from nominatim geocoder");
    }
  }

  // always compute subway proximity from our own data when coords are available
  if (result.fields.latitude && result.fields.longitude) {
    const enrichment = enrichListingLocation(
      { latitude: result.fields.latitude, longitude: result.fields.longitude },
      SUBWAY_STATIONS
    );
    if (enrichment.nearest_subway_station) {
      result.fields.nearest_subway_station = enrichment.nearest_subway_station;
      result.fields.nearest_subway_lines = enrichment.nearest_subway_lines;
      result.fields.subway_walk_minutes = enrichment.subway_walk_minutes;
      result.fields.subway_walk_source = enrichment.subway_walk_source;
      result.fields.subway_walk_confidence = enrichment.subway_walk_confidence;
      result.fields.google_maps_directions_url = enrichment.google_maps_directions_url;
      result.warnings.push(...enrichment.warnings);
    }
  }

  return c.json(result);
});

app.post("/admin/discovery-preview", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = z
    .object({
      targetId: z.string().optional(),
      targetIds: z.array(z.string()).min(1).max(3).optional(),
      limitTargets: z.number().int().min(1).max(3).optional(),
      source: z.enum(["craigslist", "nooklyn", "streeteasy", "zillow"]).optional(),
      priority: z.enum(["primary", "secondary", "fallback", "experimental"]).optional(),
      debugMode: z.boolean().optional().default(false),
      showRejected: z.boolean().optional().default(false),
      all: z.boolean().optional(),
    })
    .safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
  }

  const { targetId, targetIds: rawTargetIds, limitTargets, source, priority, debugMode, all } = parsed.data;

  if (all === true) {
    return c.json({ error: "all:true is disabled for HTTP preview; use targetIds or limitTargets" }, 400);
  }

  const targetIds = rawTargetIds ?? (targetId ? [targetId] : null);

  let targets: typeof SEARCH_TARGETS;
  if (targetIds) {
    targets = SEARCH_TARGETS.filter((t) => targetIds.includes(t.id));
    const missing = targetIds.filter((id) => !SEARCH_TARGETS.find((t) => t.id === id));
    if (missing.length > 0) {
      return c.json({ error: "unknown target ids", missing }, 400);
    }
    if (targets.length === 0) {
      return c.json({ error: "no matching targets found" }, 400);
    }
  } else {
    let pool = ENABLED_SEARCH_TARGETS as typeof SEARCH_TARGETS;
    if (source) pool = pool.filter((t) => t.source === source);
    if (priority) pool = pool.filter((t) => t.priority === priority);
    const n = limitTargets ?? 1;
    targets = pool.slice(0, n);
    if (targets.length === 0) {
      return c.json({ error: "no matching enabled targets", source, priority }, 400);
    }
  }

  const discoveryScraperKeys = [
    c.env.SCRAPERAPI_KEY,
    c.env.SCRAPERAPI_KEY_01,
    c.env.SCRAPERAPI_KEY_02,
    c.env.SCRAPERAPI_KEY_03,
  ].filter((k): k is string => Boolean(k));

  const BUDGET_MS = 45_000;
  const runStart = Date.now();
  const results = [];
  const warnings: string[] = [];

  for (const t of targets) {
    if (Date.now() - runStart > BUDGET_MS) {
      warnings.push("preview_time_budget_reached");
      break;
    }
    const result = await discoverListingUrlsForTarget(t, { debug: debugMode, scraperApiKeys: discoveryScraperKeys });
    results.push(result);
  }

  return c.json({
    discoveryImplementationVersion: "nooklyn-streeteasy-zillow-v1",
    targetsRequested: targets.length,
    targetsCompleted: results.length,
    ...(warnings.length > 0 && { warnings }),
    results,
  });
});

app.post("/listings/:id/ratings", requireAdmin, async (c) => {
  const listingId = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = RatingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
  }

  const d = parsed.data;
  const ratingId = crypto.randomUUID();

  await c.env.DB.prepare(
    `insert into user_ratings (id, listing_id, user_name, rating, decision, notes)
     values (?, ?, ?, ?, ?, ?)`
  )
    .bind(ratingId, listingId, d.user_name, d.rating, d.decision ?? null, d.notes ?? null)
    .run();

  return c.json({ ok: true });
});

app.post("/listings/:id/hide", requireAdmin, async (c) => {
  const listingId = c.req.param("id");

  let body: { hidden_by?: string; hidden_reason?: string } = {};
  try {
    body = await c.req.json();
  } catch { /* body is optional */ }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `update listings set hidden_at = ?, hidden_by = ?, hidden_reason = ?, updated_at = ? where id = ?`
  )
    .bind(now, body.hidden_by ?? null, body.hidden_reason ?? null, now, listingId)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "listing_not_found" }, 404);
  }

  return c.json({ ok: true });
});

app.get("/admin/crawler/status", requireAdmin, async (c) => {
  const [settingRow, jobRows, runRows] = await Promise.all([
    c.env.DB.prepare("select value from app_settings where key = 'crawler_enabled'")
      .first<{ value: string }>(),
    c.env.DB.prepare(
      "select source, status, count(*) as count from crawl_import_jobs group by source, status"
    ).all<{ source: string; status: string; count: number }>(),
    c.env.DB.prepare(
      `select id, source, target_id, status, started_at, finished_at, candidates_found, candidates_accepted
       from crawl_runs order by started_at desc limit 10`
    ).all<Record<string, unknown>>(),
  ]);

  const crawlerEnabled = settingRow?.value !== "false";

  const jobsByStatus: Record<string, number> = {};
  for (const r of jobRows.results) {
    jobsByStatus[r.status] = (jobsByStatus[r.status] ?? 0) + r.count;
  }

  return c.json({
    crawlerEnabled,
    pendingImportJobs: jobsByStatus["pending"] ?? 0,
    failedImportJobs: jobsByStatus["failed"] ?? 0,
    deadImportJobs: jobsByStatus["dead"] ?? 0,
    recentRuns: runRows.results,
  });
});

app.post("/admin/crawler/pause", requireAdmin, async (c) => {
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `insert into app_settings (key, value, updated_at) values ('crawler_enabled', 'false', ?)
     on conflict(key) do update set value = 'false', updated_at = excluded.updated_at`
  ).bind(now).run();
  return c.json({ ok: true, crawlerEnabled: false });
});

app.post("/admin/crawler/resume", requireAdmin, async (c) => {
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `insert into app_settings (key, value, updated_at) values ('crawler_enabled', 'true', ?)
     on conflict(key) do update set value = 'true', updated_at = excluded.updated_at`
  ).bind(now).run();
  return c.json({ ok: true, crawlerEnabled: true });
});

app.post("/admin/crawler/discover", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const schema = z.object({
    targetIds: z.array(z.string()).min(1).max(3),
    dryRun: z.boolean().optional().default(true),
    debugMode: z.boolean().optional().default(false),
    showRejected: z.boolean().optional().default(false),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
  }

  const { targetIds, dryRun, debugMode, showRejected } = parsed.data;

  const targets = SEARCH_TARGETS.filter((t) => targetIds.includes(t.id));
  const missing = targetIds.filter((id) => !SEARCH_TARGETS.find((t) => t.id === id));
  if (missing.length > 0) {
    return c.json({ error: "unknown target ids", missing }, 400);
  }
  if (targets.length === 0) {
    return c.json({ error: "no matching targets found" }, 400);
  }

  const scraperKeys = [
    c.env.SCRAPERAPI_KEY,
    c.env.SCRAPERAPI_KEY_01,
    c.env.SCRAPERAPI_KEY_02,
    c.env.SCRAPERAPI_KEY_03,
  ].filter((k): k is string => Boolean(k));

  const BUDGET_MS = 45_000;
  const runStart = Date.now();

  const crawlRunId = dryRun
    ? null
    : await createCrawlRun(c.env.DB, {
        runType: "discovery",
        source: targets.length === 1 ? targets[0].source : undefined,
        targetId: targets.length === 1 ? targets[0].id : undefined,
        targetsRequested: targets.length,
      });

  const perTargetResults: unknown[] = [];
  let totalCandidatesFound = 0;
  let totalRejected = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let completedTargets = 0;
  const allWarnings: string[] = [];

  for (const target of targets) {
    if (Date.now() - runStart > BUDGET_MS) {
      allWarnings.push("discovery_time_budget_reached");
      break;
    }

    const result = await discoverListingUrlsForTarget(target, {
      debug: debugMode,
      scraperApiKeys: scraperKeys,
    });

    completedTargets++;
    totalCandidatesFound += result.candidatesFound;
    totalRejected += result.rejected.length;
    if (result.warnings.length > 0) {
      allWarnings.push(...result.warnings.map((w) => `[${target.id}] ${w}`));
    }

    let inserted = 0;
    let updated = 0;
    const persistedUrls: string[] = [];

    if (!dryRun && crawlRunId && result.candidates.length > 0) {
      const candidateParams: DiscoveredCandidateParams[] = result.candidates.map((cand) => ({
        source: target.source,
        targetId: target.id,
        crawlRunId,
        listingUrl: cand.listingUrl,
        canonicalUrl: cand.canonicalUrl ?? cand.listingUrl,
        sourceListingId: cand.sourceListingId,
        title: cand.title,
        price: cand.price,
        beds: cand.beds,
        baths: cand.baths,
        neighborhood: cand.neighborhood,
        address: cand.address,
        latitude: cand.latitude,
        longitude: cand.longitude,
        discoveryConfidence: cand.confidence,
      }));

      const upsertResult = await upsertDiscoveredCandidates(c.env.DB, candidateParams);
      inserted = upsertResult.inserted;
      updated = upsertResult.updated;
      for (const r of upsertResult.results.slice(0, 3)) {
        persistedUrls.push(r.canonicalUrl);
      }
    }

    totalInserted += inserted;
    totalUpdated += updated;

    perTargetResults.push({
      targetId: target.id,
      source: target.source,
      candidatesFound: result.candidatesFound,
      candidatesRejected: result.rejected.length,
      ...(result.warnings.length > 0 && { warnings: result.warnings }),
      ...(showRejected && result.rejected.length > 0 && {
        rejected: (result.rejectedPreview ?? result.rejected).slice(0, 20),
      }),
      ...(!dryRun && {
        insertedCandidates: inserted,
        updatedCandidates: updated,
        persistedUrls,
      }),
      ...(debugMode && result.debug && { debug: result.debug }),
    });
  }

  if (!dryRun && crawlRunId) {
    await finishCrawlRun(c.env.DB, crawlRunId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      targetsCompleted: completedTargets,
      candidatesFound: totalCandidatesFound,
      candidatesAccepted: totalInserted + totalUpdated,
      candidatesRejected: totalRejected,
      warningsJson: allWarnings.length > 0 ? JSON.stringify(allWarnings) : undefined,
    });
  }

  return c.json({
    ok: true,
    dryRun,
    ...(crawlRunId && { crawlRunId }),
    targetsRequested: targets.length,
    targetsCompleted: completedTargets,
    persistedCandidates: totalInserted + totalUpdated,
    updatedCandidates: totalUpdated,
    insertedCandidates: totalInserted,
    ...(allWarnings.length > 0 && { warnings: allWarnings }),
    results: perTargetResults,
  });
});

app.post("/admin/crawler/enqueue-imports", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const schema = z.object({
    source: z.string().optional(),
    targetId: z.string().optional(),
    limit: z.number().int().min(1).max(25).optional().default(10),
    priority: z.number().int().optional().default(0),
    dryRun: z.boolean().optional().default(true),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
  }

  const { source, targetId, limit, priority, dryRun } = parsed.data;

  const result = await enqueueImportJobsFromDiscoveredUrls(c.env.DB, {
    source,
    targetId,
    limit,
    priority,
    dryRun,
  });

  return c.json({ ok: true, ...result });
});

app.post("/admin/crawler/import-next", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const schema = z.object({
    source: z.string().optional(),
    limit: z.number().int().min(1).max(5).optional().default(1),
    dryRun: z.boolean().optional().default(true),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
  }

  const { source, limit, dryRun } = parsed.data;

  const scraperApiKeys = [
    c.env.SCRAPERAPI_KEY,
    c.env.SCRAPERAPI_KEY_01,
    c.env.SCRAPERAPI_KEY_02,
    c.env.SCRAPERAPI_KEY_03,
  ].filter((k): k is string => Boolean(k));

  const result = await processNextImportJobs(c.env.DB, {
    source,
    limit,
    dryRun,
    scraperApiKeys,
  });

  return c.json({ ok: true, ...result });
});

app.get("/admin/crawler/stats", requireAdmin, async (c) => {
  const stats = await getImportJobStats(c.env.DB);
  return c.json({ ok: true, ...stats });
});

app.post("/admin/crawler/run-once", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const schema = z.object({
    dryRun: z.boolean().optional().default(true),
    maxDiscoveryTargets: z.number().int().min(1).max(3).optional().default(1),
    maxEnqueueJobs: z.number().int().min(0).max(25).optional().default(3),
    maxImportJobs: z.number().int().min(0).max(5).optional().default(1),
    source: z.string().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
  }

  const { dryRun, maxDiscoveryTargets, maxEnqueueJobs, maxImportJobs, source } = parsed.data;

  const scraperApiKeys = [
    c.env.SCRAPERAPI_KEY,
    c.env.SCRAPERAPI_KEY_01,
    c.env.SCRAPERAPI_KEY_02,
    c.env.SCRAPERAPI_KEY_03,
  ].filter((k): k is string => Boolean(k));

  const result = await runScheduledCrawler(c.env, undefined, {
    mode: "manual",
    dryRun,
    maxDiscoveryTargets,
    maxEnqueueJobs,
    maxImportJobs,
    source,
    scraperApiKeys,
  });

  return c.json(result);
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) {
    ctx.waitUntil(
      runScheduledCrawler(env, ctx, {
        mode: "scheduled",
        dryRun: false,
        maxDiscoveryTargets: 2,
        maxEnqueueJobs: 10,
        maxImportJobs: 3,
      })
    );
  },
};
