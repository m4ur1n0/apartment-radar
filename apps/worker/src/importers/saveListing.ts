import { enrichListingLocation } from "../location/enrichListingLocation";
import { SUBWAY_STATIONS } from "../location/generatedSubwayStations";
import { geocodeAddress } from "../location/geocodeAddress";

export type ListingFieldsForSave = {
  canonical_url: string;
  source: string;
  source_listing_id?: string | null;
  title?: string | null;
  description?: string | null;
  address_text?: string | null;
  neighborhood?: string | null;
  borough: string;
  latitude?: number | null;
  longitude?: number | null;
  rent: number;
  beds: number;
  baths: number;
  sqft?: number | null;
  available_date?: string | null;
  nearest_subway_station?: string | null;
  nearest_subway_lines?: string | null;
  subway_walk_minutes?: number | null;
  manhattan_commute_minutes?: number | null;
  fee_status?: string | null;
  laundry?: string | null;
  dishwasher?: boolean | null;
  outdoor_space?: boolean | null;
  pets?: string | null;
  floor_number?: number | null;
  elevator?: boolean | null;
  amenities?: string[];
  image_urls?: string[];
};

export type SaveListingResult = {
  listingId: string;
  enrichmentWarnings: string[];
};

export function boolToInt(v: boolean | undefined | null): number | null {
  if (v == null) return null;
  return v ? 1 : 0;
}

function clamp(v: number): number {
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
}

function calcDealScore(d: ListingFieldsForSave): number {
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

function calcSubwayScore(d: ListingFieldsForSave): number {
  let s = 55;
  const lines = (d.nearest_subway_lines ?? "").toUpperCase();
  if (lines.includes("L")) s += 10;
  if (lines.includes("M")) s += 10;
  if (lines.includes("J")) s += 5;
  if (lines.includes("Z")) s += 5;
  const walk = d.subway_walk_minutes;
  if (walk != null) {
    if (walk <= 5) s += 15;
    else if (walk <= 8) s += 10;
    else if (walk <= 12) s += 5;
    else if (walk <= 20) s -= 5;
    else s -= 15;
  }
  const commute = d.manhattan_commute_minutes;
  if (commute != null) {
    if (commute <= 25) s += 10;
    else if (commute <= 35) s += 5;
    else if (commute > 45) s -= 10;
  }
  return clamp(s);
}

function calcLayoutScore(d: ListingFieldsForSave): number {
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

function calcNeighborhoodScore(d: ListingFieldsForSave): number {
  let s = 50;
  const n = (d.neighborhood ?? "").toLowerCase();
  if (n.includes("ridgewood")) s += 30;
  else if (n.includes("bushwick")) s += 20;
  else if (n.includes("east williamsburg")) s += 15;
  else if (n.includes("bed-stuy") || n.includes("bed stuy") || n.includes("bedford")) s += 10;
  else if (n.includes("crown heights")) s += 5;
  return clamp(s);
}

function calcAmenitiesScore(d: ListingFieldsForSave): number {
  let s = 50;
  const laundry = (d.laundry ?? "").toLowerCase();
  if (laundry.includes("in-unit") || laundry.includes("in unit")) s += 20;
  else if (laundry.length > 0) s += 10;
  if (d.dishwasher) s += 10;
  if (d.outdoor_space) s += 10;
  if (d.elevator) s += 5;
  return clamp(s);
}

function calcRiskScore(d: ListingFieldsForSave): number {
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

export interface ListingScores {
  fit_score: number;
  deal_score: number;
  urgency_score: number;
  risk_score: number;
}

export function calcScores(d: ListingFieldsForSave): ListingScores {
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

export async function saveListing(db: D1Database, d: ListingFieldsForSave): Promise<SaveListingResult> {
  const enrichmentWarnings: string[] = [];

  let resolvedLat = d.latitude ?? null;
  let resolvedLng = d.longitude ?? null;
  if ((resolvedLat == null || resolvedLng == null) && d.address_text) {
    const geo = await geocodeAddress(d.address_text);
    if (geo) {
      resolvedLat = geo.latitude;
      resolvedLng = geo.longitude;
      enrichmentWarnings.push("coordinates from nominatim geocoder");
    }
  }

  const enrichment = enrichListingLocation(
    { latitude: resolvedLat ?? undefined, longitude: resolvedLng ?? undefined },
    SUBWAY_STATIONS
  );

  const subwayStation = d.nearest_subway_station ?? enrichment.nearest_subway_station ?? null;
  const subwayLines = d.nearest_subway_lines ?? enrichment.nearest_subway_lines ?? null;
  const subwayWalk = d.subway_walk_minutes ?? enrichment.subway_walk_minutes ?? null;
  const subwayWalkSource = enrichment.subway_walk_source ?? null;
  const subwayWalkConfidence = enrichment.subway_walk_confidence ?? null;
  const mapsUrl = enrichment.google_maps_directions_url ?? null;

  enrichmentWarnings.push(...enrichment.warnings);

  const enrichedD: ListingFieldsForSave = {
    ...d,
    nearest_subway_station: subwayStation ?? undefined,
    nearest_subway_lines: subwayLines ?? undefined,
    subway_walk_minutes: subwayWalk ?? undefined,
  };

  const scores = calcScores(enrichedD);
  const id = crypto.randomUUID();
  const amenitiesJson = d.amenities?.length ? JSON.stringify(d.amenities) : null;

  await db
    .prepare(
      `insert into listings (
        id, canonical_url, source, source_listing_id, title, description,
        address_text, neighborhood, borough, latitude, longitude,
        rent, beds, baths, sqft, available_date,
        nearest_subway_station, nearest_subway_lines, subway_walk_minutes, manhattan_commute_minutes,
        subway_walk_source, subway_walk_confidence, google_maps_directions_url,
        fee_status, laundry, dishwasher, outdoor_space, pets, floor_number, elevator,
        amenities_json,
        fit_score, deal_score, urgency_score, risk_score
      ) values (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?,
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
        amenities_json = excluded.amenities_json,
        fit_score = excluded.fit_score,
        deal_score = excluded.deal_score,
        urgency_score = excluded.urgency_score,
        risk_score = excluded.risk_score,
        last_seen_at = datetime('now'),
        updated_at = datetime('now')`
    )
    .bind(
      id, d.canonical_url, d.source, d.source_listing_id ?? null, d.title ?? null, d.description ?? null,
      d.address_text ?? null, d.neighborhood ?? null, d.borough, resolvedLat, resolvedLng,
      d.rent, d.beds, d.baths, d.sqft ?? null, d.available_date ?? null,
      subwayStation, subwayLines, subwayWalk, d.manhattan_commute_minutes ?? null,
      subwayWalkSource, subwayWalkConfidence, mapsUrl,
      d.fee_status ?? null, d.laundry ?? null, boolToInt(d.dishwasher), boolToInt(d.outdoor_space),
      d.pets ?? null, d.floor_number ?? null, boolToInt(d.elevator),
      amenitiesJson,
      scores.fit_score, scores.deal_score, scores.urgency_score, scores.risk_score
    )
    .run();

  const saved = await db
    .prepare("select id from listings where canonical_url = ?")
    .bind(d.canonical_url)
    .first<{ id: string }>();
  const listingId = saved?.id ?? id;

  const snapshotId = crypto.randomUUID();
  await db
    .prepare(
      `insert into listing_snapshots (id, listing_id, rent, sqft, title, description, raw_json)
       values (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(snapshotId, listingId, d.rent, d.sqft ?? null, d.title ?? null, d.description ?? null, JSON.stringify(d))
    .run();

  if (d.image_urls && d.image_urls.length > 0) {
    try {
      const photoStmts = d.image_urls.slice(0, 30).map((url, i) =>
        db
          .prepare(
            `insert or ignore into listing_photos (id, listing_id, source_url, source, position)
             values (?, ?, ?, ?, ?)`
          )
          .bind(crypto.randomUUID(), listingId, url, d.source, i)
      );
      if (photoStmts.length > 0) await db.batch(photoStmts);
    } catch { /* don't fail listing save if photo insert fails */ }
  }

  if (enrichment.subway_estimates.length > 0) {
    const deleteStmt = db
      .prepare("delete from listing_subway_estimates where listing_id = ?")
      .bind(listingId);
    const estimateStmts = enrichment.subway_estimates.map((e) =>
      db
        .prepare(
          `insert into listing_subway_estimates
             (id, listing_id, station_id, station_name, lines, straight_line_miles,
              estimated_walk_minutes, estimate_method, confidence, google_maps_directions_url, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .bind(
          crypto.randomUUID(), listingId, e.station_id, e.station_name, e.lines.join(","),
          e.straight_line_miles, e.estimated_walk_minutes, e.estimate_method,
          e.confidence, e.google_maps_directions_url
        )
    );
    await db.batch([deleteStmt, ...estimateStmts]);
  }

  return { listingId, enrichmentWarnings };
}
