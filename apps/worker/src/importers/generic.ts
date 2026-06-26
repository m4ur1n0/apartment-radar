import type { Confidence, ExtractedFields, ImportPreviewResult, ImportSource } from "./types";

const MAX_BYTES = 500_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
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
  const vals = Array.from(text.matchAll(/(\d+(?:\.\d)?)\s*(?:bed(?:room)?s?|br)\b/gi))
    .map((m) => parseFloat(m[1]))
    .filter((v) => v >= 0 && v <= 10);
  return mostFrequent(vals);
}

function extractBaths(text: string): number | undefined {
  const vals = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|ba)\b/gi))
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

export async function genericExtract(
  rawUrl: string,
  source: ImportSource
): Promise<ImportPreviewResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { url: rawUrl, source, confidence: "low", fields: {}, warnings: ["invalid url"] };
  }

  if (isBlocked(parsedUrl)) {
    return { url: rawUrl, source, confidence: "low", fields: {}, warnings: ["blocked url"] };
  }

  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let resp: Response;
    try {
      resp = await fetch(rawUrl, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      return {
        url: rawUrl, source, confidence: "low",
        fields: { canonical_url: rawUrl, source },
        warnings: [`fetch failed: http ${resp.status}`],
      };
    }

    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("html")) {
      return {
        url: rawUrl, source, confidence: "low",
        fields: { canonical_url: rawUrl, source },
        warnings: ["response is not html"],
      };
    }

    const raw = await resp.text();
    html = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      url: rawUrl, source, confidence: "low",
      fields: { canonical_url: rawUrl, source },
      warnings: [`fetch error: ${msg}`],
    };
  }

  const stripped = stripHtml(html);
  const jsonLd = parseJsonLd(html);

  const fields: ExtractedFields = { canonical_url: rawUrl, source };

  const ogTitle = getMeta("og:title", html);
  const htmlTitle = getTag("title", html);
  const title = ogTitle ?? htmlTitle;
  if (title) fields.title = title;

  const ogDesc = getMeta("og:description", html);
  const metaDesc = getMeta("description", html);
  const desc = ogDesc ?? metaDesc;
  if (desc) fields.description = desc;

  fields.rent = jsonLdPrice(jsonLd) ?? extractRent(stripped);
  fields.beds = extractBeds(stripped);
  fields.baths = extractBaths(stripped);
  fields.sqft = extractSqft(stripped);

  if (/no\s*(?:broker\s*)?fee/i.test(stripped) || /owner\s*managed/i.test(stripped)) {
    fields.fee_status = "no fee";
  } else if (/broker\s*fee|one\s*month.*fee/i.test(stripped)) {
    fields.fee_status = "broker fee";
  }

  if (/(?:in.unit\s+laundry|w\/d\s+in\s+unit|washer.dryer\s+in\s+unit)/i.test(stripped)) {
    fields.laundry = "in-unit";
  } else if (/(?:laundry\s+in\s+(?:building|basement)|shared\s+laundry|common\s+laundry|coin\s+laundry|on.site\s+laundry)/i.test(stripped)) {
    fields.laundry = "in building";
  }

  if (/dishwasher/i.test(stripped)) fields.dishwasher = true;

  if (/private\s+(?:yard|garden|roof)|outdoor\s+space|balcon[yi]|roof\s+(?:deck|access)|backyard/i.test(stripped)) {
    fields.outdoor_space = true;
  }

  if (/pets?\s+(?:ok|allowed|welcome|friendly)|cats?\s+ok|dogs?\s+ok/i.test(stripped)) {
    fields.pets = "allowed";
  } else if (/no\s+pets?|pets?\s+not\s+(?:allowed|permitted)/i.test(stripped)) {
    fields.pets = "no pets";
  }

  const warnings: string[] = [];
  if (!fields.rent) warnings.push("rent not found");
  if (!fields.beds) warnings.push("beds not found");
  if (!fields.baths) warnings.push("baths not found");
  if (!fields.sqft) warnings.push("sqft not found");
  if (!fields.address_text) warnings.push("address not found");

  const found = [fields.rent, fields.beds, fields.baths].filter((v) => v != null).length;
  const confidence: Confidence = found >= 3 ? "high" : found >= 1 ? "medium" : "low";

  return { url: rawUrl, source, confidence, fields, warnings };
}
