const NOOKLYN_BASE = "https://nooklyn.com";

const BASE_HEADERS = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "cookie": "foo=bar",
  "priority": "u=1, i",
  "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
};

export type NooklynSearchParams = {
  beds: number[];
  maxPrice: number;
  page?: number;
};

export type NooklynSearchListing = {
  id: number | string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  neighborhood?: { name: string };
  address?: string;
  short_address?: string;
  square_feet?: number;
  no_fee?: boolean;
  url?: string;
  longitude?: number;
  latitude?: number;
};

export type NooklynSearchData = {
  ok: boolean;
  page_count: number;
  total_count: number;
  listings: NooklynSearchListing[];
};

export type NooklynSearchResult = {
  ok: boolean;
  httpStatus?: number;
  warnings: string[];
  data?: NooklynSearchData;
};

export type NooklynDetailResult = {
  ok: boolean;
  httpStatus?: number;
  warnings: string[];
  listing?: Record<string, unknown>;
};

export function extractNooklynSlugFromUrl(url: string): string | null {
  const m = url.match(/\/listings?\/([\w-]+)/i);
  return m ? m[1] : null;
}

export function buildNooklynListingUrl(slug: string): string {
  return `${NOOKLYN_BASE}/listings/${slug}`;
}

export function buildNooklynFetchUrl(slug: string): string {
  return `${NOOKLYN_BASE}/api/v2/listings.fetch?slug=${encodeURIComponent(slug)}`;
}

export function normalizeNooklynPrice(rawPrice: number): number {
  return Math.round(rawPrice / 100);
}

export async function searchNooklynListings(
  params: NooklynSearchParams,
  referer: string
): Promise<NooklynSearchResult> {
  const warnings: string[] = [];
  const body = {
    amenity_list: [],
    address: "",
    min_baths: 0,
    bed_list: params.beds,
    liked: false,
    market_as: "",
    move_in: "",
    no_fee: false,
    order: "",
    pets: "",
    platform_listing: false,
    min_ppsf: null,
    max_ppsf: null,
    min_price: null,
    max_price: params.maxPrice,
    min_square_feet: null,
    max_square_feet: null,
    network: null,
    page: params.page ?? 1,
    neighborhood_id_list: [],
    region_id_list: [],
    subway_id_list: [],
    subway_stop_list: [],
    building_id_list: [],
    management_company_uuid_list: [],
  };

  let httpStatus: number | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(`${NOOKLYN_BASE}/api/v2/listings.search`, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        "content-type": "application/json",
        "origin": NOOKLYN_BASE,
        "referer": referer,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    httpStatus = resp.status;
    if (!resp.ok) {
      warnings.push(`nooklyn search api http ${resp.status}`);
      return { ok: false, httpStatus, warnings };
    }
    const raw = await resp.json() as unknown;
    if (!raw || typeof raw !== "object") {
      warnings.push("nooklyn search api: non-object response");
      return { ok: false, httpStatus, warnings };
    }
    const data = raw as NooklynSearchData;
    if (!Array.isArray(data.listings)) {
      warnings.push("nooklyn search api: missing listings array");
      return { ok: false, httpStatus, warnings };
    }
    return { ok: true, httpStatus, warnings, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`nooklyn search api fetch error: ${msg}`);
    return { ok: false, httpStatus, warnings };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchNooklynListingBySlug(
  slug: string,
  listingUrl?: string
): Promise<NooklynDetailResult> {
  const warnings: string[] = [];
  const referer = listingUrl ?? buildNooklynListingUrl(slug);
  const apiUrl = buildNooklynFetchUrl(slug);

  let httpStatus: number | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(apiUrl, {
      headers: { ...BASE_HEADERS, "referer": referer },
      signal: controller.signal,
    });
    httpStatus = resp.status;
    if (!resp.ok) {
      warnings.push(`nooklyn fetch api http ${resp.status}`);
      return { ok: false, httpStatus, warnings };
    }
    const raw = await resp.json() as unknown;
    if (!raw || typeof raw !== "object") {
      warnings.push("nooklyn fetch api: non-object response");
      return { ok: false, httpStatus, warnings };
    }
    const obj = raw as Record<string, unknown>;
    // response may be { listing: {...} } or the listing directly
    const listing =
      "listing" in obj && obj.listing && typeof obj.listing === "object"
        ? (obj.listing as Record<string, unknown>)
        : obj;
    return { ok: true, httpStatus, warnings, listing };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`nooklyn fetch api error: ${msg}`);
    return { ok: false, httpStatus, warnings };
  } finally {
    clearTimeout(timer);
  }
}
