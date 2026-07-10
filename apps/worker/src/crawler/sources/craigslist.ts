import type { SearchTarget } from "../searchTargets";
import type {
  DiscoveredListingCandidate,
  DiscoveryDebug,
  DiscoveryOptions,
  DiscoveryRejection,
  DiscoveryResult,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 12_000;

// new craigslist listing URL format (post-2024):
//   https://www.craigslist.org/view/d/{slug}/{~22-char-base62-hash}
// the hash is alphanumeric, no .html extension
const LISTING_PATH_NEW_RE = /\/view\/d\/[^/"'\s\\]+\/[A-Za-z0-9]{16,30}/;

// old format still exists for pre-migration listings:
//   https://[city].craigslist.org/[area]/[cat]/d/[slug]/[10-digit-id].html
const LISTING_PATH_OLD_RE = /\/[a-z]{2,8}\/[a-z]{2,8}\/d\/[^/"'\s\\]+\/\d{10}\.html/;

function isListingPath(s: string): boolean {
  return LISTING_PATH_NEW_RE.test(s) || LISTING_PATH_OLD_RE.test(s);
}

export function isListingLikeHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("http")) {
    return href.includes("craigslist.org") && isListingPath(href);
  }
  if (href.startsWith("/")) return isListingPath(href);
  return false;
}

// resolve href against a base url, strip fragment and query string
export function resolveAndNormalize(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    if (!u.hostname.endsWith("craigslist.org")) return null;
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

function collectAnchorHrefs(html: string): Array<{ href: string; index: number }> {
  const results: Array<{ href: string; index: number }> = [];
  const re = /<a\s[^>]*href=["']([^"'\s>]+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    results.push({ href: m[1], index: m.index });
  }
  return results;
}

// strategy 1: extract listing URLs from anchor hrefs (relative or absolute)
function extractFromAnchors(
  html: string,
  baseUrl: string
): Array<{ canonical: string; htmlIndex: number }> {
  const anchors = collectAnchorHrefs(html);
  const results: Array<{ canonical: string; htmlIndex: number }> = [];
  for (const { href, index } of anchors) {
    if (!isListingLikeHref(href)) continue;
    const canonical = resolveAndNormalize(href, baseUrl);
    if (canonical) results.push({ canonical, htmlIndex: index });
  }
  return results;
}

// strategy 2: scan script tag text for listing paths embedded as quoted strings
// handles both old and new url formats
function extractFromScripts(
  html: string,
  baseUrl: string
): Array<{ canonical: string; htmlIndex: number }> {
  const results: Array<{ canonical: string; htmlIndex: number }> = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptM: RegExpExecArray | null;
  while ((scriptM = scriptRe.exec(html)) !== null) {
    const content = scriptM[1];
    const contentStart = scriptM.index + scriptM[0].indexOf(scriptM[1]);
    // look for quoted path strings that look like listing paths
    const pathRe = /["'`](\/(?:view|[a-z]{2,8})\/[^"'`\s\\]{10,})["'`]/gi;
    let pathM: RegExpExecArray | null;
    while ((pathM = pathRe.exec(content)) !== null) {
      const href = pathM[1];
      if (!isListingPath(href)) continue;
      const canonical = resolveAndNormalize(href, baseUrl);
      if (canonical) results.push({ canonical, htmlIndex: contentStart + pathM.index });
    }
  }
  return results;
}

export function detectBlocked(html: string): { likely: boolean; signals: string[] } {
  const signals: string[] = [];
  const lower = html.toLowerCase();
  if (html.length < 2_000) signals.push("html_too_small");
  if (lower.includes("px-captcha") || lower.includes("perimeterx")) signals.push("perimeterx_captcha");
  if (lower.includes("cf-challenge") || lower.includes("cloudflare")) signals.push("cloudflare_challenge");
  if (/access.{0,20}denied/i.test(html)) signals.push("access_denied_text");
  if (/prove.{0,30}human|i.?am.{0,10}not.{0,10}robot/i.test(html)) signals.push("bot_challenge_text");
  if (lower.includes("blocked") && lower.includes("craigslist")) signals.push("craigslist_blocked_text");
  return { likely: signals.length > 0, signals };
}

export function getHtmlTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? m[1].trim() : undefined;
}

export function getAllHrefs(html: string): string[] {
  return collectAnchorHrefs(html).map((a) => a.href);
}

function extractCardMeta(ctx: string): Omit<DiscoveredListingCandidate, "listingUrl"> {
  const price = extractPrice(ctx);
  const beds = extractBeds(ctx);
  const title = extractTitle(ctx);
  const neighborhood = extractNeighborhood(ctx);
  return {
    ...(price != null && { price }),
    ...(beds != null && { beds }),
    ...(title && { title }),
    ...(neighborhood && { neighborhood }),
  };
}

export function extractPrice(ctx: string): number | undefined {
  const m = ctx.match(/\$\s*(\d{1,2},?\d{3})/);
  if (!m) return undefined;
  const v = parseInt(m[1].replace(",", ""), 10);
  return v >= 500 && v <= 15_000 ? v : undefined;
}

export function extractBeds(ctx: string): number | undefined {
  const m = ctx.match(/(\d)\s*(?:BR|bd|bed(?:room)?s?)\b/i);
  if (!m) return undefined;
  const v = parseInt(m[1], 10);
  return v >= 0 && v <= 10 ? v : undefined;
}

export function extractTitle(ctx: string): string | undefined {
  const labelM = ctx.match(/<span[^>]*class=["'][^"']*\blabel\b[^"']*["'][^>]*>([^<]{3,120})<\/span>/i);
  if (labelM) return labelM[1].trim();
  const aM = ctx.match(/<a[^>]*class=["'][^"']*posting-title[^"']*["'][^>]*>([^<]{3,120})<\/a>/i);
  if (aM) return aM[1].replace(/<[^>]+>/g, "").trim();
  return undefined;
}

export function extractNeighborhood(ctx: string): string | undefined {
  const m = ctx.match(/\(\s*([A-Za-z][^)]{2,40}?)\s*\)/);
  if (!m) return undefined;
  const candidate = m[1].trim();
  if (/^\d/.test(candidate)) return undefined;
  return candidate;
}

type ExtractResult = {
  candidates: DiscoveredListingCandidate[];
  rejected: DiscoveryRejection[];
  strategyResults: Record<string, number>;
};

export function extractFromHtml(html: string, limit: number, baseUrl?: string): ExtractResult {
  const effectiveBase = baseUrl ?? "https://www.craigslist.org/";
  const candidates: DiscoveredListingCandidate[] = [];
  const rejected: DiscoveryRejection[] = [];
  const seen = new Set<string>();

  const anchorMatches = extractFromAnchors(html, effectiveBase);
  const scriptMatches =
    anchorMatches.length === 0 ? extractFromScripts(html, effectiveBase) : [];

  const strategyResults: Record<string, number> = {
    "anchor-hrefs": anchorMatches.length,
    "script-text": scriptMatches.length,
  };

  for (const { canonical, htmlIndex } of [...anchorMatches, ...scriptMatches]) {
    if (seen.has(canonical)) {
      rejected.push({ url: canonical, reason: "duplicate" });
      continue;
    }
    if (candidates.length >= limit) {
      rejected.push({ url: canonical, reason: "exceeded_limit" });
      continue;
    }
    seen.add(canonical);
    const ctx = html.slice(Math.max(0, htmlIndex - 300), htmlIndex + 900);
    candidates.push({ listingUrl: canonical, ...extractCardMeta(ctx) });
  }

  return { candidates, rejected, strategyResults };
}

function buildZeroCandidateWarnings(
  html: string,
  allHrefs: string[],
  listingLikeHrefCount: number,
  blocked: { likely: boolean },
  scriptMatches: number
): string[] {
  const warnings: string[] = [];
  if (html.length < 2_000) {
    warnings.push("empty_or_tiny_html");
    return warnings;
  }
  if (blocked.likely) warnings.push("blocked_or_captcha_likely");
  if (allHrefs.length === 0) {
    warnings.push("no_anchors_found");
  } else if (listingLikeHrefCount === 0) {
    warnings.push("no_listing_like_anchors");
    if (scriptMatches > 0) warnings.push("possible_embedded_json_results");
  }
  return warnings;
}

export async function discoverCraigslistListings(
  target: SearchTarget,
  options?: DiscoveryOptions
): Promise<DiscoveryResult> {
  const start = Date.now();
  const warnings: string[] = [];
  let httpStatus: number | undefined;
  let finalUrl: string | undefined;
  let html: string | undefined;
  let responseContentType: string | undefined;

  const fetchUrl = target.searchUrl.split("#")[0];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(fetchUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    httpStatus = resp.status;
    finalUrl = resp.url;
    responseContentType = resp.headers.get("content-type") ?? undefined;

    if (!resp.ok) {
      warnings.push(`fetch failed: http ${resp.status}`);
    } else if (!responseContentType?.includes("html")) {
      warnings.push("response is not html");
    } else {
      html = await resp.text();
    }
  } catch (err) {
    warnings.push(`fetch error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!html) {
    return {
      targetId: target.id,
      source: "craigslist",
      searchUrl: target.searchUrl,
      finalUrl,
      httpStatus,
      candidatesFound: 0,
      candidates: [],
      rejected: [],
      warnings,
      durationMs: Date.now() - start,
    };
  }

  const base = finalUrl ?? fetchUrl;
  const { candidates, rejected, strategyResults } = extractFromHtml(
    html,
    target.discoveryLimits.maxCandidateUrlsPerRun,
    base
  );

  if (candidates.length === 0) {
    const allHrefs = getAllHrefs(html);
    const listingLikeHrefCount = allHrefs.filter(isListingLikeHref).length;
    const blocked = detectBlocked(html);
    const scriptMatches = extractFromScripts(html, base).length;
    warnings.push(...buildZeroCandidateWarnings(html, allHrefs, listingLikeHrefCount, blocked, scriptMatches));
  }

  let debug: DiscoveryDebug | undefined;
  if (options?.debug) {
    const allHrefs = getAllHrefs(html);
    const listingLikeHrefCount = allHrefs.filter(isListingLikeHref).length;
    const blocked = detectBlocked(html);
    debug = {
      responseContentType,
      htmlLength: html.length,
      htmlTitle: getHtmlTitle(html),
      htmlSnippetStart: html.slice(0, 500),
      totalAnchorCount: allHrefs.length,
      listingLikeAnchorCount: listingLikeHrefCount,
      firstHrefSamples: allHrefs.slice(0, 25),
      blockedOrCaptchaLikely: blocked.likely,
      blockedOrCaptchaSignals: blocked.signals,
      extractionStrategyResults: strategyResults,
    };
  }

  return {
    targetId: target.id,
    source: "craigslist",
    searchUrl: target.searchUrl,
    finalUrl,
    httpStatus,
    candidatesFound: candidates.length,
    candidates,
    rejected,
    warnings,
    durationMs: Date.now() - start,
    ...(debug && { debug }),
  };
}
