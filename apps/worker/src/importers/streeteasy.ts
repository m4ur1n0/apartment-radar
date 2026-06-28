import type { ExtractedFields } from "./types";
import { amenitiesFromSection, deriveAmenityFields, matchAmenityPhrases } from "./amenities";

export interface StreetEasyExtractResult {
  fields: ExtractedFields;
  warnings: string[];
  extractorsUsed: string[];
  debug: {
    streeteasyJsonLdScriptsFound: number;
    streeteasyEmbeddedJsonCandidatesFound: number;
    streeteasyBlockedSignalsFound: number;
    amenitiesFoundCount: number;
  };
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

function countBlockedSignals(html: string): number {
  let count = 0;
  if (html.length < 5000) count++;
  const head = html.slice(0, 3000).toLowerCase();
  if (/enable javascript/i.test(head)) count++;
  if (/access denied/i.test(head)) count++;
  if (/robot|captcha/i.test(head)) count++;
  if (/cf-browser-verification|just a moment/i.test(head)) count++;
  return count;
}

function extractListingId(url: string): string | undefined {
  const patterns = [
    /\/listing[s]?\/(\d+)/i,
    /\/rental\/(\d+)/i,
    /\/for-rent\/[\w/-]+\/(\d+)/i,
    /[?&]id=(\d+)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return undefined;
}

function getMeta(attr: string, html: string): string | undefined {
  const pats = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${attr}["'][^>]+content=["']([^"']{1,500})["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]+(?:name|property)=["']${attr}["']`, "i"),
  ];
  for (const re of pats) {
    const m = html.match(re);
    if (m) return m[1].trim();
  }
  return undefined;
}

function parseJsonLdBlocks(html: string): { blocks: Record<string, unknown>[]; count: number } {
  const blocks: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const v = JSON.parse(m[1].trim()) as unknown;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object") blocks.push(item as Record<string, unknown>);
        }
      } else if (v && typeof v === "object") {
        blocks.push(v as Record<string, unknown>);
      }
    } catch { /* skip */ }
  }
  return { blocks, count: blocks.length };
}

function fillFromJsonLd(blocks: Record<string, unknown>[], fields: ExtractedFields, warnings: string[]): void {
  if (!blocks.length) return;
  warnings.push("streeteasy json-ld parser used");

  for (const b of blocks) {
    if (!fields.title && typeof b.name === "string" && b.name.trim()) {
      fields.title = b.name.trim();
    }
    if (!fields.description && typeof b.description === "string" && b.description.trim()) {
      fields.description = b.description.trim();
    }

    // price from offers or direct
    if (!fields.rent) {
      const offers = b.offers as Record<string, unknown> | undefined;
      const rawPrice = offers?.price ?? b.price;
      if (typeof rawPrice === "number" && rawPrice >= 500 && rawPrice <= 15_000) {
        fields.rent = rawPrice;
      } else if (typeof rawPrice === "string" && !/[KkMm]/.test(rawPrice)) {
        const v = parseInt(rawPrice.replace(/[^0-9]/g, ""), 10);
        if (v >= 500 && v <= 15_000) fields.rent = v;
      }
    }

    // address
    const addr = b.address as Record<string, unknown> | string | undefined;
    if (!fields.address_text) {
      if (typeof addr === "string" && addr.trim()) {
        fields.address_text = addr.trim();
      } else if (addr && typeof addr === "object") {
        const street = (addr as Record<string, unknown>).streetAddress;
        if (typeof street === "string" && street.trim()) fields.address_text = street.trim();
      }
    }
    if (!fields.neighborhood && addr && typeof addr === "object") {
      const loc = (addr as Record<string, unknown>).addressLocality;
      if (typeof loc === "string" && loc.trim()) fields.neighborhood = loc.trim();
    }

    // coordinates
    if (!fields.latitude || !fields.longitude) {
      const geo = b.geo as Record<string, unknown> | undefined;
      if (geo) {
        const lat = typeof geo.latitude === "number" ? geo.latitude : parseFloat(String(geo.latitude ?? ""));
        const lng = typeof geo.longitude === "number" ? geo.longitude : parseFloat(String(geo.longitude ?? ""));
        if (!isNaN(lat) && !isNaN(lng) && lat >= 40.0 && lat <= 41.5 && lng >= -75.0 && lng <= -73.0) {
          fields.latitude = lat;
          fields.longitude = lng;
        }
      }
    }

    // beds/baths/sqft
    if (fields.beds == null) {
      const beds = b.numberOfBedrooms ?? b.numberOfRooms;
      if (typeof beds === "number" && beds >= 0 && beds <= 10) fields.beds = beds;
    }
    if (fields.baths == null && typeof b.numberOfBathroomsTotal === "number") {
      if (b.numberOfBathroomsTotal >= 0 && b.numberOfBathroomsTotal <= 10) fields.baths = b.numberOfBathroomsTotal;
    }
    const fs = b.floorSize as Record<string, unknown> | undefined;
    if (!fields.sqft && fs && typeof fs.value === "number" && fs.value >= 200 && fs.value <= 10_000) {
      fields.sqft = fs.value;
    }

    // amenities from JSON-LD amenityFeature
    if (!fields.amenities) {
      const features = b.amenityFeature;
      if (Array.isArray(features)) {
        const raw: string[] = [];
        for (const f of features) {
          if (typeof f === "string") raw.push(f.toLowerCase().trim());
          else if (f && typeof (f as Record<string, unknown>).name === "string") {
            raw.push(((f as Record<string, unknown>).name as string).toLowerCase().trim());
          }
        }
        if (raw.length > 0) {
          const normalized = matchAmenityPhrases(raw);
          if (normalized.length > 0) fields.amenities = normalized;
        }
      }
    }
  }
}

// try to extract a listing-shaped object from the Next.js __NEXT_DATA__ blob
function tryNextData(html: string): Record<string, unknown> | null {
  const m =
    html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]{1,500000}?)<\/script>/i) ??
    html.match(/<script[^>]+type=["']application\/json["'][^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]{1,500000}?)<\/script>/i);
  if (!m) return null;

  try {
    const root = JSON.parse(m[1]) as Record<string, unknown>;
    const pageProps = ((root.props as Record<string, unknown>)?.pageProps ?? {}) as Record<string, unknown>;
    // try common StreetEasy data paths
    const listing =
      pageProps.listing ??
      (pageProps.initialData as Record<string, unknown> | undefined)?.listing ??
      (pageProps.data as Record<string, unknown> | undefined)?.listing ??
      pageProps.rentalUnit ??
      pageProps.subject ??
      pageProps.unit;
    return listing && typeof listing === "object" ? (listing as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// try to find a listing JSON blob in inline scripts (fallback for non-Next.js embeds)
function tryInlineScriptJson(html: string): { obj: Record<string, unknown> | null; count: number } {
  let count = 0;
  const scriptRe = /<script(?:\s[^>]*)?>([\s\S]{50,100000}?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    const content = sm[1];
    if (!content.includes('"price"') && !content.includes('"rent"') && !content.includes('"bedrooms"') && !content.includes('"beds"')) continue;

    // look for a JSON object that resembles a listing
    const patterns = [
      /"(?:listing|rentalUnit|subject|unit)"\s*:\s*(\{[\s\S]{30,5000}?\})\s*(?:,|})/,
      /window\.__listing\s*=\s*(\{[\s\S]{30,5000}?\});/,
    ];
    for (const pat of patterns) {
      const lm = content.match(pat);
      if (lm) {
        count++;
        try {
          return { obj: JSON.parse(lm[1]) as Record<string, unknown>, count };
        } catch { /* try next */ }
      }
    }
  }
  return { obj: null, count };
}

function fillFromListingObj(obj: Record<string, unknown>, fields: ExtractedFields): void {
  if (!fields.source_listing_id) {
    const id = obj.id ?? obj.listingId ?? obj.listing_id;
    if (id != null) fields.source_listing_id = String(id);
  }

  // price — StreetEasy uses dollars
  if (!fields.rent) {
    const raw = obj.price ?? obj.rent ?? obj.listPrice ?? obj.asking_price;
    if (typeof raw === "number" && raw >= 500 && raw <= 15_000) {
      fields.rent = raw;
    } else if (typeof raw === "string" && !/[KkMm]/.test(raw)) {
      const v = parseInt(raw.replace(/[,$\s]/g, ""), 10);
      if (v >= 500 && v <= 15_000) fields.rent = v;
    }
  }

  if (fields.beds == null) {
    const b = obj.beds ?? obj.bedrooms ?? obj.numberOfBedrooms;
    if (typeof b === "number" && b >= 0 && b <= 10) fields.beds = b;
    else if (typeof b === "string") {
      const v = parseInt(b, 10);
      if (!isNaN(v) && v >= 0 && v <= 10) fields.beds = v;
    }
  }

  if (fields.baths == null) {
    const ba = obj.baths ?? obj.bathrooms ?? obj.numberOfBathrooms ?? obj.numberOfBathroomsTotal;
    if (typeof ba === "number" && ba >= 0 && ba <= 10) fields.baths = ba;
  }

  if (!fields.sqft) {
    const s = obj.sqft ?? obj.squareFeet ?? obj.square_feet ?? obj.sqFt ?? obj.size;
    if (typeof s === "number" && s >= 200 && s <= 10_000) fields.sqft = s;
  }

  if (!fields.address_text) {
    const a = obj.address ?? obj.streetAddress ?? obj.street_address ?? obj.fullAddress;
    if (typeof a === "string" && a.trim()) fields.address_text = a.trim();
  }

  if (!fields.neighborhood) {
    const n = obj.neighborhood ?? obj.neighborhoodName ?? obj.neighborhood_name;
    if (typeof n === "string" && n.trim()) fields.neighborhood = n.trim();
    else if (n && typeof n === "object") {
      const name = (n as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) fields.neighborhood = name.trim();
    }
  }

  if (!fields.description) {
    const d = obj.description ?? obj.fullDescription ?? obj.full_description;
    if (typeof d === "string" && d.trim()) fields.description = d.trim();
  }

  if (!fields.latitude || !fields.longitude) {
    const lat = typeof obj.latitude === "number" ? obj.latitude : parseFloat(String(obj.latitude ?? ""));
    const lng = typeof obj.longitude === "number" ? obj.longitude : parseFloat(String(obj.longitude ?? ""));
    if (!isNaN(lat) && !isNaN(lng) && lat >= 40.0 && lat <= 41.5 && lng >= -75.0 && lng <= -73.0) {
      fields.latitude = lat;
      fields.longitude = lng;
    }
  }

  if (!fields.fee_status) {
    const noFee = obj.noFee ?? obj.no_fee ?? obj.isNoFee;
    if (noFee === true || noFee === 1 || noFee === "true") fields.fee_status = "no fee";
  }

  if (!fields.available_date) {
    const avail = obj.dateAvailable ?? obj.date_available ?? obj.availableDate ?? obj.available_date;
    if (typeof avail === "string" && avail.trim()) fields.available_date = avail.trim();
  }

  if (fields.floor_number == null) {
    const floor = obj.floorNumber ?? obj.floor_number ?? obj.floor;
    if (typeof floor === "number" && floor >= 1 && floor <= 100) fields.floor_number = floor;
  }

  // amenities array embedded in listing object
  if (!fields.amenities) {
    const ams = obj.amenities ?? obj.amenityList ?? obj.features;
    if (Array.isArray(ams)) {
      const raw = (ams as unknown[])
        .filter((a) => typeof a === "string")
        .map((a) => (a as string).toLowerCase().trim());
      const normalized = matchAmenityPhrases(raw);
      if (normalized.length > 0) fields.amenities = normalized;
    }
  }
}

function fillFromMeta(html: string, fields: ExtractedFields): void {
  if (!fields.title) {
    const t = getMeta("og:title", html) ?? getMeta("twitter:title", html);
    if (t) fields.title = t;
  }
  if (!fields.description) {
    const d = getMeta("og:description", html) ?? getMeta("description", html);
    if (d) fields.description = d;
  }
  if (!fields.rent) {
    const p = getMeta("og:price:amount", html);
    if (p) {
      const v = parseInt(p.replace(/[,$\s]/g, ""), 10);
      if (v >= 500 && v <= 15_000) fields.rent = v;
    }
  }
}

function fillFromVisibleText(text: string, fields: ExtractedFields, warnings: string[]): void {
  let usedText = false;

  if (!fields.rent) {
    // (?![KkMm]) rejects amounts like $625K (blog/sale links) before they reach the range check
    const strictM =
      text.match(/\$([\d,]+)(?![KkMm\d])\s*\/\s*(?:mo(?:nth)?)\b/i) ??
      text.match(/(?:monthly\s+rent|asking|listed\s+at)[:\s]+\$([\d,]+)(?![KkMm\d])/i) ??
      text.match(/\$([\d,]+)(?![KkMm\d])\s+per\s+month/i);
    if (strictM) {
      const v = parseInt((strictM[1] ?? strictM[2] ?? "0").replace(/,/g, ""), 10);
      if (v >= 500 && v <= 15_000) { fields.rent = v; usedText = true; }
    }
    // broader fallback: first dollar amount in the plausible rent range, not followed by K/M
    if (!fields.rent) {
      for (const m of text.matchAll(/\$([\d,]+)(?![KkMm\d])/g)) {
        const v = parseInt(m[1].replace(/,/g, ""), 10);
        if (v >= 500 && v <= 15_000) { fields.rent = v; usedText = true; break; }
      }
    }
  }

  if (fields.beds == null) {
    const m = text.match(/\b(\d+)\s+(?:bed(?:room)?s?|BR)\b/i) ?? text.match(/\bStudio\b/i);
    if (m) {
      if (/studio/i.test(m[0])) { fields.beds = 0; usedText = true; }
      else {
        const v = parseInt((m as RegExpMatchArray)[1], 10);
        if (v >= 0 && v <= 10) { fields.beds = v; usedText = true; }
      }
    }
  }

  if (fields.baths == null) {
    const m = text.match(/\b([\d.]+)\s+bath(?:room)?s?\b/i);
    if (m) {
      const v = parseFloat(m[1]);
      if (v >= 0 && v <= 10) { fields.baths = v; usedText = true; }
    }
  }

  if (!fields.sqft) {
    const m = text.match(/([\d,]+)\s*(?:ft[²2]|sq\.?\s*ft\.?|sqft)\b/i);
    if (m) {
      const v = parseInt(m[1].replace(/,/g, ""), 10);
      if (v >= 200 && v <= 10_000) fields.sqft = v;
    }
  }

  if (!fields.fee_status) {
    if (/\bno\s+fee\b/i.test(text)) fields.fee_status = "no fee";
    else if (/\bbroker\s+fee\b/i.test(text)) fields.fee_status = "broker fee";
  }

  if (!fields.available_date) {
    const m = text.match(/[Aa]vailable\s+(now|[\w]+\s+\d{1,2},?\s*\d{4}|[\w]+\s+\d{1,2})/i);
    if (m) fields.available_date = m[0].trim();
  }

  if (usedText) warnings.push("streeteasy visible text parser used");
}

// parse amenities directly from raw HTML using StreetEasy's data-testid structure.
// works even when the visible-text scan misses (section cut off by smartSlice, wrong order, etc.)
function extractAmenitiesFromRawHtml(html: string): string[] {
  // any element with data-testid containing "amenities" anchors the section
  const startIdx = html.search(/data-testid=["'][^"']*amenities[^"']*["']/i);
  if (startIdx === -1) return [];

  const section = html.slice(startIdx, startIdx + 10_000);

  // collect text from the first <p> inside each <li>
  const items: string[] = [];
  const liRe = /<li[^>]*>[\s\S]{0,300}?<p[^>]*>([^<]{2,80})<\/p>/gi;
  let m;
  while ((m = liRe.exec(section)) !== null) {
    items.push(m[1].toLowerCase().trim());
  }

  return matchAmenityPhrases(items);
}

export function extractStreetEasyFields(args: { url: string; html: string }): StreetEasyExtractResult {
  const { url, html } = args;
  const fields: ExtractedFields = { canonical_url: url, source: "streeteasy" };
  const warnings: string[] = ["streeteasy parser used"];
  const extractorsUsed: string[] = ["streeteasy"];

  const listingId = extractListingId(url);
  if (listingId) fields.source_listing_id = listingId;

  const blockedCount = countBlockedSignals(html);
  if (blockedCount > 0) warnings.push("streeteasy response appears blocked");

  // 1. JSON-LD
  const { blocks, count: jsonLdCount } = parseJsonLdBlocks(html);
  fillFromJsonLd(blocks, fields, warnings);

  // 2. __NEXT_DATA__ (Next.js state blob)
  let embeddedCount = 0;
  const nextListing = tryNextData(html);
  if (nextListing) {
    embeddedCount++;
    fillFromListingObj(nextListing, fields);
    warnings.push("streeteasy embedded script parser used");
  }

  // 3. inline script JSON fallback
  if (!fields.rent || fields.beds == null) {
    const { obj: inlineObj, count } = tryInlineScriptJson(html);
    embeddedCount += count;
    if (inlineObj) {
      fillFromListingObj(inlineObj, fields);
      if (!warnings.includes("streeteasy embedded script parser used")) {
        warnings.push("streeteasy embedded script parser used");
      }
    }
  }

  // 4. OG/meta
  fillFromMeta(html, fields);

  // 5. visible text
  const text = toText(html);
  fillFromVisibleText(text, fields, warnings);

  // 6. amenities: raw HTML first (more reliable), then visible-text fallback
  let amenities = fields.amenities ?? [];
  if (!amenities.length) {
    amenities = extractAmenitiesFromRawHtml(html);
  }
  if (!amenities.length) {
    amenities = amenitiesFromSection(text);
  }
  if (amenities.length > 0) {
    fields.amenities = amenities;
    deriveAmenityFields(amenities, fields);
    warnings.push("streeteasy amenities found");
  } else {
    warnings.push("streeteasy amenities not found");
  }

  // 7. address fallback: strip "| StreetEasy" from title — every SE title encodes the address
  if (!fields.address_text && fields.title) {
    const stripped = fields.title.replace(/\s*\|\s*streeteasy\s*$/i, "").trim();
    if (stripped.length > 5) fields.address_text = stripped;
  }

  if (!fields.rent) warnings.push("streeteasy rent not found");
  if (fields.beds == null) warnings.push("streeteasy beds not found");
  if (fields.baths == null) warnings.push("streeteasy baths not found");
  if (!fields.address_text) warnings.push("streeteasy address not found");

  return {
    fields,
    warnings,
    extractorsUsed,
    debug: {
      streeteasyJsonLdScriptsFound: jsonLdCount,
      streeteasyEmbeddedJsonCandidatesFound: embeddedCount,
      streeteasyBlockedSignalsFound: blockedCount,
      amenitiesFoundCount: amenities.length,
    },
  };
}
