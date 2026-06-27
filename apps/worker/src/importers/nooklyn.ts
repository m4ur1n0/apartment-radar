import type { ExtractedFields } from "./types";

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

// ordered specific → general to prefer longer matches
const AMENITY_PHRASES = [
  "in-unit laundry",
  "washer/dryer in unit",
  "w/d in unit",
  "laundry in building",
  "laundry in basement",
  "common laundry",
  "coin-operated laundry",
  "dishwasher",
  "microwave",
  "stainless steel appliances",
  "hardwood floors",
  "high ceilings",
  "exposed brick",
  "pre-war",
  "renovated",
  "central air",
  "air conditioning",
  "elevator",
  "doorman",
  "virtual doorman",
  "video intercom",
  "live-in super",
  "concierge",
  "gym",
  "fitness center",
  "roof deck",
  "rooftop",
  "balcony",
  "patio",
  "backyard",
  "outdoor space",
  "bike storage",
  "storage",
  "package room",
  "pets allowed",
  "cats allowed",
  "dogs allowed",
  "cat friendly",
  "dog friendly",
  "cats ok",
  "dogs ok",
  "no pets",
  "guarantors accepted",
  "no fee",
  "broker fee",
];

// canonical display forms for common aliases
function normalizeAmenity(phrase: string): string {
  const aliases: Record<string, string> = {
    "washer/dryer in unit": "in-unit laundry",
    "w/d in unit": "in-unit laundry",
    "laundry in basement": "laundry in building",
    "common laundry": "laundry in building",
    "coin-operated laundry": "laundry in building",
    "fitness center": "gym",
    "rooftop": "roof deck",
    "cats allowed": "cat friendly",
    "dogs allowed": "dog friendly",
    "cats ok": "cat friendly",
    "dogs ok": "dog friendly",
    "stainless steel appliances": "stainless appliances",
  };
  return aliases[phrase] ?? phrase;
}

// extract amenities from json-ld amenityFeature arrays
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

// extract amenities from script blobs: "amenities":["Dishwasher","..."]
function amenitiesFromScripts(html: string): string[] {
  const out: string[] = [];
  const re = /"(?:amenities|amenityList|features)"\s*:\s*\[([^\]]{0,2000})\]/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const items = m[1].match(/"([^"]{2,80})"/g);
    if (items) {
      for (const item of items) {
        out.push(item.replace(/"/g, "").toLowerCase().trim());
      }
    }
  }
  return out;
}

// find amenity phrases scoped to a visible "Amenities" section in the stripped text
function amenitiesFromSection(text: string): string[] {
  const lower = text.toLowerCase();
  const idx = lower.search(
    /\bamenities\b|\bapartment\s+amenities\b|\bbuilding\s+amenities\b|\bbuilding\s+features\b|\bapartment\s+features\b/
  );
  if (idx === -1) return [];

  // scan up to 1500 chars after the heading
  const section = lower.slice(idx, idx + 1500);
  const found: string[] = [];
  for (const phrase of AMENITY_PHRASES) {
    if (section.includes(phrase)) {
      const canonical = normalizeAmenity(phrase);
      if (!found.includes(canonical)) found.push(canonical);
    }
  }
  return found;
}

function matchAmenityPhrases(raw: string[]): string[] {
  const out = new Set<string>();
  for (const a of raw) {
    for (const phrase of AMENITY_PHRASES) {
      if (a.includes(phrase) || phrase === a) {
        out.add(normalizeAmenity(phrase));
        break;
      }
    }
  }
  return [...out];
}

export interface NooklynExtractResult {
  fields: ExtractedFields;
  amenities: string[];
  warnings: string[];
  extractorsUsed: string[];
  debug: {
    nooklynDetailSignalsFound: number;
    amenitiesFoundCount: number;
  };
}

export function extractNooklynFields(args: { url: string; html: string }): NooklynExtractResult {
  const { url, html } = args;
  const text = toText(html);
  const fields: ExtractedFields = { canonical_url: url, source: "nooklyn" };
  const warnings: string[] = ["nooklyn parser used"];
  let signals = 0;

  // source_listing_id from URL: /listings/12345 or /listings/12345-slug
  const idM = url.match(/\/listings?\/(\d+)/i);
  if (idM) fields.source_listing_id = idM[1];

  // --- rent ---
  // Nooklyn shows "$3,000/Month" (capital M) or "$3,000 / Month"
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
  // html class-based fallback: class contains "price" and has $DIGITS nearby
  if (!fields.rent) {
    const priceClassM = html.match(/class="[^"]*[Pp]rice[^"]*"[^>]*>\s*\$\s*([\d,]+)/);
    if (priceClassM) {
      const v = parseInt(priceClassM[1].replace(/,/g, ""), 10);
      if (v >= 500 && v <= 15_000) { fields.rent = v; signals++; }
    }
  }
  // json-ld price
  if (!fields.rent) {
    const priceJsonM = html.match(/"(?:price|listingPrice|rent)"\s*:\s*(\d+)/);
    if (priceJsonM) {
      const v = parseInt(priceJsonM[1], 10);
      if (v >= 500 && v <= 15_000) { fields.rent = v; signals++; }
    }
  }
  if (!fields.rent) warnings.push("nooklyn rent not found");

  // --- beds ---
  const bedsM =
    text.match(/(\d+)\s+[Bb]ed(?:room)?s?\b/) ??
    text.match(/[Bb]ed(?:room)?s?:\s*(\d+)/) ??
    text.match(/(\d+)\s*BR\b/i) ??
    text.match(/"bedrooms?"\s*:\s*(\d+)/i);
  if (bedsM) {
    const v = parseInt(bedsM[1], 10);
    if (v >= 0 && v <= 10) { fields.beds = v; signals++; }
  }

  // --- baths ---
  const bathsM =
    text.match(/([\d.]+)\s+[Bb]ath(?:room)?s?\b/) ??
    text.match(/[Bb]ath(?:room)?s?:\s*([\d.]+)/) ??
    text.match(/"bathrooms?"\s*:\s*([\d.]+)/i);
  if (bathsM) {
    const v = parseFloat(bathsM[1]);
    if (v >= 0 && v <= 10) { fields.baths = v; signals++; }
  }

  // --- sqft ---
  const sqftM =
    text.match(/([\d,]+)\s*sq\.?\s*ft\.?/i) ??
    text.match(/([\d,]+)\s*sqft/i) ??
    text.match(/"(?:squareFeet|sqft|livingArea)"\s*:\s*(\d+)/i);
  if (sqftM) {
    const v = parseInt(sqftM[1].replace(/,/g, ""), 10);
    if (v >= 200 && v <= 10_000) { fields.sqft = v; signals++; }
  }

  // --- address ---
  const jsonLdAddrM = html.match(/"streetAddress"\s*:\s*"([^"]{5,120})"/);
  if (jsonLdAddrM) { fields.address_text = jsonLdAddrM[1]; signals++; }

  if (!fields.address_text) {
    const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1M) {
      const h1 = h1M[1].replace(/<[^>]+>/g, "").trim();
      if (/^\d+/.test(h1) && h1.length > 5) { fields.address_text = h1; signals++; }
    }
  }

  // --- neighborhood ---
  const neighM =
    text.match(/[Nn]eighborhood:\s*([A-Za-z][^\n,|.<>]{2,30})/) ??
    text.match(/"neighborhood"\s*:\s*"([^"]{2,40})"/) ??
    text.match(/[Ii]n\s+([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)?),\s*(?:Brooklyn|Queens|Manhattan|Bronx|Staten Island)/);
  if (neighM) {
    const raw = neighM[1].trim();
    if (raw.length >= 2 && raw.length <= 40) { fields.neighborhood = raw; signals++; }
  }

  // neighborhood from url slug as fallback: /listings/123-bushwick-brooklyn
  if (!fields.neighborhood) {
    const urlSlugM = url.match(/\/listings\/\d+-([a-z]+(?:-[a-z]+)*?)(?:-brooklyn|-queens|-manhattan|-bronx|-staten-island)?(?:\/|$)/i);
    if (urlSlugM) {
      const slug = urlSlugM[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      if (slug.length >= 3 && slug.length <= 40) fields.neighborhood = slug;
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

  // match structured sources against known phrases
  const fromStructured = matchAmenityPhrases([...rawFromJsonLd, ...rawFromScripts]);

  // merge, dedupe
  const amenitySet = new Set([...fromStructured, ...fromSection]);
  const amenities = [...amenitySet];

  if (amenities.length > 0) {
    warnings.push("nooklyn parser found amenities");
  } else {
    warnings.push("nooklyn amenities not found");
  }

  // derive fields from amenities
  if (!fields.laundry) {
    if (amenities.includes("in-unit laundry")) fields.laundry = "in-unit";
    else if (amenities.includes("laundry in building")) fields.laundry = "in building";
  }
  if (!fields.dishwasher && amenities.includes("dishwasher")) fields.dishwasher = true;
  if (!fields.outdoor_space) {
    const outdoorTerms = ["balcony", "patio", "backyard", "roof deck", "outdoor space"];
    if (outdoorTerms.some((t) => amenities.includes(t))) fields.outdoor_space = true;
  }
  if (!fields.pets) {
    if (amenities.includes("pets allowed") || amenities.includes("cat friendly") || amenities.includes("dog friendly")) {
      fields.pets = "allowed";
    } else if (amenities.includes("no pets")) {
      fields.pets = "no pets";
    }
  }
  if (!fields.fee_status && amenities.includes("no fee")) fields.fee_status = "no fee";
  if (amenities.includes("elevator")) fields.elevator = true;

  fields.amenities = amenities;

  return {
    fields,
    amenities,
    warnings,
    extractorsUsed: ["nooklyn"],
    debug: {
      nooklynDetailSignalsFound: signals,
      amenitiesFoundCount: amenities.length,
    },
  };
}
