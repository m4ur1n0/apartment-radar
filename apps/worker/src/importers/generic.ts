import type { Confidence, ExtractedFields, FetchMode, ImportPreviewResult, ImportSource } from "./types";
import { extractZillowFields } from "./zillow";
import { extractNooklynFields } from "./nooklyn";
import { extractStreetEasyFields } from "./streeteasy";

const MAX_BYTES = 500_000;
const HEAD_BUDGET = 60_000;

// zillow (and similar sites) have massive style/script blocks in <head>.
// if <body> starts late, we take a small head slice (for meta/og tags) + body content.
function smartSlice(raw: string, maxBytes: number): string {
  if (raw.length <= maxBytes) return raw;
  const bodyIdx = raw.search(/<body[\s>]/i);
  if (bodyIdx === -1 || bodyIdx < maxBytes * 0.25) {
    return raw.slice(0, maxBytes);
  }
  const headEndIdx = raw.search(/<\/head>/i);
  const headContent =
    headEndIdx !== -1 && headEndIdx < HEAD_BUDGET
      ? raw.slice(0, headEndIdx + 7)
      : raw.slice(0, HEAD_BUDGET);
  const bodyContent = raw.slice(bodyIdx, bodyIdx + (maxBytes - headContent.length));
  return headContent + bodyContent;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// instruction set used when fetching zillow via scraperapi
const ZILLOW_INSTRUCTION_SET = [
  {
    type: "wait_for_selector",
    selector: { type: "css", value: "span[data-test='property-card-price']" },
    timeout: 8,
  },
  { type: "scroll", direction: "y", value: "bottom" },
  { type: "wait", value: 5 },
];

function isBlocked(url: URL): boolean {
  const h = url.hostname.toLowerCase();
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(h)) return true;
  return false;
}

function getTag(tag: string, html: string): string | undefined {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : undefined;
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

function stripHtml(html: string): string {
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

function parseJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const v = JSON.parse(m[1].trim()) as unknown;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            out.push(item as Record<string, unknown>);
          }
        }
      } else if (v && typeof v === "object") {
        out.push(v as Record<string, unknown>);
      }
    } catch { /* skip malformed */ }
  }
  return out;
}

function mostFrequent(vals: number[]): number | undefined {
  if (!vals.length) return undefined;
  const freq: Record<string, number> = {};
  for (const v of vals) freq[String(v)] = (freq[String(v)] ?? 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  return Number(top[0]);
}

function extractRent(text: string): number | undefined {
  const vals = Array.from(text.matchAll(/\$\s*(\d{1,2},?\d{3})(?:\s*\/\s*(?:mo(?:nth)?|monthly))?/gi))
    .map((m) => parseInt(m[1].replace(",", ""), 10))
    .filter((v) => v >= 500 && v <= 15_000);
  return mostFrequent(vals);
}

function extractBeds(text: string): number | undefined {
  const vals = Array.from(text.matchAll(/(\d+(?:\.\d)?)\s*(?:bds?|bed(?:room)?s?|br)\b/gi))
    .map((m) => parseFloat(m[1]))
    .filter((v) => v >= 0 && v <= 10);
  return mostFrequent(vals);
}

function extractBaths(text: string): number | undefined {
  const vals = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(?:ba|bath(?:room)?s?)\b/gi))
    .map((m) => parseFloat(m[1]))
    .filter((v) => v >= 0 && v <= 10);
  return mostFrequent(vals);
}

function extractSqft(text: string): number | undefined {
  const vals = Array.from(text.matchAll(/(\d{3,5})\s*(?:sq\.?\s*ft\.?|sqft|sf|ft²)/gi))
    .map((m) => parseInt(m[1].replace(",", ""), 10))
    .filter((v) => v >= 200 && v <= 10_000);
  return mostFrequent(vals);
}

function jsonLdPrice(blocks: Record<string, unknown>[]): number | undefined {
  for (const b of blocks) {
    const offers = b["offers"] as Record<string, unknown> | undefined;
    if (offers && typeof offers["price"] === "number" && offers["price"] >= 500) return offers["price"];
    if (typeof b["price"] === "number" && b["price"] >= 500) return b["price"];
  }
  return undefined;
}

function jsonLdStr(blocks: Record<string, unknown>[], ...keys: string[]): string | undefined {
  for (const b of blocks) {
    for (const k of keys) {
      const v = b[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return undefined;
}

function jsonLdAddress(blocks: Record<string, unknown>[]): string | undefined {
  for (const b of blocks) {
    const addr = b["address"];
    if (typeof addr === "string" && addr.trim()) return addr.trim();
    if (addr && typeof addr === "object" && !Array.isArray(addr)) {
      const a = addr as Record<string, unknown>;
      const parts = [a["streetAddress"], a["addressLocality"], a["addressRegion"]]
        .filter((x): x is string => typeof x === "string" && !!x)
        .join(", ");
      if (parts) return parts;
    }
  }
  return undefined;
}

function jsonLdSqft(blocks: Record<string, unknown>[]): number | undefined {
  for (const b of blocks) {
    const fs = b["floorSize"] as Record<string, unknown> | undefined;
    if (fs && typeof fs["value"] === "number" && fs["value"] >= 200 && fs["value"] <= 10_000) {
      return fs["value"];
    }
  }
  return undefined;
}

function jsonLdCoords(blocks: Record<string, unknown>[]): { lat?: number; lng?: number } {
  for (const b of blocks) {
    const geo = b["geo"] as Record<string, unknown> | undefined;
    if (geo) {
      const lat = typeof geo["latitude"] === "number" ? geo["latitude"] : parseFloat(String(geo["latitude"] ?? ""));
      const lng = typeof geo["longitude"] === "number" ? geo["longitude"] : parseFloat(String(geo["longitude"] ?? ""));
      if (!isNaN(lat) && !isNaN(lng) && lat >= 40.0 && lat <= 41.5 && lng >= -75.0 && lng <= -73.0) {
        return { lat, lng };
      }
    }
  }
  return {};
}

function extractCoordsFromText(html: string): { lat?: number; lng?: number } {
  // data-latitude / data-longitude attributes (craigslist, some sites)
  const latAttr = html.match(/data-(?:latitude|lat)=["']([-\d.]+)["']/i);
  const lngAttr = html.match(/data-(?:longitude|lng|lon)=["']([-\d.]+)["']/i);
  if (latAttr && lngAttr) {
    const lat = parseFloat(latAttr[1]);
    const lng = parseFloat(lngAttr[1]);
    if (lat >= 40.0 && lat <= 41.5 && lng >= -75.0 && lng <= -73.0) return { lat, lng };
  }

  // inline script: "latitude":40.xxx or latitude:40.xxx
  const latScript = html.match(/"?latitude"?\s*:\s*([-\d.]{5,12})/);
  const lngScript = html.match(/"?longitude"?\s*:\s*([-\d.]{7,12})/);
  if (latScript && lngScript) {
    const lat = parseFloat(latScript[1]);
    const lng = parseFloat(lngScript[1]);
    if (lat >= 40.0 && lat <= 41.5 && lng >= -75.0 && lng <= -73.0) return { lat, lng };
  }

  return {};
}

function calcConfidence(fields: ExtractedFields, source: ImportSource): Confidence {
  const coreCount = [fields.rent, fields.beds, fields.baths].filter((v) => v != null).length;
  const hasLocation = fields.address_text != null || fields.neighborhood != null;
  if (source === "zillow" || source === "nooklyn") {
    if (coreCount >= 3 && hasLocation) return "high";
    if (fields.rent != null && (coreCount + (hasLocation ? 1 : 0)) >= 3) return "medium";
    return coreCount >= 1 ? "medium" : "low";
  }
  return coreCount >= 3 ? "high" : coreCount >= 1 ? "medium" : "low";
}

interface FetchResult {
  html?: string;
  httpStatus?: number;
  warnings: string[];
}

async function fetchHtmlDirect(rawUrl: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(rawUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!resp.ok) {
      return { httpStatus: resp.status, warnings: [`fetch failed: http ${resp.status}`] };
    }

    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("html")) {
      return { httpStatus: resp.status, warnings: ["response is not html"] };
    }

    const raw = await resp.text();
    return {
      html: smartSlice(raw, MAX_BYTES),
      httpStatus: resp.status,
      warnings: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { warnings: [`fetch error: ${msg}`] };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtmlWithScraperApi(
  url: string,
  apiKey: string,
  opts: { useInstructions?: boolean } = {}
): Promise<FetchResult> {
  const scraperUrl = new URL("https://api.scraperapi.com/");
  scraperUrl.searchParams.set("url", url);

  const headers: Record<string, string> = {
    "x-sapi-api_key": apiKey,
    "x-sapi-render": "true",
  };

  if (opts.useInstructions) {
    headers["x-sapi-instruction_set"] = JSON.stringify(ZILLOW_INSTRUCTION_SET);
  }

  // scraperapi with rendering can be slow
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(scraperUrl.toString(), {
      headers,
      signal: controller.signal,
    });

    if (!resp.ok) {
      return { httpStatus: resp.status, warnings: [`scraperapi returned http ${resp.status}`] };
    }

    const raw = await resp.text();
    return {
      html: smartSlice(raw, MAX_BYTES),
      httpStatus: resp.status,
      warnings: ["used temporary scraperapi fetch mode"],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { warnings: [`scraperapi fetch error: ${msg}`] };
  } finally {
    clearTimeout(timer);
  }
}

interface ParsedHtml {
  fields: ExtractedFields;
  warnings: string[];
  confidence: Confidence;
  extractorsUsed: string[];
  textSample: string;
  zillowDebug?: {
    zillowDetailSignalsFound: number;
    zillowJsonScriptsFound: number;
    zillowPropertyCardsFound: number;
  };
  nooklynDebug?: {
    nooklynDetailSignalsFound: number;
    amenitiesFoundCount: number;
  };
}

function parseHtml(html: string, rawUrl: string, source: ImportSource): ParsedHtml {
  const fields: ExtractedFields = { canonical_url: rawUrl, source };
  const allWarnings: string[] = [];
  const extractorsUsed: string[] = [];
  let zillowDebug: ParsedHtml["zillowDebug"];
  let nooklynDebug: ParsedHtml["nooklynDebug"];
  const stripped = stripHtml(html);
  const textSample = stripped.slice(0, 300);

  // source-specific parsers run first, filling fields before generic fallbacks
  if (source === "zillow") {
    const zr = extractZillowFields({ url: rawUrl, html });
    Object.assign(fields, zr.fields);
    allWarnings.push(...zr.warnings);
    extractorsUsed.push(...zr.extractorsUsed);
    zillowDebug = zr.debug;
  }

  if (source === "nooklyn") {
    const nr = extractNooklynFields({ url: rawUrl, html });
    Object.assign(fields, nr.fields);
    allWarnings.push(...nr.warnings);
    extractorsUsed.push(...nr.extractorsUsed);
    nooklynDebug = nr.debug;
  }

  if (source === "streeteasy") {
    const sr = extractStreetEasyFields({ url: rawUrl, html });
    Object.assign(fields, sr.fields);
    allWarnings.push(...sr.warnings);
    extractorsUsed.push(...sr.extractorsUsed);
  }

  // generic extraction fills whatever is still missing
  const jsonLd = parseJsonLd(html);
  extractorsUsed.push("generic");

  if (!fields.title) {
    const ogTitle = getMeta("og:title", html);
    const htmlTitle = getTag("title", html);
    // filter placeholder text that zillow SVG image elements inject into <title> tags
    const isPlaceholder = (t: string) => /no image|not available|placeholder/i.test(t);
    const title =
      (ogTitle && !isPlaceholder(ogTitle)) ? ogTitle :
      (htmlTitle && !isPlaceholder(htmlTitle)) ? htmlTitle :
      undefined;
    if (title) fields.title = title;
  }

  // for zillow, use address as title if no clean title found
  if (!fields.title && source === "zillow" && fields.address_text) {
    fields.title = fields.address_text;
  }

  if (!fields.description) {
    const desc = getMeta("og:description", html) ?? getMeta("description", html);
    if (desc) fields.description = desc;
  }

  if (jsonLd.length > 0) {
    extractorsUsed.push("json-ld");
    if (!fields.rent) {
      const p = jsonLdPrice(jsonLd);
      if (p != null) fields.rent = p;
    }
    if (!fields.title) {
      const n = jsonLdStr(jsonLd, "name");
      if (n) fields.title = n;
    }
    if (!fields.description) {
      const d = jsonLdStr(jsonLd, "description");
      if (d) fields.description = d;
    }
    if (!fields.address_text) {
      const a = jsonLdAddress(jsonLd);
      if (a) fields.address_text = a;
    }
    if (!fields.sqft) {
      const s = jsonLdSqft(jsonLd);
      if (s != null) fields.sqft = s;
    }
    if (!fields.latitude || !fields.longitude) {
      const { lat, lng } = jsonLdCoords(jsonLd);
      if (lat != null && !fields.latitude) fields.latitude = lat;
      if (lng != null && !fields.longitude) fields.longitude = lng;
    }
  }

  // lat/lng from data attributes or inline scripts (non-zillow sites)
  if ((!fields.latitude || !fields.longitude) && source !== "zillow") {
    const { lat, lng } = extractCoordsFromText(html);
    if (lat != null && !fields.latitude) fields.latitude = lat;
    if (lng != null && !fields.longitude) fields.longitude = lng;
  }

  extractorsUsed.push("regex");

  if (!fields.rent) fields.rent = extractRent(stripped);
  if (!fields.beds) fields.beds = extractBeds(stripped);
  if (!fields.baths) fields.baths = extractBaths(stripped);
  // skip sqft regex if zillow already signaled it's unavailable
  if (!fields.sqft && !allWarnings.includes("sqft unavailable on zillow page")) {
    fields.sqft = extractSqft(stripped);
  }

  if (!fields.fee_status) {
    if (/no\s*(?:broker\s*)?fee/i.test(stripped) || /owner\s*managed/i.test(stripped)) {
      fields.fee_status = "no fee";
    } else if (/broker\s*fee|one\s*month.*fee/i.test(stripped)) {
      fields.fee_status = "broker fee";
    }
  }

  if (!fields.laundry) {
    if (/(?:in.unit\s+laundry|w\/d\s+in\s+unit|washer.dryer\s+in\s+unit)/i.test(stripped)) {
      fields.laundry = "in-unit";
    } else if (/(?:laundry\s+in\s+(?:building|basement)|shared\s+laundry|common\s+laundry|coin\s+laundry|on.site\s+laundry)/i.test(stripped)) {
      fields.laundry = "in building";
    }
  }

  if (!fields.dishwasher && /dishwasher/i.test(stripped)) fields.dishwasher = true;

  if (!fields.outdoor_space && /private\s+(?:yard|garden|roof)|outdoor\s+space|balcon[yi]|roof\s+(?:deck|access)|backyard/i.test(stripped)) {
    fields.outdoor_space = true;
  }

  if (!fields.pets) {
    if (/pets?\s+(?:ok|allowed|welcome|friendly)|cats?\s+ok|dogs?\s+ok/i.test(stripped)) {
      fields.pets = "allowed";
    } else if (/no\s+pets?|pets?\s+not\s+(?:allowed|permitted)/i.test(stripped)) {
      fields.pets = "no pets";
    }
  }

  const warnings = [...allWarnings];
  if (!fields.rent) warnings.push("rent not found");
  if (!fields.beds) warnings.push("beds not found");
  if (!fields.baths) warnings.push("baths not found");
  // only add "sqft not found" if not already warned about it
  if (!fields.sqft && !warnings.includes("sqft unavailable on zillow page")) {
    warnings.push("sqft not found");
  }
  if (!fields.address_text) warnings.push("address not found");

  return {
    fields,
    warnings,
    confidence: calcConfidence(fields, source),
    extractorsUsed,
    textSample,
    zillowDebug,
    nooklynDebug,
  };
}

export async function genericExtract(
  rawUrl: string,
  source: ImportSource,
  fetchMode: FetchMode = "direct",
  scraperApiKey?: string
): Promise<ImportPreviewResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { url: rawUrl, source, confidence: "low", fetchMode, fields: {}, warnings: ["invalid url"] };
  }

  if (isBlocked(parsedUrl)) {
    return { url: rawUrl, source, confidence: "low", fetchMode, fields: {}, warnings: ["blocked url"] };
  }

  let fetchResult: FetchResult;
  if (fetchMode === "scraperapi") {
    if (!scraperApiKey) {
      return { url: rawUrl, source, confidence: "low", fetchMode, fields: {}, warnings: ["scraperapi key not configured"] };
    }
    fetchResult = await fetchHtmlWithScraperApi(rawUrl, scraperApiKey, {
      useInstructions: source === "zillow",
    });
  } else {
    fetchResult = await fetchHtmlDirect(rawUrl);
  }

  const { html, httpStatus, warnings: fetchWarnings } = fetchResult;

  if (!html) {
    return {
      url: rawUrl, source, confidence: "low", fetchMode,
      fields: { canonical_url: rawUrl, source },
      warnings: fetchWarnings,
      debug: { httpStatus, extractorsUsed: [] },
    };
  }

  const { fields, warnings, confidence, extractorsUsed, textSample, zillowDebug, nooklynDebug } = parseHtml(html, rawUrl, source);
  return {
    url: rawUrl, source, confidence, fetchMode,
    fields,
    warnings: [...fetchWarnings, ...warnings],
    debug: {
      httpStatus,
      htmlCharsParsed: html.length,
      extractorsUsed,
      zillowDetailSignalsFound: zillowDebug?.zillowDetailSignalsFound,
      zillowJsonScriptsFound: zillowDebug?.zillowJsonScriptsFound,
      zillowPropertyCardsFound: zillowDebug?.zillowPropertyCardsFound,
      nooklynDetailSignalsFound: nooklynDebug?.nooklynDetailSignalsFound,
      amenitiesFoundCount: nooklynDebug?.amenitiesFoundCount,
      textSample,
    },
  };
}
