export interface ExtractedImage {
  url: string;
  source?: string;
  position?: number;
  width?: number;
  height?: number;
  altText?: string;
}

export interface ImageExtractionDiagnostics {
  candidatesFound: number;
  filteredCount: number;
  rejectReasons: Record<string, number>;
  sources: string[];
}

const KNOWN_PHOTO_CDNS = [
  "photos.zillowstatic.com",
  "nooklyn-files.s3.amazonaws.com",
  "nooklyn-files.s3.us-east-1.amazonaws.com",
  "images.craigslist.org",
  "pix.craigslist.org",
];

const BAD_DOMAIN_FRAGMENTS = [
  "doubleclick.net",
  "google-analytics.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "adnxs.com",
  "scorecardresearch.com",
  "quantserve.com",
  "amazon-adsystem.com",
];

export function normalizeImageUrl(url: string, baseUrl: string): string | undefined {
  try {
    const u = url.trim();
    if (!u) return undefined;
    if (u.startsWith("data:") || u.startsWith("blob:")) return undefined;
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return new URL(u, baseUrl).href;
  } catch {
    return undefined;
  }
}

export function isClearlyBadImage(url: string): { bad: boolean; reason?: string } {
  if (url.startsWith("data:")) return { bad: true, reason: "data_url" };
  if (url.startsWith("blob:")) return { bad: true, reason: "blob_url" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { bad: true, reason: "invalid_url" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { bad: true, reason: "invalid_url" };
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (host === "maps.googleapis.com" || host === "maps.gstatic.com") {
    return { bad: true, reason: "static_map" };
  }

  for (const frag of BAD_DOMAIN_FRAGMENTS) {
    if (host.includes(frag)) return { bad: true, reason: "tracker_domain" };
  }

  if (path.endsWith(".svg")) return { bad: true, reason: "svg" };

  if (/\/favicon[^/]*$/.test(path)) return { bad: true, reason: "favicon" };
  if (/\/logos?[-./]/.test(path) || path.endsWith("/logo")) return { bad: true, reason: "logo" };
  if (/\/sprites?[-./]/.test(path) || path.endsWith("/sprite")) return { bad: true, reason: "sprite" };
  if (/\/icons?\//.test(path) || /\/assets\/icon/.test(path)) return { bad: true, reason: "icon" };

  if (/\/1x1\./.test(path) || /\/pixel\./.test(path) || /\/beacon\./.test(path)) {
    return { bad: true, reason: "tracking_pixel" };
  }

  if (path.endsWith(".gif") && /\/(?:blank|empty|clear|transparent|spacer)[^/]*\.gif$/.test(path)) {
    return { bad: true, reason: "blank_gif" };
  }

  return { bad: false };
}

// only normalizes - filtering happens later
function parseSrcset(srcset: string, baseUrl: string): string[] {
  const matches = srcset.match(/https?:\/\/[^\s,"']+/g) ?? [];
  const out: string[] = [];
  for (let u of matches) {
    u = u.replace(/,+$/, "");
    const normalized = normalizeImageUrl(u, baseUrl);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function extractImages(html: string, baseUrl: string): {
  images: ExtractedImage[];
  diagnostics: ImageExtractionDiagnostics;
} {
  const candidates: ExtractedImage[] = [];
  const sourcesWithHits = new Set<string>();

  function add(url: string, source: string, extra: Partial<ExtractedImage> = {}): void {
    const normalized = normalizeImageUrl(url, baseUrl);
    if (!normalized) return;
    candidates.push({ url: normalized, source, ...extra });
    sourcesWithHits.add(source);
  }

  function addMany(urls: string[], source: string): void {
    for (const u of urls) add(u, source);
  }

  let m: RegExpExecArray | null;

  // 1. og:image, twitter:image meta tags
  const metaRe = /<meta[^>]+>/gi;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const propM = tag.match(/(?:name|property)=["']([^"']+)["']/i);
    const contentM = tag.match(/content=["']([^"']{1,2000})["']/i);
    if (!propM || !contentM) continue;
    const prop = propM[1].toLowerCase();
    const content = contentM[1];
    if (prop === "og:image" || prop === "og:image:url") add(content, "og-meta");
    else if (prop === "twitter:image" || prop === "twitter:image:src") add(content, "tw-meta");
    else if (prop === "image_src") add(content, "meta-image-src");
  }

  // 2. <link rel="image_src"> or preload
  const linkRe = /<link[^>]+>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const relM = tag.match(/rel=["']([^"']+)["']/i);
    if (!relM) continue;
    const rel = relM[1].toLowerCase();
    if (rel === "image_src") {
      const hrefM = tag.match(/href=["']([^"']{1,2000})["']/i);
      if (hrefM) add(hrefM[1], "link-image-src");
    } else if (rel === "preload") {
      const asM = tag.match(/as=["']image["']/i);
      if (!asM) continue;
      const imgsrcsetM = tag.match(/imagesrcset=["']([^"']{1,4000})["']/i);
      if (imgsrcsetM) addMany(parseSrcset(imgsrcsetM[1], baseUrl), "preload-srcset");
      const hrefM = tag.match(/href=["']([^"']{1,2000})["']/i);
      if (hrefM) add(hrefM[1], "preload-href");
    }
  }

  // 3. <img> tags
  const imgRe = /<img[^>]+>/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const altM = tag.match(/alt=["']([^"']{0,300})["']/i);
    const altText = altM ? altM[1] : undefined;
    const extra = altText ? { altText } : {};

    for (const attr of ["src", "data-src", "data-original", "data-lazy-src", "data-lazy"]) {
      const attrM = tag.match(new RegExp(`${attr}=["']([^"']{1,2000})["']`, "i"));
      if (attrM) add(attrM[1], "img", extra);
    }

    const srcsetM = tag.match(/srcset=["']([^"']{1,4000})["']/i);
    if (srcsetM) addMany(parseSrcset(srcsetM[1], baseUrl), "img-srcset");
  }

  // 4. <source srcset="..."> (picture elements)
  const sourceRe = /<source[^>]+srcset=["']([^"']{1,4000})["'][^>]*>/gi;
  while ((m = sourceRe.exec(html)) !== null) {
    addMany(parseSrcset(m[1], baseUrl), "source-srcset");
  }

  // 5. inline background-image: url(...)
  const bgRe = /background-image\s*:\s*url\(\s*["']?([^"')]{1,2000})["']?\s*\)/gi;
  while ((m = bgRe.exec(html)) !== null) {
    add(m[1], "bg-image");
  }

  // 6. script content: scan for known CDN URLs, including JSON-escaped content in next.js RSC chunks
  const scriptRe = /<script[^>]*>([\s\S]{0,500000}?)<\/script>/gi;
  while ((m = scriptRe.exec(html)) !== null) {
    const raw = m[1];
    const hasCdn = KNOWN_PHOTO_CDNS.some((cdn) => raw.includes(cdn));
    if (!hasCdn) continue;

    // unescaped pass: for regular script content where URLs are in normal quotes
    const urlRe = /["'`](https?:\/\/[^"'`\s]{10,2000})["'`]/g;
    let um: RegExpExecArray | null;
    while ((um = urlRe.exec(raw)) !== null) {
      add(um[1], "script-json");
    }

    // escaped pass: for RSC/JSON-in-JS where quotes and slashes are backslash-escaped
    const unescaped = raw.replace(/\\"/g, '"').replace(/\\\//g, "/");
    if (unescaped !== raw) {
      for (const cdn of KNOWN_PHOTO_CDNS) {
        if (!unescaped.includes(cdn)) continue;
        const cdnRe = new RegExp(`https?://${cdn.replace(/\./g, "\\.")}[^"'\\s<>]{5,500}`, "g");
        while ((um = cdnRe.exec(unescaped)) !== null) {
          const cleaned = um[0].replace(/[,;)}\]"']+$/, "");
          add(cleaned, "script-rsc");
        }
      }
    }
  }

  const candidatesFound = candidates.length;

  // filter clearly bad
  const rejectReasons: Record<string, number> = {};
  const filtered: ExtractedImage[] = [];
  for (const img of candidates) {
    const { bad, reason } = isClearlyBadImage(img.url);
    if (bad) {
      const key = reason ?? "unknown";
      rejectReasons[key] = (rejectReasons[key] ?? 0) + 1;
    } else {
      filtered.push(img);
    }
  }

  const images = dedupeImages(filtered);

  return {
    images,
    diagnostics: {
      candidatesFound,
      filteredCount: candidatesFound - filtered.length,
      rejectReasons,
      sources: [...sourcesWithHits],
    },
  };
}

// permissive recursive JSON traversal — rejects only clearly bad URLs
export function extractImageUrlsFromJsonish(value: unknown, baseUrl: string, depth = 0): string[] {
  if (depth > 6) return [];
  const out: string[] = [];

  if (typeof value === "string") {
    const normalized = normalizeImageUrl(value, baseUrl);
    if (normalized) {
      const { bad } = isClearlyBadImage(normalized);
      if (!bad) out.push(normalized);
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 100); i++) {
      if (out.length >= 50) break;
      out.push(...extractImageUrlsFromJsonish(value[i], baseUrl, depth + 1));
    }
    return out;
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const photoKeyRe = /photo|image|picture|media|gallery|thumb|src|url|href/i;
    for (const [k, v] of Object.entries(obj)) {
      if (out.length >= 50) break;
      if (photoKeyRe.test(k) || depth < 4) {
        out.push(...extractImageUrlsFromJsonish(v, baseUrl, depth + 1));
      }
    }
  }

  return out;
}

export function dedupeImages(images: ExtractedImage[]): ExtractedImage[] {
  const seen = new Set<string>();
  return images.filter((img) => {
    if (seen.has(img.url)) return false;
    seen.add(img.url);
    return true;
  });
}

export function dedupeUrls(urls: string[]): string[] {
  return [...new Set(urls)];
}
