export interface ExtractedImage {
  url: string;
  source?: string;
  position?: number;
  width?: number;
  height?: number;
  altText?: string;
}

// photo CDN hostnames that are always listing images
const KNOWN_PHOTO_CDNS = [
  "photos.zillowstatic.com",
  "nooklyn-files.s3.amazonaws.com",
  "nooklyn-files.s3.us-east-1.amazonaws.com",
  "images.craigslist.org",
  "pix.craigslist.org",
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

export function filterLikelyListingImage(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  // known CDNs are always valid
  if (KNOWN_PHOTO_CDNS.includes(host)) return true;

  // reject map tiles and tracking domains
  if (host === "maps.googleapis.com" || host === "maps.gstatic.com") return false;
  if (
    host.includes("doubleclick.net") ||
    host.includes("google-analytics.com") ||
    host.includes("googletagmanager.com") ||
    host.includes("googlesyndication.com")
  ) return false;

  // reject svg
  if (path.endsWith(".svg")) return false;

  // reject tracking/pixel path segments
  if (/\/1x1\./.test(path) || /\/pixel\./.test(path) || /\/beacon\./.test(path) || /\/tracking\./.test(path)) return false;

  // reject icon/logo/sprite paths
  if (/\/favicon/.test(path)) return false;
  if (/\/logos?[-./]/.test(path)) return false;
  if (/\/sprite/.test(path)) return false;
  if (/\/icons?\//.test(path)) return false;
  if (/\/assets\/icon/.test(path)) return false;

  // check extension (without query string)
  const extMatch = path.match(/\.(jpg|jpeg|png|webp|avif|gif)$/);
  if (!extMatch) return false;

  // gif: reject tracking variants
  if (extMatch[1] === "gif") {
    if (/\/1x1|\/pixel|\/track|\/beacon|\/blank/.test(path)) return false;
  }

  return true;
}

// extract all https:// URLs from a srcset attribute string
function parseSrcset(srcset: string, baseUrl: string): string[] {
  const matches = srcset.match(/https?:\/\/[^\s,"']+/g) ?? [];
  const out: string[] = [];
  for (let u of matches) {
    // strip trailing commas left from srcset descriptors
    u = u.replace(/,+$/, "");
    const normalized = normalizeImageUrl(u, baseUrl);
    if (normalized && filterLikelyListingImage(normalized)) out.push(normalized);
  }
  return out;
}

export function extractImageUrlsFromHtml(html: string, baseUrl: string): ExtractedImage[] {
  const results: ExtractedImage[] = [];

  function push(url: string, source: string, extra: Partial<ExtractedImage> = {}): void {
    const normalized = normalizeImageUrl(url, baseUrl);
    if (normalized && filterLikelyListingImage(normalized)) {
      results.push({ url: normalized, source, ...extra });
    }
  }

  // 1. og:image and twitter:image meta tags
  const metaRe = /<meta[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const propM = tag.match(/(?:name|property)=["']([^"']+)["']/i);
    const contentM = tag.match(/content=["']([^"']{1,2000})["']/i);
    if (!propM || !contentM) continue;
    const prop = propM[1].toLowerCase();
    const content = contentM[1];
    if (prop === "og:image") push(content, "og-meta");
    else if (prop === "twitter:image" || prop === "twitter:image:src") push(content, "tw-meta");
  }

  // 2. <link rel="image_src">
  const linkImgSrcRe = /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']{1,2000})["'][^>]*>/gi;
  while ((m = linkImgSrcRe.exec(html)) !== null) {
    push(m[1], "link-src");
  }
  // alternate attribute order
  const linkImgSrcRe2 = /<link[^>]+href=["']([^"']{1,2000})["'][^>]+rel=["']image_src["'][^>]*>/gi;
  while ((m = linkImgSrcRe2.exec(html)) !== null) {
    push(m[1], "link-src");
  }

  // 3. <link rel="preload" as="image">
  const preloadRe = /<link[^>]+rel=["']preload["'][^>]+as=["']image["'][^>]*>/gi;
  while ((m = preloadRe.exec(html)) !== null) {
    const tag = m[0];
    const imgsrcsetM = tag.match(/imagesrcset=["']([^"']{1,4000})["']/i);
    if (imgsrcsetM) {
      for (const u of parseSrcset(imgsrcsetM[1], baseUrl)) {
        results.push({ url: u, source: "preload-imgsrcset" });
      }
    }
    const hrefM = tag.match(/href=["']([^"']{1,2000})["']/i);
    if (hrefM) push(hrefM[1], "preload-href");
  }

  // 4. <img> tags
  const imgRe = /<img[^>]+>/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const altM = tag.match(/alt=["']([^"']{0,300})["']/i);
    const altText = altM ? altM[1] : undefined;

    for (const attr of ["src", "data-src", "data-original"]) {
      const attrRe = new RegExp(`${attr}=["']([^"']{1,2000})["']`, "i");
      const valM = tag.match(attrRe);
      if (valM) push(valM[1], "img", altText ? { altText } : {});
    }

    const srcsetM = tag.match(/srcset=["']([^"']{1,4000})["']/i);
    if (srcsetM) {
      for (const u of parseSrcset(srcsetM[1], baseUrl)) {
        results.push({ url: u, source: "img-srcset", ...(altText ? { altText } : {}) });
      }
    }
  }

  // 5. <source srcset="..."> tags
  const sourceRe = /<source[^>]+srcset=["']([^"']{1,4000})["'][^>]*>/gi;
  while ((m = sourceRe.exec(html)) !== null) {
    for (const u of parseSrcset(m[1], baseUrl)) {
      results.push({ url: u, source: "source-srcset" });
    }
  }

  // 6. inline style background-image: url(...)
  const bgRe = /background-image\s*:\s*url\(\s*["']?([^"')]{1,2000})["']?\s*\)/gi;
  while ((m = bgRe.exec(html)) !== null) {
    push(m[1], "bg-image");
  }

  // 7. script tag content — only scan when a known CDN hostname appears
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRe.exec(html)) !== null) {
    const content = m[1];
    const hasCdn = KNOWN_PHOTO_CDNS.some((cdn) => content.includes(cdn));
    if (!hasCdn) continue;
    const urlRe = /["'](https?:\/\/[^"']{10,2000})["']/g;
    let um: RegExpExecArray | null;
    while ((um = urlRe.exec(content)) !== null) {
      push(um[1], "script-json");
    }
  }

  return results;
}

export function extractImageUrlsFromJsonish(value: unknown, baseUrl: string, depth = 0): string[] {
  if (depth > 6) return [];
  const out: string[] = [];

  if (typeof value === "string") {
    const normalized = normalizeImageUrl(value, baseUrl);
    if (normalized && filterLikelyListingImage(normalized)) out.push(normalized);
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
      // always recurse into photo-related keys; only recurse into others if shallow
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
