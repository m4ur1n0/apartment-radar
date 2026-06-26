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

function innerText(tagContent: string): string {
  return tagContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// --- detail-page text parser ---

function parseDetailText(text: string): {
  fields: ExtractedFields;
  signalsFound: number;
  warnings: string[];
} {
  const fields: ExtractedFields = {};
  const warnings: string[] = [];
  let signals = 0;

  // rent: "$2,400/mo", "$2,400 /mo", "$2,400+/mo"
  const rentM = text.match(/\$\s*([\d,]+)\+?\s*\/\s*mo/i);
  if (rentM) {
    const v = parseInt(rentM[1].replace(",", ""), 10);
    if (v >= 500 && v <= 15_000) { fields.rent = v; signals++; }
  }

  // beds: "2 bds", "2 bd", "2 beds", "2 bed", "Bedrooms: 2"
  const bedsM =
    text.match(/[Bb]edrooms?:\s*(\d+)/) ??
    text.match(/(\d+)\s+(?:bds?|beds?)\b/i);
  if (bedsM) {
    const v = parseInt(bedsM[1], 10);
    if (v >= 0 && v <= 10) { fields.beds = v; signals++; }
  }

  // baths: "1 ba", "1 bath", "1 baths", "1.5 ba", "Bathrooms: 1", "Full bathrooms: 1"
  const bathsM =
    text.match(/(?:Full\s+)?[Bb]athrooms?:\s*([\d.]+)/) ??
    text.match(/([\d.]+)\s+(?:ba|baths?)\b/i);
  if (bathsM) {
    const v = parseFloat(bathsM[1]);
    if (v >= 0 && v <= 10) { fields.baths = v; signals++; }
  }

  // sqft — "--sqft" or "– sqft" means unknown
  if (/--\s*sqft|–\s*sqft/i.test(text)) {
    warnings.push("sqft unavailable on zillow page");
  } else {
    const sqftM =
      text.match(/([\d,]+)\s*sq\.?\s*ft\.?/i) ??
      text.match(/([\d,]+)\s*sqft/i);
    if (sqftM) {
      const v = parseInt(sqftM[1].replace(",", ""), 10);
      if (v >= 200 && v <= 10_000) { fields.sqft = v; signals++; }
    }
  }

  // neighborhood — cap at 30 chars and stop at nav/carousel words
  const neighM =
    text.match(/[Nn]eighborhood:\s*([^\n,|.]{2,30})/) ??
    text.match(/[Rr]egion:\s*([^\n,|.]{2,30})/);
  if (neighM) {
    const raw = neighM[1].trim().split(/\s+(?:Skip|Nearby|carousel|apartment)/i)[0].trim();
    if (raw.length >= 2) { fields.neighborhood = raw; signals++; }
  }

  // available date/status
  const availM = text.match(/Available\s+(now|[\w]+\s+\d{1,2},?\s*\d{4}|[\w]+\s+\d{1,2})/i);
  if (availM) { fields.available_date = availM[0].trim(); signals++; }

  // fee status
  if (/[Ff]ees?\s+may\s+apply/.test(text)) {
    fields.fee_status = "fees may apply";
  } else if (/[Nn]o\s*(?:broker\s*)?fee/.test(text)) {
    fields.fee_status = "no fee";
  } else if (/[Bb]roker\s*fee/.test(text)) {
    fields.fee_status = "broker fee";
  }

  // amenities
  if (/dishwasher/i.test(text)) fields.dishwasher = true;
  if (/in.unit\s+laundry|washer.dryer\s+in\s+unit/i.test(text)) {
    fields.laundry = "in-unit";
  } else if (/laundry\s+in\s+(?:building|basement)|shared\s+laundry/i.test(text)) {
    fields.laundry = "in building";
  }
  if (/outdoor\s+space|balcon[yi]|patio|roof\s+(?:deck|access)|backyard/i.test(text)) {
    fields.outdoor_space = true;
  }
  if (/pets?\s+(?:ok|allowed|welcome)|cats?\s+ok|dogs?\s+ok/i.test(text)) {
    fields.pets = "allowed";
  } else if (/no\s+pets?|pets?\s+not\s+allowed/i.test(text)) {
    fields.pets = "no pets";
  }

  // description: text after "What's special"
  const specialM = text.match(/What[''s\s]+special\s+(.{20,500}?)(?=\s+Facts\s|\s+What\s|$)/is);
  if (specialM) fields.description = specialM[1].trim();

  return { fields, signalsFound: signals, warnings };
}

// --- regex-based extraction from raw script text (no JSON.parse needed) ---
// this is a lightweight fallback for when the JSON is too big or malformed

function extractFromScriptText(content: string): Partial<ExtractedFields> {
  const f: Partial<ExtractedFields> = {};

  // "bedrooms":2 or "bedsCount":2
  const beds = content.match(/"(?:bedrooms|bedsCount|beds)"\s*:\s*(\d+)/);
  if (beds) {
    const v = parseInt(beds[1], 10);
    if (v >= 0 && v <= 10) f.beds = v;
  }

  // "bathrooms":1 or "bathsCount":1 or "bathsFull":1
  const baths = content.match(/"(?:bathrooms|bathsCount|bathsFull|baths)"\s*:\s*([\d.]+)/);
  if (baths) {
    const v = parseFloat(baths[1]);
    if (v >= 0 && v <= 10) f.baths = v;
  }

  // "price":2400 or "listingPrice":2400 — must be in rent range
  const price = content.match(/"(?:price|listingPrice|unformattedPrice|rent)"\s*:\s*(\d+)/);
  if (price) {
    const v = parseInt(price[1], 10);
    if (v >= 500 && v <= 15_000) f.rent = v;
  }

  // "livingArea":800 or "sqft":800
  const area = content.match(/"(?:livingArea|sqft|floorSize)"\s*:\s*(\d+)/);
  if (area) {
    const v = parseInt(area[1], 10);
    if (v >= 200 && v <= 10_000) f.sqft = v;
  }

  // "streetAddress":"123 Main St"
  const addr = content.match(/"streetAddress"\s*:\s*"([^"]{5,120})"/);
  if (addr) f.address_text = addr[1];

  // "description":"..."
  const desc = content.match(/"(?:description|homeDescription)"\s*:\s*"([^"]{20,})"/);
  if (desc) f.description = desc[1].slice(0, 500);

  // "latitude":40.xxx, "longitude":-73.xxx
  const lat = content.match(/"latitude"\s*:\s*([-\d.]+)/);
  if (lat) {
    const v = parseFloat(lat[1]);
    if (v >= 40.0 && v <= 41.5) f.latitude = v;
  }
  const lng = content.match(/"longitude"\s*:\s*([-\d.]+)/);
  if (lng) {
    const v = parseFloat(lng[1]);
    if (v >= -75.0 && v <= -73.0) f.longitude = v;
  }

  return f;
}

// --- embedded JSON/script parser ---

function findDeep(obj: unknown, keys: string[], depth = 0): unknown {
  if (depth > 8 || !obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    if (k in o && o[k] != null) return o[k];
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const found = findDeep(v, keys, depth + 1);
      if (found != null) return found;
    }
  }
  return undefined;
}

function mergeJsonFields(obj: unknown, fields: ExtractedFields): void {
  const price = findDeep(obj, ["price", "listingPrice", "unformattedPrice"]);
  if (!fields.rent) {
    if (typeof price === "number" && price >= 500 && price <= 15_000) fields.rent = price;
    else if (typeof price === "string") {
      const pv = parseInt(price.replace(/[^0-9]/g, ""), 10);
      if (pv >= 500 && pv <= 15_000) fields.rent = pv;
    }
  }

  const beds = findDeep(obj, ["bedrooms", "bedsCount", "beds"]);
  if (!fields.beds && typeof beds === "number" && beds >= 0 && beds <= 10) fields.beds = beds;

  const baths = findDeep(obj, ["bathrooms", "bathsCount", "bathsFull", "baths"]);
  if (!fields.baths && typeof baths === "number" && baths >= 0 && baths <= 10) fields.baths = baths;

  const area = findDeep(obj, ["livingArea", "lotSize"]);
  if (!fields.sqft && typeof area === "number" && area >= 200 && area <= 10_000) fields.sqft = area;

  const addr = findDeep(obj, ["streetAddress", "address", "fullAddress"]);
  if (!fields.address_text && typeof addr === "string" && addr.trim()) {
    fields.address_text = addr.trim();
  }

  const desc = findDeep(obj, ["description", "homeDescription"]);
  if (!fields.description && typeof desc === "string" && desc.trim()) {
    fields.description = desc.trim().slice(0, 500);
  }

  const avail = findDeep(obj, ["datePosted", "availability", "availableDate"]);
  if (!fields.available_date && typeof avail === "string" && avail.trim()) {
    fields.available_date = avail.trim();
  }

  const lat = findDeep(obj, ["latitude", "lat"]);
  if (!fields.latitude && typeof lat === "number" && lat >= 40.0 && lat <= 41.5) {
    fields.latitude = lat;
  }
  const lng = findDeep(obj, ["longitude", "lng", "lon"]);
  if (!fields.longitude && typeof lng === "number" && lng >= -75.0 && lng <= -73.0) {
    fields.longitude = lng;
  }
}

function parseEmbeddedJson(html: string): {
  fields: ExtractedFields;
  scriptsFound: number;
} {
  const fields: ExtractedFields = {};
  let scriptsFound = 0;

  // first pass: application/json scripts (Next.js __NEXT_DATA__, etc.)
  // these are pure JSON — no brace-counting needed, just JSON.parse the full content
  const jsonScriptRe = /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm;
  while ((jm = jsonScriptRe.exec(html)) !== null) {
    const content = jm[1].trim();
    if (!/bedrooms|bathrooms|livingArea|listingPrice|bedsCount|bathsCount/i.test(content)) continue;
    try {
      const obj = JSON.parse(content) as unknown;
      scriptsFound++;
      mergeJsonFields(obj, fields);
    } catch { /* skip */ }

    // regex fallback even if JSON.parse failed
    const regexFields = extractFromScriptText(content);
    for (const [k, v] of Object.entries(regexFields)) {
      const key = k as keyof ExtractedFields;
      if (fields[key] == null && v != null) (fields as Record<string, unknown>)[key] = v;
    }
    if (Object.keys(regexFields).length > 0) scriptsFound = Math.max(scriptsFound, 1);
  }

  // second pass: inline scripts with assignment patterns — regex extraction only
  // (brace-counting is skipped to avoid 150K limit issues with large Zillow blobs)
  const inlineRe = /<script(?![^>]+type=["']application\/json["'])[^>]*>([\s\S]{100,}?)<\/script>/gi;
  let im;
  while ((im = inlineRe.exec(html)) !== null) {
    const content = im[1];
    if (!/bedrooms|bathrooms|livingArea|listingPrice|bedsCount|bathsCount/i.test(content)) continue;
    const regexFields = extractFromScriptText(content);
    let found = false;
    for (const [k, v] of Object.entries(regexFields)) {
      const key = k as keyof ExtractedFields;
      if (fields[key] == null && v != null) { (fields as Record<string, unknown>)[key] = v; found = true; }
    }
    if (found) scriptsFound++;
  }

  return { fields, scriptsFound };
}

// --- search-card parser (for search-result pages or fallback) ---

function parseSearchCards(html: string): {
  cards: Array<{ price?: number; address?: string }>;
  cardsFound: number;
} {
  const cards: Array<{ price?: number; address?: string }> = [];

  const priceRe = /<span[^>]+data-test=["']property-card-price["'][^>]*>([\s\S]*?)<\/span>/gi;
  const addrRe = /<address[^>]+data-test=["']property-card-addr["'][^>]*>([\s\S]*?)<\/address>/gi;

  const prices: number[] = [];
  let pm;
  while ((pm = priceRe.exec(html)) !== null) {
    const txt = innerText(pm[1]);
    const v = parseInt(txt.replace(/[^0-9]/g, ""), 10);
    if (v >= 500 && v <= 15_000) prices.push(v);
  }

  const addrs: string[] = [];
  let am;
  while ((am = addrRe.exec(html)) !== null) {
    const txt = innerText(am[1]);
    if (txt) addrs.push(txt);
  }

  for (let i = 0; i < Math.max(prices.length, addrs.length); i++) {
    cards.push({ price: prices[i], address: addrs[i] });
  }

  return { cards, cardsFound: cards.length };
}

// --- address extraction from HTML markup ---

function extractAddressFromHtml(html: string, text: string): string | undefined {
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1M) {
    const h1 = innerText(h1M[1]).split("|")[0].trim();
    if (h1.length > 5 && /\d/.test(h1)) return h1;
  }

  // NY-style address in visible text
  const addrM = text.match(/\d[\d\-–]+[^,\n]{5,50},\s*(?:#\s*[\w]+,\s*)?[\w\s]+,\s*NY\s+\d{5}/i);
  if (addrM) return addrM[0].trim();

  return undefined;
}

// --- main export ---

export interface ZillowExtractResult {
  fields: ExtractedFields;
  warnings: string[];
  extractorsUsed: string[];
  debug: {
    zillowDetailSignalsFound: number;
    zillowJsonScriptsFound: number;
    zillowPropertyCardsFound: number;
  };
}

export function extractZillowFields(args: { url: string; html: string }): ZillowExtractResult {
  const { url, html } = args;
  const text = toText(html);
  const fields: ExtractedFields = { canonical_url: url, source: "zillow" };
  const warnings: string[] = [];
  const extractorsUsed: string[] = [];

  // 1. detail-page text parser
  const detail = parseDetailText(text);
  warnings.push(...detail.warnings);
  if (detail.signalsFound > 0) {
    extractorsUsed.push("zillow-detail");
    warnings.push("zillow detail parser used");
    Object.assign(fields, detail.fields);
  }

  // 2. address from HTML markup if still missing
  if (!fields.address_text) {
    const addr = extractAddressFromHtml(html, text);
    if (addr) fields.address_text = addr;
  }

  // 3. embedded JSON / script parser — fills only missing fields
  const json = parseEmbeddedJson(html);
  if (json.scriptsFound > 0) {
    extractorsUsed.push("zillow-json");
    warnings.push("zillow embedded json parser used");
    for (const [k, v] of Object.entries(json.fields)) {
      const key = k as keyof ExtractedFields;
      if (fields[key] == null && v != null) {
        (fields as Record<string, unknown>)[key] = v;
      }
    }
  }

  // 4. search-card parser — fallback or for search-result URLs
  const cardResult = parseSearchCards(html);
  const isDetailPage = /\/homedetails\//i.test(url);
  if (cardResult.cardsFound > 0) {
    if (isDetailPage && detail.signalsFound >= 2) {
      warnings.push("zillow parser found nearby cards but ignored them because detail fields were present");
    } else {
      extractorsUsed.push("zillow-search-card");
      warnings.push("zillow search card parser used");
      const card = cardResult.cards[0];
      if (card.price && !fields.rent) fields.rent = card.price;
      if (card.address && !fields.address_text) fields.address_text = card.address;
    }
  }

  if (extractorsUsed.length === 0) {
    warnings.push("zillow scraperapi html contained no recognizable listing data");
  }

  return {
    fields,
    warnings,
    extractorsUsed,
    debug: {
      zillowDetailSignalsFound: detail.signalsFound,
      zillowJsonScriptsFound: json.scriptsFound,
      zillowPropertyCardsFound: cardResult.cardsFound,
    },
  };
}
