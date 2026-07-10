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
import {
  searchNooklynListings,
  extractNooklynSlugFromUrl,
  buildNooklynListingUrl,
  normalizeNooklynPrice,
  type NooklynSearchListing,
} from "../../importers/nooklynApi";

const NOOKLYN_BASE = "https://nooklyn.com";

// nooklyn listing URLs: /listings/<slug> where slug is alphanumeric with dashes
const LISTING_PATH_RE = /^\/listings\/([\w-]{3,80})$/;

export function isNooklynListingHref(href: string): boolean {
  if (!href) return false;
  try {
    if (href.startsWith("http")) {
      const u = new URL(href);
      if (!u.hostname.endsWith("nooklyn.com")) return false;
      return LISTING_PATH_RE.test(u.pathname);
    }
    return LISTING_PATH_RE.test(href);
  } catch {
    return false;
  }
}

function resolveHref(href: string): string | null {
  try {
    const u = new URL(href, NOOKLYN_BASE);
    if (!u.hostname.endsWith("nooklyn.com")) return null;
    u.hash = "";
    u.search = "";
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
    if (isNooklynListingHref(m[1])) results.push({ href: m[1], index: m.index });
  }
  return results;
}

function slugFromUrl(url: string): string | undefined {
  try {
    const m = new URL(url).pathname.match(LISTING_PATH_RE);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

function cardPrice(ctx: string): number | undefined {
  const m = ctx.match(/\$\s*([\d,]{3,7})/);
  if (!m) return undefined;
  const v = parseInt(m[1].replace(",", ""), 10);
  return v >= 500 && v <= 15_000 ? v : undefined;
}

function cardBeds(ctx: string): number | undefined {
  const m = ctx.match(/(\d)\s*(?:BR|bd|bed(?:room)?s?)\b/i) ?? ctx.match(/(\d)\s*Bed/i);
  if (!m) return undefined;
  const v = parseInt(m[1], 10);
  return v >= 0 && v <= 10 ? v : undefined;
}

function cardBaths(ctx: string): number | undefined {
  const m = ctx.match(/([\d.]+)\s*(?:ba|bath(?:room)?s?)\b/i);
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  return v >= 0 && v <= 10 ? v : undefined;
}

function cardNeighborhood(ctx: string): string | undefined {
  const m = ctx.match(/class="[^"]*(?:neighborhood|tag|location)[^"]*"[^>]*>\s*([A-Za-z][^<]{2,35}?)\s*</i);
  if (m) return m[1].trim();
  return undefined;
}

function cardAddress(ctx: string): string | undefined {
  const m = ctx.match(/\d+\s+[\w.']+(?:\s+[\w.']+)?\s+(?:St|Ave|Rd|Ln|Blvd|Dr|Pl|Ct|Way|Ter|Pkwy|Park)\b/i);
  return m ? m[0].trim() : undefined;
}

function detectBlock(html: string): string[] {
  const signals: string[] = [];
  if (html.length < 2_000) signals.push("html_too_small");
  const lower = html.toLowerCase();
  if (lower.includes("perimeterx") || lower.includes("px-captcha")) signals.push("perimeterx_captcha");
  if (/access.{0,20}denied/i.test(html)) signals.push("access_denied");
  if (/prove.{0,30}human|not.{0,10}robot/i.test(html)) signals.push("bot_challenge");
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

export function extractNooklynListings(
  html: string,
  limit: number,
  hardFilters?: { maxRent?: number; beds?: number }
): { candidates: DiscoveredListingCandidate[]; rejected: DiscoveryRejection[]; listingLikeAnchorCount: number } {
  const anchors = collectListingAnchors(html);
  const candidates: DiscoveredListingCandidate[] = [];
  const rejected: DiscoveryRejection[] = [];
  const seen = new Set<string>();

  for (const { href, index } of anchors) {
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

    // look mostly forward: price/beds in nooklyn cards come after the anchor tag
    const ctx = html.slice(Math.max(0, index - 50), index + 800);
    const price = cardPrice(ctx);
    const beds = cardBeds(ctx);
    const baths = cardBaths(ctx);
    const neighborhood = cardNeighborhood(ctx);
    const address = cardAddress(ctx);

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
      sourceListingId: slugFromUrl(canonical),
      ...(price != null && { price }),
      ...(beds != null && { beds }),
      ...(baths != null && { baths }),
      ...(neighborhood && { neighborhood }),
      ...(address && { address }),
      confidence,
    });
  }

  return { candidates, rejected, listingLikeAnchorCount: anchors.length };
}

function neighborhoodMatches(neighborhood: string, allowed: string[]): boolean {
  const lower = neighborhood.toLowerCase();
  return allowed.some((n) => {
    const nLower = n.toLowerCase();
    return lower.includes(nLower) || nLower.includes(lower);
  });
}

function mapListingToCandidate(listing: NooklynSearchListing): DiscoveredListingCandidate {
  const slug = listing.url ? extractNooklynSlugFromUrl(listing.url) : null;
  const listingUrl = slug ? buildNooklynListingUrl(slug) : buildNooklynListingUrl(String(listing.id));
  const price = typeof listing.price === "number" ? normalizeNooklynPrice(listing.price) : undefined;

  return {
    listingUrl,
    canonicalUrl: listingUrl,
    sourceListingId: String(listing.id),
    title: listing.short_address ?? listing.address,
    ...(price != null && { price }),
    ...(typeof listing.bedrooms === "number" && { beds: listing.bedrooms }),
    ...(typeof listing.bathrooms === "number" && { baths: listing.bathrooms }),
    ...(listing.neighborhood?.name && { neighborhood: listing.neighborhood.name }),
    ...(listing.address && { address: listing.address }),
    confidence: "high",
  };
}

export async function discoverNooklynListings(
  target: SearchTarget,
  options?: DiscoveryOptions
): Promise<DiscoveryResult> {
  const start = Date.now();
  const scraperApiKeys = options?.scraperApiKeys ?? [];
  const limit = target.discoveryLimits.maxCandidateUrlsPerRun;
  const warnings: string[] = [];

  // --- try structured API first ---
  const searchResult = await searchNooklynListings(
    { beds: [target.hardFilters.beds], maxPrice: target.hardFilters.maxRent, page: 1 },
    target.searchUrl
  );
  warnings.push(...searchResult.warnings);

  if (searchResult.ok && searchResult.data) {
    const data = searchResult.data;
    const candidates: DiscoveredListingCandidate[] = [];
    const rejected: DiscoveryRejection[] = [];

    const allowedNeighborhoods = target.expectedFilters.neighborhoods;
    const rejectOutside = target.hardFilters.rejectIfClearlyOutsideNeighborhoods;

    for (const listing of data.listings) {
      if (candidates.length >= limit) {
        const url = listing.url ? buildNooklynListingUrl(extractNooklynSlugFromUrl(listing.url) ?? String(listing.id)) : String(listing.id);
        rejected.push({ url, reason: "exceeded_limit" });
        continue;
      }

      const price = typeof listing.price === "number" ? normalizeNooklynPrice(listing.price) : undefined;
      const beds = typeof listing.bedrooms === "number" ? listing.bedrooms : undefined;
      const neighborhood = listing.neighborhood?.name;

      if (price != null && price > target.hardFilters.maxRent) {
        const url = listing.url ? buildNooklynListingUrl(extractNooklynSlugFromUrl(listing.url) ?? String(listing.id)) : String(listing.id);
        rejected.push({ url, reason: "price_over_max", note: `price ${price} > ${target.hardFilters.maxRent}`, price });
        continue;
      }
      if (beds != null && beds !== target.hardFilters.beds) {
        const url = listing.url ? buildNooklynListingUrl(extractNooklynSlugFromUrl(listing.url) ?? String(listing.id)) : String(listing.id);
        rejected.push({ url, reason: "beds_incompatible", note: `beds ${beds} != ${target.hardFilters.beds}`, beds });
        continue;
      }
      if (rejectOutside && neighborhood && !neighborhoodMatches(neighborhood, allowedNeighborhoods)) {
        const url = listing.url ? buildNooklynListingUrl(extractNooklynSlugFromUrl(listing.url) ?? String(listing.id)) : String(listing.id);
        rejected.push({ url, reason: "outside_target_area", note: `neighborhood "${neighborhood}" not in [${allowedNeighborhoods.join(", ")}]` });
        continue;
      }

      candidates.push(mapListingToCandidate(listing));
    }

    if (data.page_count > 1) {
      warnings.push(`nooklyn api page_count=${data.page_count} total=${data.total_count} (only page 1 fetched)`);
    }

    const priceOverMax = rejected.filter((r) => r.reason === "price_over_max").length;
    const bedsIncompatible = rejected.filter((r) => r.reason === "beds_incompatible").length;
    const outsideTargetArea = rejected.filter((r) => r.reason === "outside_target_area").length;
    const candidateStats: CandidateStats = {
      listingLikeUrlsFound: data.listings.length,
      acceptedCandidates: candidates.length,
      rejectedListingUrls: priceOverMax + bedsIncompatible + outsideTargetArea,
      duplicateUrls: 0,
      priceOverMax,
      bedsIncompatible,
      ...(outsideTargetArea > 0 && { outsideTargetArea }),
    };

    if (candidates.length === 0 && rejected.length > 0) {
      warnings.push("listing_urls_found_but_all_rejected");
    }

    const rejectedPreview = rejected.slice(0, 20);

    let debug: DiscoveryDebug | undefined;
    if (options?.debug) {
      debug = {
        htmlLength: 0,
        htmlSnippetStart: "",
        totalAnchorCount: 0,
        listingLikeAnchorCount: data.listings.length,
        firstHrefSamples: candidates.slice(0, 5).map((c) => c.listingUrl),
        blockedOrCaptchaLikely: false,
        blockedOrCaptchaSignals: [],
        extractionStrategyResults: { "nooklyn-api": data.listings.length },
      };
    }

    return {
      targetId: target.id, source: "nooklyn", searchUrl: target.searchUrl,
      httpStatus: searchResult.httpStatus, blockStatus: "not_blocked",
      candidatesFound: candidates.length, candidates, rejected, rejectedPreview, candidateStats, warnings,
      durationMs: Date.now() - start,
      ...(debug && { debug }),
    };
  }

  // --- API failed: fall back to proxy render if keys available ---
  warnings.push("nooklyn_api_failed");

  let html: string | undefined;
  let httpStatus: number | undefined;

  if (scraperApiKeys.length > 0) {
    const proxyResult = await fetchHtmlWithProxy(target.searchUrl, scraperApiKeys, { source: "nooklyn", render: true });
    if (proxyResult.html) {
      html = proxyResult.html;
      httpStatus = proxyResult.httpStatus;
    }
    warnings.push(...proxyResult.warnings);
  }

  if (!html) {
    return {
      targetId: target.id, source: "nooklyn", searchUrl: target.searchUrl,
      httpStatus, blockStatus: "blocked",
      candidatesFound: 0, candidates: [], rejected: [], warnings,
      durationMs: Date.now() - start,
    };
  }

  const { candidates, rejected, listingLikeAnchorCount } = extractNooklynListings(
    html, limit,
    { maxRent: target.hardFilters.maxRent, beds: target.hardFilters.beds }
  );

  const blockSignals = detectBlock(html);
  const blockStatus = computeBlockStatus(blockSignals, httpStatus, listingLikeAnchorCount);

  if (candidates.length === 0) {
    const filterRejected = rejected.filter(
      (r) => r.reason === "price_over_max" || r.reason === "beds_incompatible"
    );
    if (filterRejected.length > 0) {
      warnings.push("listing_urls_found_but_all_rejected");
    } else if (html.length < 2_000) {
      warnings.push("empty_or_tiny_html");
    } else if (blockStatus !== "not_blocked") {
      warnings.push("blocked_or_captcha_likely");
    } else if (listingLikeAnchorCount === 0) {
      warnings.push("no_nooklyn_listing_links");
    }
  }

  const priceOverMax = rejected.filter((r) => r.reason === "price_over_max").length;
  const bedsIncompatible = rejected.filter((r) => r.reason === "beds_incompatible").length;
  const candidateStats: CandidateStats = {
    listingLikeUrlsFound: listingLikeAnchorCount,
    acceptedCandidates: candidates.length,
    rejectedListingUrls: priceOverMax + bedsIncompatible,
    duplicateUrls: rejected.filter((r) => r.reason === "duplicate").length,
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
      extractionStrategyResults: {
        "anchor-hrefs": listingLikeAnchorCount,
        "proxy-fallback": 1,
      },
    };
  }

  return {
    targetId: target.id, source: "nooklyn", searchUrl: target.searchUrl,
    httpStatus, blockStatus,
    candidatesFound: candidates.length, candidates, rejected, rejectedPreview, candidateStats, warnings,
    durationMs: Date.now() - start,
    ...(debug && { debug }),
  };
}
