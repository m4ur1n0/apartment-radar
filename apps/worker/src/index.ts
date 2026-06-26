import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { MiddlewareHandler } from "hono";
import { importPreview } from "./importers";
import { enrichListingLocation } from "./location/enrichListingLocation";
import { SUBWAY_STATIONS } from "./location/generatedSubwayStations";
import { geocodeAddress } from "./location/geocodeAddress";

type Env = {
  DB: D1Database;
  API_ADMIN_TOKEN?: string;
  SCRAPERAPI_KEY?: string;
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
});

const RatingSchema = z.object({
  user_name: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  decision: z.string().optional(),
  notes: z.string().optional(),
});

type ListingInput = z.infer<typeof ManualListingSchema>;

function clamp(v: number): number {
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
}

function calcDealScore(d: ListingInput): number {
  if (d.rent > 3000) return 0;
  let s = 50;
  if (d.rent <= 2600) s += 25;
  else if (d.rent <= 2800) s += 15;
  else if (d.rent <= 2900) s += 8;
  else s += 3;
  if (d.sqft) {
    const rps = d.rent / d.sqft;
    if (rps <= 3.0) s += 10;
    else if (rps <= 3.5) s += 5;
  }
  const fee = (d.fee_status ?? "").toLowerCase();
  if (fee.includes("no fee")) s += 10;
  else if (fee.includes("broker") || fee.includes("fee")) s -= 10;
  return clamp(s);
}

function calcSubwayScore(d: ListingInput): number {
  let s = 55;
  const lines = (d.nearest_subway_lines ?? "").toUpperCase();
  if (lines.includes("L")) s += 10;
  if (lines.includes("M")) s += 10;
  if (lines.includes("J")) s += 5;
  if (lines.includes("Z")) s += 5;
  const walk = d.subway_walk_minutes;
  if (walk !== undefined) {
    if (walk <= 5) s += 15;
    else if (walk <= 8) s += 10;
    else if (walk <= 12) s += 5;
    else if (walk <= 20) s -= 5;
    else s -= 15;
  }
  const commute = d.manhattan_commute_minutes;
  if (commute !== undefined) {
    if (commute <= 25) s += 10;
    else if (commute <= 35) s += 5;
    else if (commute > 45) s -= 10;
  }
  return clamp(s);
}

function calcLayoutScore(d: ListingInput): number {
  let s = 50;
  if (d.beds === 2) s += 15;
  if (d.baths >= 1.5) s += 5;
  if (d.sqft == null) {
    s -= 10;
  } else if (d.sqft >= 900) {
    s += 20;
  } else if (d.sqft >= 800) {
    s += 15;
  } else if (d.sqft >= 700) {
    s += 10;
  } else if (d.sqft < 600) {
    s -= 20;
  }
  const text = ((d.description ?? "") + " " + (d.title ?? "")).toLowerCase();
  if (text.includes("large living") || text.includes("spacious living")) s += 5;
  if (text.includes("eat-in kitchen") || text.includes("separate kitchen")) s += 5;
  if (text.includes("railroad")) s -= 15;
  if (text.includes("floorplan") || text.includes("floor plan")) s += 3;
  return clamp(s);
}

function calcNeighborhoodScore(d: ListingInput): number {
  let s = 50;
  const n = (d.neighborhood ?? "").toLowerCase();
  if (n.includes("ridgewood")) s += 30;
  else if (n.includes("bushwick")) s += 20;
  else if (n.includes("east williamsburg")) s += 15;
  else if (n.includes("bed-stuy") || n.includes("bed stuy") || n.includes("bedford")) s += 10;
  else if (n.includes("crown heights")) s += 5;
  return clamp(s);
}

function calcAmenitiesScore(d: ListingInput): number {
  let s = 50;
  const laundry = (d.laundry ?? "").toLowerCase();
  if (laundry.includes("in-unit") || laundry.includes("in unit")) s += 20;
  else if (laundry.length > 0) s += 10;
  if (d.dishwasher) s += 10;
  if (d.outdoor_space) s += 10;
  if (d.elevator) s += 5;
  return clamp(s);
}

function calcRiskScore(d: ListingInput): number {
  let s = 10;
  if (!d.sqft) s += 15;
  if (!d.address_text && d.latitude == null && d.longitude == null) s += 10;
  if (!d.available_date) s += 10;
  if (!d.fee_status) s += 10;
  if (!d.nearest_subway_station && !d.nearest_subway_lines) s += 10;
  const text = ((d.description ?? "") + " " + (d.title ?? "")).toLowerCase();
  if (text.includes("net effective")) s += 15;
  if (text.includes("flex")) s += 10;
  if (text.includes("railroad")) s += 15;
  if (d.rent < 2400) s += 15;
  return clamp(s);
}

interface Scores {
  fit_score: number;
  deal_score: number;
  urgency_score: number;
  risk_score: number;
}

function calcScores(d: ListingInput): Scores {
  const deal = calcDealScore(d);
  const subway = calcSubwayScore(d);
  const layout = calcLayoutScore(d);
  const neighborhood = calcNeighborhoodScore(d);
  const amenities = calcAmenitiesScore(d);
  const risk = calcRiskScore(d);

  const fit = clamp(
    0.3 * deal +
      0.2 * subway +
      0.2 * layout +
      0.15 * neighborhood +
      0.1 * (100 - risk) +
      0.05 * amenities
  );

  let urgency = fit;
  if (d.available_date?.includes("-09-")) urgency *= 1.1;
  if (deal >= 70 && subway >= 70) urgency += 5;

  return {
    fit_score: fit,
    deal_score: deal,
    urgency_score: clamp(urgency),
    risk_score: risk,
  };
}

function boolToInt(v: boolean | undefined | null): number | null {
  if (v == null) return null;
  return v ? 1 : 0;
}

app.get("/health", (c) => c.json({ ok: true, service: "apt-radar-api" }));

app.get("/listings", async (c) => {
  const status = c.req.query("status") ?? "active";
  const limitRaw = parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Math.min(isNaN(limitRaw) ? 50 : limitRaw, 100);

  const rows = await c.env.DB.prepare(
    `select * from listings where status = ? order by urgency_score desc, fit_score desc, created_at desc limit ?`
  )
    .bind(status, limit)
    .all();

  const listings = rows.results as Record<string, unknown>[];

  const listingIds = listings.map((l) => l.id as string);

  let estimatesByListing: Record<string, unknown[]> = {};
  if (listingIds.length > 0) {
    const placeholders = listingIds.map(() => "?").join(",");
    const estimateRows = await c.env.DB.prepare(
      `select * from listing_subway_estimates where listing_id in (${placeholders})
       order by estimated_walk_minutes asc`
    )
      .bind(...listingIds)
      .all();

    for (const e of estimateRows.results) {
      const row = e as Record<string, unknown>;
      const lid = row.listing_id as string;
      if (!estimatesByListing[lid]) estimatesByListing[lid] = [];
      if (estimatesByListing[lid].length < 5) estimatesByListing[lid].push(row);
    }
  }

  const enriched = listings.map((l) => ({
    ...l,
    subway_estimates: estimatesByListing[l.id as string] ?? [],
  }));

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

  // enrich subway proximity from coordinates if user didn't provide subway fields
  const enrichment = enrichListingLocation(
    { latitude: d.latitude, longitude: d.longitude, address_text: d.address_text },
    SUBWAY_STATIONS
  );

  const subwayStation = d.nearest_subway_station ?? enrichment.nearest_subway_station ?? null;
  const subwayLines = d.nearest_subway_lines ?? enrichment.nearest_subway_lines ?? null;
  const subwayWalk = d.subway_walk_minutes ?? enrichment.subway_walk_minutes ?? null;
  const subwayWalkSource = enrichment.subway_walk_source ?? null;
  const subwayWalkConfidence = enrichment.subway_walk_confidence ?? null;
  const mapsUrl = enrichment.google_maps_directions_url ?? null;

  const enrichedD: ListingInput = {
    ...d,
    nearest_subway_station: subwayStation ?? undefined,
    nearest_subway_lines: subwayLines ?? undefined,
    subway_walk_minutes: subwayWalk ?? undefined,
  };

  const scores = calcScores(enrichedD);
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `insert into listings (
      id, canonical_url, source, source_listing_id, title, description,
      address_text, neighborhood, borough, latitude, longitude,
      rent, beds, baths, sqft, available_date,
      nearest_subway_station, nearest_subway_lines, subway_walk_minutes, manhattan_commute_minutes,
      subway_walk_source, subway_walk_confidence, google_maps_directions_url,
      fee_status, laundry, dishwasher, outdoor_space, pets, floor_number, elevator,
      fit_score, deal_score, urgency_score, risk_score
    ) values (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
    on conflict(canonical_url) do update set
      source = excluded.source,
      source_listing_id = excluded.source_listing_id,
      title = excluded.title,
      description = excluded.description,
      address_text = excluded.address_text,
      neighborhood = excluded.neighborhood,
      borough = excluded.borough,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      rent = excluded.rent,
      beds = excluded.beds,
      baths = excluded.baths,
      sqft = excluded.sqft,
      available_date = excluded.available_date,
      nearest_subway_station = excluded.nearest_subway_station,
      nearest_subway_lines = excluded.nearest_subway_lines,
      subway_walk_minutes = excluded.subway_walk_minutes,
      manhattan_commute_minutes = excluded.manhattan_commute_minutes,
      subway_walk_source = excluded.subway_walk_source,
      subway_walk_confidence = excluded.subway_walk_confidence,
      google_maps_directions_url = excluded.google_maps_directions_url,
      fee_status = excluded.fee_status,
      laundry = excluded.laundry,
      dishwasher = excluded.dishwasher,
      outdoor_space = excluded.outdoor_space,
      pets = excluded.pets,
      floor_number = excluded.floor_number,
      elevator = excluded.elevator,
      fit_score = excluded.fit_score,
      deal_score = excluded.deal_score,
      urgency_score = excluded.urgency_score,
      risk_score = excluded.risk_score,
      last_seen_at = datetime('now'),
      updated_at = datetime('now')`
  )
    .bind(
      id, d.canonical_url, d.source, d.source_listing_id ?? null, d.title ?? null, d.description ?? null,
      d.address_text ?? null, d.neighborhood ?? null, d.borough, d.latitude ?? null, d.longitude ?? null,
      d.rent, d.beds, d.baths, d.sqft ?? null, d.available_date ?? null,
      subwayStation, subwayLines, subwayWalk, d.manhattan_commute_minutes ?? null,
      subwayWalkSource, subwayWalkConfidence, mapsUrl,
      d.fee_status ?? null, d.laundry ?? null, boolToInt(d.dishwasher), boolToInt(d.outdoor_space), d.pets ?? null, d.floor_number ?? null, boolToInt(d.elevator),
      scores.fit_score, scores.deal_score, scores.urgency_score, scores.risk_score
    )
    .run();

  const listing = await c.env.DB.prepare(
    `select * from listings where canonical_url = ?`
  )
    .bind(d.canonical_url)
    .first();

  const snapshotId = crypto.randomUUID();
  await c.env.DB.prepare(
    `insert into listing_snapshots (id, listing_id, rent, sqft, title, description, raw_json)
     values (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      snapshotId,
      (listing as Record<string, unknown>).id,
      d.rent,
      d.sqft ?? null,
      d.title ?? null,
      d.description ?? null,
      JSON.stringify(d)
    )
    .run();

  if (enrichment.subway_estimates.length > 0) {
    const listingId = (listing as Record<string, unknown>).id as string;
    const deleteStmt = c.env.DB.prepare(
      `delete from listing_subway_estimates where listing_id = ?`
    ).bind(listingId);
    const estimateStmts = enrichment.subway_estimates.map((e) =>
      c.env.DB.prepare(
        `insert into listing_subway_estimates
           (id, listing_id, station_id, station_name, lines, straight_line_miles,
            estimated_walk_minutes, estimate_method, confidence, google_maps_directions_url, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(),
        listingId,
        e.station_id,
        e.station_name,
        e.lines.join(","),
        e.straight_line_miles,
        e.estimated_walk_minutes,
        e.estimate_method,
        e.confidence,
        e.google_maps_directions_url
      )
    );
    await c.env.DB.batch([deleteStmt, ...estimateStmts]);
  }

  return c.json({ listing, enrichment_warnings: enrichment.warnings });
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
      fetchMode: z.enum(["direct", "scraperapi"]).optional().default("direct"),
    })
    .safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "url required" }, 400);
  }

  const { url, fetchMode } = parsed.data;

  if (fetchMode === "scraperapi" && !c.env.SCRAPERAPI_KEY) {
    return c.json({ error: "missing_scraperapi_key" }, 500);
  }

  const result = await importPreview(url, {
    fetchMode,
    scraperApiKey: c.env.SCRAPERAPI_KEY,
  });

  // if no coordinates from scrape, try geocoding the address
  if ((!result.fields.latitude || !result.fields.longitude) && result.fields.address_text) {
    const geo = await geocodeAddress(result.fields.address_text);
    if (geo) {
      result.fields.latitude = geo.latitude;
      result.fields.longitude = geo.longitude;
      result.warnings.push("coordinates from nominatim geocoder");
    }
  }

  // auto-enrich subway proximity if coordinates available but subway fields are missing
  if (
    result.fields.latitude &&
    result.fields.longitude &&
    !result.fields.nearest_subway_station
  ) {
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

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) {
    ctx.waitUntil(runScheduledCollection(env));
  },
};

async function runScheduledCollection(env: Env) {
  await env.DB.prepare(
    `insert into search_runs (source, status, started_at, finished_at, notes)
     values (?, ?, datetime('now'), datetime('now'), ?)`
  )
    .bind("manual-placeholder", "ok", "collector not implemented yet")
    .run();
}
