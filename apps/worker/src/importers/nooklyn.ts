import type { ExtractedFields } from "./types";
import { amenitiesFromSection, deriveAmenityFields, matchAmenityPhrases } from "./amenities";

const NOOKLYN_API_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface NooklynApiResult {
  fields: ExtractedFields;
  amenities: string[];
  warnings: string[];
  usable: boolean;
  httpStatus?: number;
  fieldsFound: number;
}

export function extractSlugFromNooklynUrl(url: string): string | null {
  try {
    const m = new URL(url).pathname.match(/\/listings?\/([\w-]+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function fetchNooklynApi(slug: string, referer: string): Promise<NooklynApiResult> {
  const warnings: string[] = ["nooklyn api parser used"];
  const apiUrl = `https://nooklyn.com/api/v2/listings.fetch?slug=${encodeURIComponent(slug)}`;

  let httpStatus: number | undefined;
  let raw: unknown;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": NOOKLYN_API_UA,
        Referer: referer,
        Origin: "https://nooklyn.com",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: controller.signal,
    });
    httpStatus = resp.status;
    if (!resp.ok) {
      warnings.push(`nooklyn api http ${resp.status}`);
      return { fields: {}, amenities: [], warnings, usable: false, httpStatus, fieldsFound: 0 };
    }
    raw = await resp.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`nooklyn api fetch error: ${msg}`);
    return { fields: {}, amenities: [], warnings, usable: false, httpStatus, fieldsFound: 0 };
  } finally {
    clearTimeout(timer);
  }

  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!obj) {
    warnings.push("nooklyn api: non-object response");
    return { fields: {}, amenities: [], warnings, usable: false, httpStatus, fieldsFound: 0 };
  }

  // response may be { listing: {...} } or the listing object directly
  const listing =
    "listing" in obj && obj.listing && typeof obj.listing === "object"
      ? (obj.listing as Record<string, unknown>)
      : obj;

  const fields: ExtractedFields = {};
  let fieldsFound = 0;

  if (listing.id != null) fields.source_listing_id = String(listing.id);

  if (typeof listing.price === "number" && listing.price > 0) {
    const rent = Math.round(listing.price / 100);
    if (rent >= 500 && rent <= 15_000) { fields.rent = rent; fieldsFound++; }
  }

  if (typeof listing.bedrooms === "number" && listing.bedrooms >= 0 && listing.bedrooms <= 10) {
    fields.beds = listing.bedrooms; fieldsFound++;
  }

  if (typeof listing.bathrooms === "number" && listing.bathrooms >= 0 && listing.bathrooms <= 10) {
    fields.baths = listing.bathrooms; fieldsFound++;
  } else if (typeof listing.full_baths === "number") {
    const half = typeof listing.half_baths === "number" ? listing.half_baths : 0;
    const baths = listing.full_baths + 0.5 * half;
    if (baths >= 0 && baths <= 10) { fields.baths = baths; fieldsFound++; }
  }

  if (typeof listing.square_feet === "number" && listing.square_feet >= 200 && listing.square_feet <= 10_000) {
    fields.sqft = listing.square_feet; fieldsFound++;
  }

  if (typeof listing.address === "string" && listing.address.trim()) {
    fields.address_text = listing.address.trim(); fieldsFound++;
  }

  const neigh = listing.neighborhood;
  if (neigh && typeof neigh === "object" && typeof (neigh as Record<string, unknown>).name === "string") {
    fields.neighborhood = ((neigh as Record<string, unknown>).name as string).trim(); fieldsFound++;
  } else if (typeof neigh === "string" && neigh.trim()) {
    fields.neighborhood = neigh.trim(); fieldsFound++;
  }

  if (typeof listing.description === "string" && listing.description.trim()) {
    fields.description = listing.description.trim();
  }

  if (typeof listing.latitude === "number" && typeof listing.longitude === "number") {
    const lat = listing.latitude, lng = listing.longitude;
    if (lat >= 40.0 && lat <= 41.5 && lng >= -75.0 && lng <= -73.0) {
      fields.latitude = lat; fields.longitude = lng; fieldsFound++;
    }
  }

  // listing-claimed transit (our enrichment from coords can still override later)
  if (typeof listing.station === "string" && listing.station.trim()) {
    fields.nearest_subway_station = listing.station.trim();
  }
  if (typeof listing.subway_line === "string" && listing.subway_line.trim()) {
    fields.nearest_subway_lines = listing.subway_line.trim();
  }

  if (typeof listing.pets === "string") {
    const p = listing.pets.toLowerCase();
    if (p.includes("no") || p === "false") fields.pets = "no pets";
    else if (p.length > 0) fields.pets = "allowed";
  }

  if (typeof listing.date_available === "string" && listing.date_available.trim()) {
    fields.available_date = listing.date_available.trim();
  }

  if (listing.no_fee === true) fields.fee_status = "no fee";

  // amenities: string with newline separators or array
  let rawAmenities: string[] = [];
  if (typeof listing.amenities === "string") {
    rawAmenities = listing.amenities
      .split(/[\r\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  } else if (Array.isArray(listing.amenities)) {
    rawAmenities = (listing.amenities as unknown[])
      .filter((a) => typeof a === "string")
      .map((a) => (a as string).trim().toLowerCase());
  }

  const amenities = matchAmenityPhrases(rawAmenities);
  deriveAmenityFields(amenities, fields);
  fields.amenities = amenities;

  const usable =
    fields.rent != null ||
    ((fields.beds != null || fields.baths != null) && (fields.address_text != null || fields.neighborhood != null));

  warnings.push(usable ? "nooklyn api fetch succeeded" : "nooklyn api response unusable");

  return { fields, amenities, warnings, usable, httpStatus, fieldsFound };
}

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function amenitiesFromJsonLd(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]) as Record<string, unknown>;
      const features = obj["amenityFeature"];
      if (Array.isArray(features)) {
        for (const f of features) {
          if (typeof f === "string") out.push(f.toLowerCase().trim());
          else if (f && typeof (f as Record<string, unknown>)["name"] === "string") {
            out.push(((f as Record<string, unknown>)["name"] as string).toLowerCase().trim());
          }
        }
      }
    } catch { /* skip */ }
  }
  return out;
}

function amenitiesFromScripts(html: string): string[] {
  const out: string[] = [];
  const re = /"(?:amenities|amenityList|features)"\s*:\s*\[([^\]]{0,2000})\]/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const items = m[1].match(/"([^"]{2,80})"/g);
    if (items) {
      for (const item of items) out.push(item.replace(/"/g, "").toLowerCase().trim());
    }
  }
  return out;
}

// extract nearest subway station from rendered transit section
// visible text pattern: "Morgan Av 0.30 mi Flushing Av 0.33 mi"
function extractTransit(text: string): string | undefined {
  const lower = text.toLowerCase();
  // find the subway section (after "subway" heading in the Transportation section)
  const subwayIdx = lower.search(/\btransportation\b|\bsubway\b/);
  if (subwayIdx === -1) return undefined;

  const section = text.slice(subwayIdx, subwayIdx + 1200);
  // match "StationName Av/St X.XX mi" — station names don't start with B followed by digits (bus lines)
  const stationRe = /(?:^|(?:mi\s+))(?!B\d)([A-Z][a-zA-Z-]+(?:\s+[A-Z][a-zA-Z-]+)*\s+(?:Av|Ave|St|Street|Avs|Avenue|Blvd|Pl|Sq|Pkwy))\s+([\d.]+)\s*mi/g;
  let m;
  let nearest: string | undefined;
  let nearestDist = Infinity;
  while ((m = stationRe.exec(section)) !== null) {
    const dist = parseFloat(m[2]);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = `${m[1].trim()} (${dist} mi)`;
    }
  }
  return nearest;
}

export interface NooklynExtractResult {
  fields: ExtractedFields;
  amenities: string[];
  warnings: string[];
  extractorsUsed: string[];
  debug: {
    nooklynDetailSignalsFound: number;
    amenitiesFoundCount: number;
    nooklynTransitText?: string;
  };
}

export function extractNooklynFields(args: { url: string; html: string }): NooklynExtractResult {
  const { url, html } = args;
  const text = toText(html);
  const fields: ExtractedFields = { canonical_url: url, source: "nooklyn" };
  const warnings: string[] = ["nooklyn parser used"];
  let signals = 0;

  // source_listing_id from URL: /listings/12345 or UUID-style slug
  const idM = url.match(/\/listings?\/([\w-]+)/i);
  if (idM) fields.source_listing_id = idM[1];

  // --- rent ---
  // rendered text shows "$3,042/Month" (capital M, no space)
  const rentPatterns = [
    /\$\s*([\d,]+)\s*\/\s*Month/i,
    /\$\s*([\d,]+)\s*\/\s*mo(?:nth)?/i,
  ];
  for (const re of rentPatterns) {
    const m = text.match(re);
    if (m) {
      const v = parseInt(m[1].replace(/,/g, ""), 10);
      if (v >= 500 && v <= 15_000) { fields.rent = v; signals++; break; }
    }
  }
  // html class-based fallback: class contains "price"
  if (!fields.rent) {
    const priceClassM = html.match(/class="[^"]*[Pp]rice[^"]*"[^>]*>\s*\$\s*([\d,]+)/);
    if (priceClassM) {
      const v = parseInt(priceClassM[1].replace(/,/g, ""), 10);
      if (v >= 500 && v <= 15_000) { fields.rent = v; signals++; }
    }
  }
  // json embedded price
  if (!fields.rent) {
    const jsonPriceM = html.match(/"(?:price|listingPrice|rent)"\s*:\s*(\d+)/);
    if (jsonPriceM) {
      const v = parseInt(jsonPriceM[1], 10);
      if (v >= 500 && v <= 15_000) { fields.rent = v; signals++; }
    }
  }
  if (fields.rent) {
    warnings.push("nooklyn rent found");
  } else {
    warnings.push("nooklyn rent not found");
  }

  // --- beds/baths ---
  // standard patterns
  const bedsM =
    text.match(/(\d+)\s+[Bb]ed(?:room)?s?\b/) ??
    text.match(/[Bb]ed(?:room)?s?:\s*(\d+)/) ??
    text.match(/(\d+)\s*BR\b/i);
  if (bedsM) {
    const v = parseInt(bedsM[1], 10);
    if (v >= 0 && v <= 10) { fields.beds = v; signals++; }
  }
  // nooklyn rendered UI shows "Unit 203 2 1 115 Stanwix St" — bare bed/bath numbers after unit
  if (fields.beds == null) {
    const unitM = text.match(/Unit\s+[\w-]+\s+(\d+)\s+(\d+)\s+\d/);
    if (unitM) {
      const b = parseInt(unitM[1], 10);
      const ba = parseInt(unitM[2], 10);
      if (b >= 0 && b <= 10) { fields.beds = b; signals++; }
      if (fields.baths == null && ba >= 0 && ba <= 10) { fields.baths = ba; signals++; }
    }
  }

  const bathsM =
    text.match(/([\d.]+)\s+[Bb]ath(?:room)?s?\b/) ??
    text.match(/[Bb]ath(?:room)?s?:\s*([\d.]+)/);
  if (bathsM) {
    const v = parseFloat(bathsM[1]);
    if (v >= 0 && v <= 10) { fields.baths = v; signals++; }
  }

  // --- sqft ---
  const sqftM =
    text.match(/([\d,]+)\s*sq\.?\s*ft\.?/i) ??
    text.match(/([\d,]+)\s*sqft/i);
  if (sqftM) {
    const v = parseInt(sqftM[1].replace(/,/g, ""), 10);
    if (v >= 200 && v <= 10_000) { fields.sqft = v; signals++; }
  }

  // --- address + neighborhood ---
  // json-ld
  const jsonLdAddrM = html.match(/"streetAddress"\s*:\s*"([^"]{5,120})"/);
  if (jsonLdAddrM) { fields.address_text = jsonLdAddrM[1]; signals++; }

  // breadcrumb: "Neighborhood / 123 Street St, Brooklyn, NY / Unit X"
  // rendered visible text shows: "Bushwick / 115 Stanwix St, Brooklyn, NY 11206, USA / Unit 203"
  if (!fields.neighborhood || !fields.address_text) {
    const crumbM = text.match(/([A-Z][a-zA-Z\s-]{2,30})\s*\/\s*(\d+[^/,]+(?:St|Ave|Rd|Ln|Blvd|Dr|Pl|Ct|Ter|Pkwy)[^/,]*)/i);
    if (crumbM) {
      const neighCandidate = crumbM[1].trim();
      const addrCandidate = crumbM[2].split(",")[0].trim(); // just the street part
      if (!fields.neighborhood && neighCandidate.length >= 3 && neighCandidate.length <= 40) {
        fields.neighborhood = neighCandidate;
        signals++;
      }
      if (!fields.address_text && addrCandidate.length >= 5) {
        fields.address_text = addrCandidate;
        signals++;
      }
    }
  }

  // h1 fallback for address
  if (!fields.address_text) {
    const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1M) {
      const h1 = h1M[1].replace(/<[^>]+>/g, "").trim();
      if (/^\d+/.test(h1) && h1.length > 5) { fields.address_text = h1; signals++; }
    }
  }

  // neighborhood from text
  if (!fields.neighborhood) {
    const neighM =
      text.match(/[Nn]eighborhood:\s*([A-Za-z][^\n,|.<>]{2,30})/) ??
      text.match(/"neighborhood"\s*:\s*"([^"]{2,40})"/);
    if (neighM) {
      const raw = neighM[1].trim();
      if (raw.length >= 2 && raw.length <= 40) { fields.neighborhood = raw; signals++; }
    }
  }

  // --- coordinates ---
  const latM = html.match(/"latitude"\s*:\s*([-\d.]+)/);
  const lngM = html.match(/"longitude"\s*:\s*([-\d.]+)/);
  if (latM && lngM) {
    const lat = parseFloat(latM[1]);
    const lng = parseFloat(lngM[1]);
    if (lat >= 40.0 && lat <= 41.5 && lng >= -75.0 && lng <= -73.0) {
      fields.latitude = lat;
      fields.longitude = lng;
      signals++;
    }
  }
  if (!fields.latitude) warnings.push("nooklyn coordinates not found");

  // --- available date ---
  const availM = text.match(/[Aa]vailable\s+(now|[\w]+\s+\d{1,2},?\s*\d{4}|[\w]+\s+\d{1,2})/i);
  if (availM) fields.available_date = availM[0].trim();

  // --- fee status ---
  if (/[Nn]o\s*(?:broker\s*)?fee/i.test(text)) {
    fields.fee_status = "no fee";
  } else if (/[Bb]roker\s*fee/i.test(text)) {
    fields.fee_status = "broker fee";
  }

  // --- amenities ---
  const rawFromJsonLd = amenitiesFromJsonLd(html);
  const rawFromScripts = amenitiesFromScripts(html);
  const fromSection = amenitiesFromSection(text);
  const fromStructured = matchAmenityPhrases([...rawFromJsonLd, ...rawFromScripts]);

  const amenitySet = new Set([...fromStructured, ...fromSection]);
  const amenities = [...amenitySet];

  if (amenities.length > 0) {
    warnings.push("nooklyn amenities found");
  } else {
    warnings.push("nooklyn amenities not found");
  }

  deriveAmenityFields(amenities, fields);
  fields.amenities = amenities;

  // --- transit (debug only — our enrichment is the authoritative source) ---
  const transitText = extractTransit(text);

  return {
    fields,
    amenities,
    warnings,
    extractorsUsed: ["nooklyn"],
    debug: {
      nooklynDetailSignalsFound: signals,
      amenitiesFoundCount: amenities.length,
      nooklynTransitText: transitText,
    },
  };
}
