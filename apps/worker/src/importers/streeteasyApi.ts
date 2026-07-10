const SE_BASE = "https://streeteasy.com";
const SE_API_URL = "https://api-v6.streeteasy.com/";

// verified area IDs for the SE GraphQL search API; add more as confirmed
export const STREETEASY_AREA_IDS: Readonly<Record<string, number[]>> = {
  "streeteasy-url-first-bushwick-2br-max3100": [313],
};

const STREETEASY_API_HEADERS: Record<string, string> = {
  "accept": "application/json",
  "accept-language": "en-US,en;q=0.9",
  "apollographql-client-name": "srp-frontend-service",
  "app-version": "1.0.0",
  "content-type": "application/json",
  "cookie": "foo=bar",
  "origin": SE_BASE,
  "os": "web",
  "priority": "u=1, i",
  "referer": `${SE_BASE}/`,
  "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "x-forwarded-proto": "https",
};

const STREETEASY_DETAIL_HEADERS: Record<string, string> = {
  "accept": "application/json",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "max-age=0",
  "cookie": "foo=bar",
  "priority": "u=0, i",
  "referer": `${SE_BASE}/`,
  "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
};

const STREETEASY_SEARCH_RENTALS_QUERY = `
query GetListingRental($input: SearchRentalsInput!) {
  searchRentals(input: $input) {
    search {
      criteria
    }
    totalCount
    edges {
      ... on OrganicRentalEdge {
        node {
          id areaName bedroomCount buildingType fullBathroomCount
          geoPoint { latitude longitude }
          halfBathroomCount
          leadMedia { photo { key } }
          price totalMonthlyPrice sourceGroupLabel status
          street unit urlPath tier
        }
      }
      ... on FeaturedRentalEdge {
        node {
          id areaName bedroomCount buildingType fullBathroomCount
          geoPoint { latitude longitude }
          halfBathroomCount
          leadMedia { photo { key } }
          price totalMonthlyPrice sourceGroupLabel status
          street unit urlPath tier
        }
      }
    }
  }
}`.trim();

export type StreetEasySearchParams = {
  areaIds: number[];
  maxPrice: number;
  minBeds: number;
  maxBeds: number;
  page?: number;
  perPage?: number;
};

export type StreetEasyRentalNode = {
  id: string;
  areaName: string;
  bedroomCount: number;
  buildingType: string;
  fullBathroomCount: number;
  halfBathroomCount: number;
  geoPoint?: { latitude: number; longitude: number };
  leadMedia?: { photo?: { key?: string } };
  price: number;
  totalMonthlyPrice: number | null;
  sourceGroupLabel: string;
  status: string;
  street: string;
  unit: string;
  urlPath: string;
  tier: string;
};

export type StreetEasySearchResult = {
  ok: boolean;
  httpStatus?: number;
  warnings: string[];
  totalCount?: number;
  criteria?: string;
  edges?: Array<{ node: StreetEasyRentalNode }>;
};

export type StreetEasyDetailResult = {
  ok: boolean;
  httpStatus?: number;
  warnings: string[];
  contentType: "json" | "html" | "unknown";
  json?: Record<string, unknown> | unknown[];
  html?: string;
};

export function extractStreetEasyListingPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("streeteasy.com")) return null;
    return u.pathname || null;
  } catch {
    // relative path — return as-is if it looks like a path
    return url.startsWith("/") ? url.split("?")[0].split("#")[0] : null;
  }
}

export function buildStreetEasyListingUrl(urlPath: string): string {
  return `${SE_BASE}${urlPath.startsWith("/") ? "" : "/"}${urlPath}`;
}

export function normalizeStreetEasyListingUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

export async function searchStreetEasyRentals(
  params: StreetEasySearchParams,
  referer: string
): Promise<StreetEasySearchResult> {
  const warnings: string[] = [];
  const body = {
    query: STREETEASY_SEARCH_RENTALS_QUERY,
    variables: {
      input: {
        filters: {
          rentalStatus: "ACTIVE",
          areas: params.areaIds,
          price: { lowerBound: null, upperBound: params.maxPrice },
          bedrooms: { lowerBound: params.minBeds, upperBound: params.maxBeds },
        },
        page: params.page ?? 1,
        perPage: params.perPage ?? 500,
        sorting: { attribute: "RECOMMENDED", direction: "DESCENDING" },
        userSearchToken: "apt-radar",
        adStrategy: "NONE",
      },
    },
  };

  let httpStatus: number | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch(SE_API_URL, {
      method: "POST",
      headers: { ...STREETEASY_API_HEADERS, referer },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    httpStatus = resp.status;
    if (!resp.ok) {
      warnings.push(`streeteasy graphql api http ${resp.status}`);
      return { ok: false, httpStatus, warnings };
    }
    const raw = await resp.json() as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      warnings.push("streeteasy graphql api: unexpected response shape");
      return { ok: false, httpStatus, warnings };
    }
    const obj = raw as Record<string, unknown>;
    const data = obj.data as Record<string, unknown> | undefined;
    const searchRentals = data?.searchRentals as Record<string, unknown> | undefined;
    if (!searchRentals) {
      warnings.push("streeteasy graphql api: missing data.searchRentals");
      return { ok: false, httpStatus, warnings };
    }
    const edges = searchRentals.edges as Array<{ node: StreetEasyRentalNode }> | undefined;
    if (!Array.isArray(edges)) {
      warnings.push("streeteasy graphql api: missing edges array");
      return { ok: false, httpStatus, warnings };
    }
    const search = searchRentals.search as Record<string, unknown> | undefined;
    const criteria = typeof search?.criteria === "string" ? search.criteria : undefined;
    const totalCount = typeof searchRentals.totalCount === "number" ? searchRentals.totalCount : undefined;
    return { ok: true, httpStatus, warnings, totalCount, criteria, edges };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`streeteasy graphql api fetch error: ${msg}`);
    return { ok: false, httpStatus, warnings };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStreetEasyListingJsonOrHtml(url: string): Promise<StreetEasyDetailResult> {
  const warnings: string[] = [];
  let httpStatus: number | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(url, {
      headers: STREETEASY_DETAIL_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    httpStatus = resp.status;
    if (!resp.ok) {
      warnings.push(`streeteasy detail fetch http ${resp.status}`);
      return { ok: false, httpStatus, warnings, contentType: "unknown" };
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (ct.includes("json") && !ct.includes("html")) {
      const raw = await resp.json() as unknown;
      const json = (Array.isArray(raw) || (raw && typeof raw === "object")) ? raw as Record<string, unknown> | unknown[] : undefined;
      if (!json) {
        warnings.push("streeteasy detail: json content-type but non-object response");
        return { ok: false, httpStatus, warnings, contentType: "json" };
      }
      return { ok: true, httpStatus, warnings, contentType: "json", json };
    }
    const html = await resp.text();
    if (!html || html.length < 200) {
      warnings.push("streeteasy detail: empty or tiny response");
      return { ok: false, httpStatus, warnings, contentType: "html" };
    }
    return { ok: true, httpStatus, warnings, contentType: "html", html };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`streeteasy detail fetch error: ${msg}`);
    return { ok: false, httpStatus, warnings, contentType: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}
