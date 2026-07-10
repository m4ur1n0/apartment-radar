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
import { fetchStreetEasyDirect, fetchHtmlWithProxy } from "../../importers/generic";
import {
  STREETEASY_AREA_IDS,
  searchStreetEasyRentals,
  buildStreetEasyListingUrl,
  type StreetEasyRentalNode,
} from "../../importers/streeteasyApi";

const SE_BASE = "https://streeteasy.com";

// /rental/12345 — most common form for search result card links
const LISTING_RENTAL_RE = /^\/rental\/(\d{5,10})(?:\/|$)/;
// /for-rent/.../listing/12345
const LISTING_FOR_RENT_RE = /^\/for-rent\/[\w/-]+\/listing\/(\d{5,10})(?:\/|$)/;
// /building/slug — generic building page (no unit segment)
const BUILDING_PAGE_RE = /^\/building\/[\w-]+\/?$/;
// /building/slug/unit — unit-level listing
const UNIT_LISTING_RE = /^\/building\/[\w-]+\/[a-zA-Z0-9]+\/?$/;

export function isStreetEasyListingHref(href: string): boolean {
  if (!href) return false;
  try {
    if (href.startsWith("http")) {
      const u = new URL(href);
      if (!u.hostname.endsWith("streeteasy.com")) return false;
      return LISTING_RENTAL_RE.test(u.pathname) || LISTING_FOR_RENT_RE.test(u.pathname);
    }
    return LISTING_RENTAL_RE.test(href) || LISTING_FOR_RENT_RE.test(href);
  } catch {
    return false;
  }
}

// unit-level /building/<slug>/<unit> URL from GraphQL API; not a generic building page
export function isStreetEasyUnitListingPath(urlPath: string): boolean {
  return UNIT_LISTING_RE.test(urlPath);
}

function isStreetEasyBuildingHref(href: string): boolean {
  if (!href) return false;
  try {
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    if (href.startsWith("http") && !new URL(href).hostname.endsWith("streeteasy.com")) return false;
    return BUILDING_PAGE_RE.test(path) && !UNIT_LISTING_RE.test(path);
  } catch {
    return false;
  }
}

function listingIdFromHref(href: string): string | undefined {
  try {
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    return (LISTING_RENTAL_RE.exec(path) ?? LISTING_FOR_RENT_RE.exec(path))?.[1];
  } catch {
    return undefined;
  }
}

function resolveHref(href: string): string | null {
  try {
    const u = new URL(href, SE_BASE);
    if (!u.hostname.endsWith("streeteasy.com")) return null;
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
    if (isStreetEasyListingHref(m[1])) results.push({ href: m[1], index: m.index });
  }
  return results;
}

function collectBuildingAnchors(html: string): Array<{ href: string }> {
  const results: Array<{ href: string }> = [];
  const re = /<a\s[^>]*href=["']([^"'\s>]+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (isStreetEasyBuildingHref(m[1])) results.push({ href: m[1] });
  }
  return results;
}

function tryNextDataListings(html: string): Array<{ id: string; price?: number; beds?: number }> {
  const m =
    html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]{1,500000}?)<\/script>/i) ??
    html.match(/<script[^>]+type=["']application\/json["'][^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]{1,500000}?)<\/script>/i);
  if (!m) return [];

  try {
    const root = JSON.parse(m[1]) as Record<string, unknown>;
    const pp = ((root.props as Record<string, unknown>)?.pageProps ?? {}) as Record<string, unknown>;

    const arr: unknown =
      pp.listings ??
      (pp.searchResults as Record<string, unknown> | undefined)?.listings ??
      (pp.data as Record<string, unknown> | undefined)?.listings ??
      (pp.initialData as Record<string, unknown> | undefined)?.listings;

    if (!Array.isArray(arr)) return [];

    const out: Array<{ id: string; price?: number; beds?: number }> = [];
    for (const item of arr as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const x = item as Record<string, unknown>;
      const id = String(x.id ?? x.listingId ?? x.listing_id ?? "").trim();
      if (!id || !/^\d{5,10}$/.test(id)) continue;
      const rawPrice = x.price ?? x.rent ?? x.asking_price;
      const price = typeof rawPrice === "number" && rawPrice >= 500 && rawPrice <= 15_000 ? rawPrice : undefined;
      const rawBeds = x.beds ?? x.bedrooms;
      const beds = typeof rawBeds === "number" && rawBeds >= 0 && rawBeds <= 10 ? rawBeds : undefined;
      out.push({ id, ...(price != null && { price }), ...(beds != null && { beds }) });
    }
    return out;
  } catch {
    return [];
  }
}

function cardPrice(ctx: string): number | undefined {
  const m = ctx.match(/\$\s*([\d,]{3,7})(?!\s*[KkMm])/);
  if (!m) return undefined;
  const v = parseInt(m[1].replace(",", ""), 10);
  return v >= 500 && v <= 15_000 ? v : undefined;
}

function cardBeds(ctx: string): number | undefined {
  const m = ctx.match(/\b(\d)\s*(?:bed(?:room)?s?|BR)\b/i) ?? ctx.match(/\bStudio\b/i);
  if (!m) return undefined;
  if (/studio/i.test(m[0])) return 0;
  const v = parseInt(m[1], 10);
  return v >= 0 && v <= 10 ? v : undefined;
}

function cardBaths(ctx: string): number | undefined {
  const m = ctx.match(/\b([\d.]+)\s*(?:bath(?:room)?s?|ba)\b/i);
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  return v >= 0 && v <= 10 ? v : undefined;
}

function detectBlock(html: string): string[] {
  const signals: string[] = [];
  if (html.length < 5_000) signals.push("html_too_small");
  const lower = html.toLowerCase();
  if (lower.includes("perimeterx") || lower.includes("px-captcha")) signals.push("perimeterx_captcha");
  if (/access.{0,20}denied/i.test(html)) signals.push("access_denied");
  if (/prove.{0,30}human|not.{0,10}robot/i.test(html)) signals.push("bot_challenge");
  if (/cf-challenge|cloudflare/i.test(html)) signals.push("cloudflare");
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

export function extractStreetEasyListings(
  html: string,
  limit: number,
  hardFilters?: { maxRent?: number; beds?: number }
): { candidates: DiscoveredListingCandidate[]; rejected: DiscoveryRejection[]; listingLikeAnchorCount: number; strategyResults: Record<string, number> } {
  const candidates: DiscoveredListingCandidate[] = [];
  const rejected: DiscoveryRejection[] = [];
  const seen = new Set<string>();

  const anchors = collectListingAnchors(html);
  const anchorCount = anchors.length;

  for (const { href } of collectBuildingAnchors(html)) {
    const canonical = resolveHref(href);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    rejected.push({ url: canonical, reason: "building_url_not_supported" });
  }

  const nextDataListings = tryNextDataListings(html);
  const nextDataUrls = nextDataListings
    .map((item) => `${SE_BASE}/rental/${item.id}`)
    .filter((url) => !anchors.some((a) => resolveHref(a.href) === url));

  const allSources: Array<{ href: string; index: number; metaOverride?: { price?: number; beds?: number } }> = [
    ...anchors.map((a) => ({ ...a, metaOverride: undefined })),
    ...nextDataUrls.map((url) => {
      const item = nextDataListings.find((i) => `${SE_BASE}/rental/${i.id}` === url);
      return { href: url, index: html.length, metaOverride: item ? { price: item.price, beds: item.beds } : undefined };
    }),
  ];

  for (const { href, index, metaOverride } of allSources) {
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

    const ctx = html.slice(Math.max(0, index - 50), index + 900);
    const price = metaOverride?.price ?? cardPrice(ctx);
    const beds = metaOverride?.beds ?? cardBeds(ctx);
    const baths = cardBaths(ctx);
    const listingId = listingIdFromHref(href);

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
      sourceListingId: listingId,
      ...(price != null && { price }),
      ...(beds != null && { beds }),
      ...(baths != null && { baths }),
      confidence,
    });
  }

  return {
    candidates,
    rejected,
    listingLikeAnchorCount: anchorCount,
    strategyResults: {
      "anchor-hrefs": anchorCount,
      "next-data": nextDataListings.length,
    },
  };
}

export function mapStreetEasyRentalNodeToCandidate(node: StreetEasyRentalNode): DiscoveredListingCandidate {
  const listingUrl = buildStreetEasyListingUrl(node.urlPath);
  const baths = node.fullBathroomCount + (node.halfBathroomCount > 0 ? 0.5 : 0);
  const title = node.unit ? `${node.street} #${node.unit}` : node.street;

  return {
    listingUrl,
    canonicalUrl: listingUrl,
    sourceListingId: String(node.id),
    title,
    price: node.price,
    beds: node.bedroomCount,
    baths,
    neighborhood: node.areaName,
    address: node.street,
    ...(node.geoPoint && {
      latitude: node.geoPoint.latitude,
      longitude: node.geoPoint.longitude,
    }),
    confidence: "high",
  };
}

function neighborhoodMatches(neighborhood: string, allowed: string[]): boolean {
  const lower = neighborhood.toLowerCase();
  return allowed.some((n) => {
    const nLower = n.toLowerCase();
    return lower.includes(nLower) || nLower.includes(lower);
  });
}

async function htmlFallback(
  target: SearchTarget,
  scraperApiKeys: string[],
  warnings: string[],
  options: DiscoveryOptions | undefined,
  start: number,
  fallbackDebugBase: Partial<DiscoveryDebug>
): Promise<DiscoveryResult> {
  warnings.push("streeteasy_html_fallback_used");

  const limit = target.discoveryLimits.maxCandidateUrlsPerRun;
  let html: string | undefined;
  let httpStatus: number | undefined;
  let fetchStrategy = "none";

  const directResult = await fetchStreetEasyDirect(target.searchUrl);
  httpStatus = directResult.httpStatus;

  if (!directResult.blocked && directResult.html) {
    html = directResult.html;
    fetchStrategy = `direct-profile-${directResult.profileUsed ?? "?"}`;
  } else {
    warnings.push(...directResult.warnings);
    if (scraperApiKeys.length > 0) {
      const proxyResult = await fetchHtmlWithProxy(target.searchUrl, scraperApiKeys, { source: "streeteasy", render: false });
      if (proxyResult.html) {
        html = proxyResult.html;
        httpStatus = proxyResult.httpStatus ?? httpStatus;
        fetchStrategy = "proxy";
      }
      warnings.push(...proxyResult.warnings);
    } else {
      warnings.push("streeteasy direct blocked and no proxy keys configured");
    }
  }

  if (!html) {
    return {
      targetId: target.id, source: "streeteasy", searchUrl: target.searchUrl,
      httpStatus, blockStatus: "blocked",
      candidatesFound: 0, candidates: [], rejected: [], warnings,
      durationMs: Date.now() - start,
      ...(options?.debug && {
        debug: {
          ...fallbackDebugBase,
          htmlLength: 0, htmlSnippetStart: "", totalAnchorCount: 0, listingLikeAnchorCount: 0,
          firstHrefSamples: [], blockedOrCaptchaLikely: false, blockedOrCaptchaSignals: [],
          extractionStrategyResults: {},
          streeteasyFetchMethod: "streeteasy_html_fallback",
          streeteasyFallbackUsed: true,
        } as DiscoveryDebug,
      }),
    };
  }

  const { candidates, rejected, listingLikeAnchorCount, strategyResults } = extractStreetEasyListings(
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
    } else if (html.length < 5_000) {
      warnings.push("empty_or_tiny_html");
    } else if (blockStatus !== "not_blocked") {
      warnings.push("blocked_or_captcha_likely");
    } else if (listingLikeAnchorCount === 0) {
      warnings.push("no_listing_like_anchors");
    }
    warnings.push(`fetch_strategy_used: ${fetchStrategy}`);
  }

  const priceOverMax = rejected.filter((r) => r.reason === "price_over_max").length;
  const bedsIncompatible = rejected.filter((r) => r.reason === "beds_incompatible").length;
  const buildingUrls = rejected.filter((r) => r.reason === "building_url_not_supported").length;
  const candidateStats: CandidateStats = {
    listingLikeUrlsFound: listingLikeAnchorCount,
    acceptedCandidates: candidates.length,
    rejectedListingUrls: priceOverMax + bedsIncompatible,
    duplicateUrls: rejected.filter((r) => r.reason === "duplicate").length,
    priceOverMax,
    bedsIncompatible,
    ...(buildingUrls > 0 && { unsupportedBuildingUrls: buildingUrls }),
  };

  const rejectedPreview = rejected.slice(0, 20);
  const totalAnchorCount = (html.match(/<a\s[^>]*href=/gi) ?? []).length;
  const titleM = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);

  let debug: DiscoveryDebug | undefined;
  if (options?.debug) {
    debug = {
      ...fallbackDebugBase,
      htmlLength: html.length,
      htmlTitle: titleM ? titleM[1].trim() : undefined,
      htmlSnippetStart: html.slice(0, 500),
      totalAnchorCount,
      listingLikeAnchorCount,
      firstHrefSamples: firstHrefs(html, 25),
      blockedOrCaptchaLikely: blockSignals.length > 0,
      blockedOrCaptchaSignals: blockSignals,
      extractionStrategyResults: strategyResults,
      streeteasyFetchMethod: "streeteasy_html_fallback",
      streeteasyFallbackUsed: true,
    } as DiscoveryDebug;
  }

  return {
    targetId: target.id, source: "streeteasy", searchUrl: target.searchUrl,
    httpStatus, blockStatus,
    candidatesFound: candidates.length, candidates, rejected, rejectedPreview, candidateStats, warnings,
    durationMs: Date.now() - start,
    ...(debug && { debug }),
  };
}

export async function discoverStreetEasyListings(
  target: SearchTarget,
  options?: DiscoveryOptions
): Promise<DiscoveryResult> {
  const start = Date.now();
  const scraperApiKeys = options?.scraperApiKeys ?? [];
  const limit = target.discoveryLimits.maxCandidateUrlsPerRun;
  const warnings: string[] = [];

  const areaIds = STREETEASY_AREA_IDS[target.id];
  const areaIdSource: "configured" | "missing" = areaIds ? "configured" : "missing";

  if (!areaIds) {
    warnings.push(`streeteasy_area_id_not_configured for ${target.id} (${target.label})`);
    return htmlFallback(target, scraperApiKeys, warnings, options, start, {
      streeteasyAreaIdSource: "missing",
      streeteasyFallbackUsed: true,
    });
  }

  // --- GraphQL search API ---
  const searchResult = await searchStreetEasyRentals(
    {
      areaIds,
      maxPrice: target.hardFilters.maxRent,
      minBeds: target.hardFilters.beds,
      maxBeds: target.hardFilters.beds,
    },
    target.searchUrl
  );
  warnings.push(...searchResult.warnings);

  if (searchResult.ok && searchResult.edges) {
    const edges = searchResult.edges;
    const candidates: DiscoveredListingCandidate[] = [];
    const rejected: DiscoveryRejection[] = [];
    const seen = new Set<string>();

    const allowedNeighborhoods = target.expectedFilters.neighborhoods;
    const rejectOutside = target.hardFilters.rejectIfClearlyOutsideNeighborhoods;

    for (const { node } of edges) {
      if (!node.urlPath) {
        rejected.push({ url: `streeteasy:${node.id}`, reason: "missing_url_path" });
        continue;
      }

      const url = buildStreetEasyListingUrl(node.urlPath);

      if (seen.has(url)) {
        rejected.push({ url, reason: "duplicate" });
        continue;
      }
      if (candidates.length >= limit) {
        rejected.push({ url, reason: "exceeded_limit" });
        continue;
      }

      if (node.status && node.status !== "ACTIVE") {
        rejected.push({ url, reason: "inactive_status", note: `status: ${node.status}` });
        continue;
      }
      if (node.price > target.hardFilters.maxRent) {
        rejected.push({ url, reason: "price_over_max", note: `price ${node.price} > ${target.hardFilters.maxRent}`, price: node.price });
        continue;
      }
      if (node.bedroomCount !== target.hardFilters.beds) {
        rejected.push({ url, reason: "beds_incompatible", note: `beds ${node.bedroomCount} != ${target.hardFilters.beds}`, beds: node.bedroomCount });
        continue;
      }
      if (rejectOutside && node.areaName && !neighborhoodMatches(node.areaName, allowedNeighborhoods)) {
        rejected.push({ url, reason: "outside_target_area", note: `areaName "${node.areaName}" not in [${allowedNeighborhoods.join(", ")}]` });
        continue;
      }

      seen.add(url);
      candidates.push(mapStreetEasyRentalNodeToCandidate(node));
    }

    const priceOverMax = rejected.filter((r) => r.reason === "price_over_max").length;
    const bedsIncompatible = rejected.filter((r) => r.reason === "beds_incompatible").length;
    const inactiveCount = rejected.filter((r) => r.reason === "inactive_status").length;
    const outsideCount = rejected.filter((r) => r.reason === "outside_target_area").length;

    const candidateStats: CandidateStats = {
      listingLikeUrlsFound: edges.length,
      acceptedCandidates: candidates.length,
      rejectedListingUrls: priceOverMax + bedsIncompatible + inactiveCount + outsideCount,
      duplicateUrls: rejected.filter((r) => r.reason === "duplicate").length,
      priceOverMax,
      bedsIncompatible,
      ...(outsideCount > 0 && { outsideTargetArea: outsideCount }),
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
        listingLikeAnchorCount: edges.length,
        firstHrefSamples: candidates.slice(0, 5).map((c) => c.listingUrl),
        blockedOrCaptchaLikely: false,
        blockedOrCaptchaSignals: [],
        extractionStrategyResults: { "graphql-api": edges.length },
        streeteasyFetchMethod: "streeteasy_graphql_search",
        streeteasyApiStatus: searchResult.httpStatus,
        streeteasyApiTotalCount: searchResult.totalCount,
        streeteasyApiCriteria: searchResult.criteria,
        streeteasyApiEdgesCount: edges.length,
        streeteasyAreaIds: areaIds,
        streeteasyAreaIdSource: areaIdSource,
        streeteasyFallbackUsed: false,
      };
    }

    return {
      targetId: target.id, source: "streeteasy", searchUrl: target.searchUrl,
      httpStatus: searchResult.httpStatus, blockStatus: "not_blocked",
      candidatesFound: candidates.length, candidates, rejected, rejectedPreview, candidateStats, warnings,
      durationMs: Date.now() - start,
      ...(debug && { debug }),
    };
  }

  // --- GraphQL failed: fall back to HTML scraping ---
  warnings.push("streeteasy_api_search_failed");
  return htmlFallback(target, scraperApiKeys, warnings, options, start, {
    streeteasyApiStatus: searchResult.httpStatus,
    streeteasyAreaIds: areaIds,
    streeteasyAreaIdSource: areaIdSource,
  });
}
