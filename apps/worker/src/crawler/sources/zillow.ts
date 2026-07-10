import type { SearchTarget } from "../searchTargets";
import type {
  BlockStatus,
  CandidateStats,
  DiscoveredListingCandidate,
  DiscoveryDebug,
  DiscoveryOptions,
  DiscoveryRejection,
  DiscoveryResult,
} from "../types";
import { fetchHtmlWithProxy } from "../../importers/generic";

const ZILLOW_BASE = "https://www.zillow.com";

// zillow listing URLs: /homedetails/<address-slug>/<zpid>_zpid[/]
const LISTING_RE = /\/homedetails\/[^"'\s<>?#]{5,}\/(\d{5,12})_zpid/i;

export function isZillowListingHref(href: string): boolean {
  if (!href) return false;
  return LISTING_RE.test(href);
}

function zpidFromHref(href: string): string | undefined {
  return LISTING_RE.exec(href)?.[1];
}

function resolveHref(href: string): string | null {
  try {
    const u = new URL(href, ZILLOW_BASE);
    if (!u.hostname.endsWith("zillow.com")) return null;
    u.hash = "";
    u.search = "";
    // normalize trailing slash on zpid path
    if (!u.pathname.endsWith("/")) u.pathname = u.pathname + "/";
    return u.toString();
  } catch {
    return null;
  }
}

function collectListingAnchors(html: string): Array<{ href: string; index: number }> {
  const results: Array<{ href: string; index: number }> = [];
  const re = /<a\s[^>]*href=["']([^"'\s>]+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (isZillowListingHref(m[1])) results.push({ href: m[1], index: m.index });
  }
  return results;
}

// scan inline scripts for zpid values and homedetails URLs embedded as quoted strings
function extractFromScripts(html: string): Array<{ href: string; index: number }> {
  const results: Array<{ href: string; index: number }> = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(html)) !== null) {
    const content = sm[1];
    const contentStart = sm.index;
    if (!content.includes("homedetails") && !content.includes("zpid")) continue;

    // look for quoted homedetails URLs
    const urlRe = /["'`](\/homedetails\/[^"'`\s\\]{10,}\/\d+_zpid\/?)/gi;
    let um: RegExpExecArray | null;
    while ((um = urlRe.exec(content)) !== null) {
      if (isZillowListingHref(um[1])) {
        results.push({ href: um[1], index: contentStart + um.index });
      }
    }
  }
  return results;
}

function cardPrice(ctx: string): number | undefined {
  const m = ctx.match(/\$\s*([\d,]{3,7})\+?\s*\/\s*mo/i) ?? ctx.match(/\$\s*([\d,]{3,7})(?!\s*[KkMm])/);
  if (!m) return undefined;
  const v = parseInt(m[1].replace(",", ""), 10);
  return v >= 500 && v <= 15_000 ? v : undefined;
}

function cardBeds(ctx: string): number | undefined {
  const m = ctx.match(/\b(\d)\s*(?:bds?|bed(?:room)?s?)\b/i) ?? ctx.match(/\bStudio\b/i);
  if (!m) return undefined;
  if (/studio/i.test(m[0])) return 0;
  const v = parseInt(m[1], 10);
  return v >= 0 && v <= 10 ? v : undefined;
}

function cardBaths(ctx: string): number | undefined {
  const m = ctx.match(/\b([\d.]+)\s*(?:ba|bath(?:room)?s?)\b/i);
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  return v >= 0 && v <= 10 ? v : undefined;
}

function cardAddress(ctx: string): string | undefined {
  const addrM = ctx.match(/<address[^>]*>([\s\S]*?)<\/address>/i);
  if (addrM) return addrM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || undefined;
  return undefined;
}

function detectBlock(html: string): string[] {
  const signals: string[] = [];
  if (html.length < 5_000) signals.push("html_too_small");
  const lower = html.toLowerCase();
  if (lower.includes("perimeterx") || lower.includes("px-captcha")) signals.push("perimeterx_captcha");
  if (/access.{0,20}denied/i.test(html)) signals.push("access_denied");
  if (/prove.{0,30}human|not.{0,10}robot/i.test(html)) signals.push("bot_challenge");
  if (lower.includes("cf-challenge") || lower.includes("cloudflare")) signals.push("cloudflare");
  return signals;
}

function computeBlockStatus(
  signals: string[],
  httpStatus: number | undefined,
  listingLikeAnchorCount: number
): BlockStatus {
  if (httpStatus === 403 || httpStatus === 429) return "blocked";
  if (signals.length === 0) return "not_blocked";
  return listingLikeAnchorCount > 0 ? "suspected_but_usable" : "blocked";
}

function firstHrefs(html: string, n: number): string[] {
  const out: string[] = [];
  const re = /<a\s[^>]*href=["']([^"'\s>]+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < n) out.push(m[1]);
  return out;
}

export function extractZillowListings(
  html: string,
  limit: number,
  hardFilters?: { maxRent?: number; beds?: number }
): { candidates: DiscoveredListingCandidate[]; rejected: DiscoveryRejection[]; listingLikeAnchorCount: number; strategyResults: Record<string, number> } {
  const candidates: DiscoveredListingCandidate[] = [];
  const rejected: DiscoveryRejection[] = [];
  const seen = new Set<string>();

  const anchorMatches = collectListingAnchors(html);
  const scriptMatches = anchorMatches.length === 0 ? extractFromScripts(html) : [];

  const strategyResults = {
    "anchor-hrefs": anchorMatches.length,
    "script-text": scriptMatches.length,
  };

  for (const { href, index } of [...anchorMatches, ...scriptMatches]) {
    const canonical = resolveHref(href);
    if (!canonical) continue;

    if (seen.has(canonical)) {
      rejected.push({ url: canonical, reason: "duplicate" });
      continue;
    }
    if (candidates.length >= limit) {
      rejected.push({ url: canonical, reason: "exceeded_limit" });
      continue;
    }
    seen.add(canonical);

    // look mostly forward: price/beds/address in zillow cards come after the anchor tag
    const ctx = html.slice(Math.max(0, index - 50), index + 1100);
    const price = cardPrice(ctx);
    const beds = cardBeds(ctx);
    const baths = cardBaths(ctx);
    const address = cardAddress(ctx);
    const zpid = zpidFromHref(href);

    if (hardFilters?.maxRent != null && price != null && price > hardFilters.maxRent) {
      rejected.push({ url: canonical, reason: "price_over_max", note: `price ${price} > ${hardFilters.maxRent}`, price });
      continue;
    }
    if (hardFilters?.beds != null && beds != null && beds !== hardFilters.beds) {
      rejected.push({ url: canonical, reason: "beds_incompatible", note: `beds ${beds} != ${hardFilters.beds}`, beds });
      continue;
    }

    const confidence: "high" | "medium" | "low" =
      price != null && beds != null ? "high" :
      price != null || beds != null ? "medium" : "low";

    candidates.push({
      listingUrl: canonical,
      canonicalUrl: canonical,
      sourceListingId: zpid,
      ...(price != null && { price }),
      ...(beds != null && { beds }),
      ...(baths != null && { baths }),
      ...(address && { address }),
      confidence,
    });
  }

  return {
    candidates,
    rejected,
    listingLikeAnchorCount: anchorMatches.length,
    strategyResults,
  };
}

export async function discoverZillowListings(
  target: SearchTarget,
  options?: DiscoveryOptions
): Promise<DiscoveryResult> {
  const start = Date.now();
  const scraperApiKeys = options?.scraperApiKeys ?? [];
  const limit = target.discoveryLimits.maxCandidateUrlsPerRun;
  const warnings: string[] = [];

  if (scraperApiKeys.length === 0) {
    return {
      targetId: target.id, source: "zillow", searchUrl: target.searchUrl,
      blockStatus: "blocked",
      candidatesFound: 0, candidates: [], rejected: [],
      warnings: ["zillow discovery requires proxy keys (scraperApiKeys not configured)"],
      durationMs: Date.now() - start,
    };
  }

  // zillow always uses proxy with rendering, same as individual listing import
  const proxyResult = await fetchHtmlWithProxy(target.searchUrl, scraperApiKeys, { source: "zillow", render: true });
  const httpStatus = proxyResult.httpStatus;
  warnings.push(...proxyResult.warnings);

  const html = proxyResult.html;
  if (!html) {
    return {
      targetId: target.id, source: "zillow", searchUrl: target.searchUrl,
      httpStatus, blockStatus: "blocked",
      candidatesFound: 0, candidates: [], rejected: [], warnings,
      durationMs: Date.now() - start,
    };
  }

  const { candidates, rejected, listingLikeAnchorCount, strategyResults } = extractZillowListings(
    html, limit,
    { maxRent: target.hardFilters.maxRent, beds: target.hardFilters.beds }
  );

  const blockSignals = detectBlock(html);
  const blockStatus = computeBlockStatus(blockSignals, httpStatus, listingLikeAnchorCount);

  if (candidates.length === 0) {
    const filterRejected = rejected.filter(
      r => r.reason === "price_over_max" || r.reason === "beds_incompatible"
    );
    if (filterRejected.length > 0) {
      warnings.push("listing_urls_found_but_all_rejected");
    } else if (html.length < 5_000) {
      warnings.push("empty_or_tiny_html");
    } else if (blockStatus === "blocked") {
      warnings.push("blocked_or_captcha_likely");
    } else if (blockStatus === "suspected_but_usable") {
      warnings.push("block_signals_present_but_usable");
    } else if (listingLikeAnchorCount === 0) {
      warnings.push("no_listing_like_anchors");
    }
  }

  const priceOverMax = rejected.filter(r => r.reason === "price_over_max").length;
  const bedsIncompatible = rejected.filter(r => r.reason === "beds_incompatible").length;
  const candidateStats: CandidateStats = {
    listingLikeUrlsFound: listingLikeAnchorCount,
    acceptedCandidates: candidates.length,
    rejectedListingUrls: priceOverMax + bedsIncompatible,
    duplicateUrls: rejected.filter(r => r.reason === "duplicate").length,
    priceOverMax,
    bedsIncompatible,
  };

  const rejectedPreview = rejected.slice(0, 20);

  const totalAnchorCount = (html.match(/<a\s[^>]*href=/gi) ?? []).length;
  const titleM = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);

  let debug: DiscoveryDebug | undefined;
  if (options?.debug) {
    debug = {
      htmlLength: html.length,
      htmlTitle: titleM ? titleM[1].trim() : undefined,
      htmlSnippetStart: html.slice(0, 500),
      totalAnchorCount,
      listingLikeAnchorCount,
      firstHrefSamples: firstHrefs(html, 25),
      blockedOrCaptchaLikely: blockSignals.length > 0,
      blockedOrCaptchaSignals: blockSignals,
      extractionStrategyResults: strategyResults,
    };
  }

  return {
    targetId: target.id, source: "zillow", searchUrl: target.searchUrl,
    httpStatus, blockStatus,
    candidatesFound: candidates.length, candidates, rejected, rejectedPreview, candidateStats, warnings,
    durationMs: Date.now() - start,
    ...(debug && { debug }),
  };
}
