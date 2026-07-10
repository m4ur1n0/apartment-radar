import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isStreetEasyListingHref,
  isStreetEasyUnitListingPath,
  extractStreetEasyListings,
  mapStreetEasyRentalNodeToCandidate,
  discoverStreetEasyListings,
} from "../sources/streeteasy";
import {
  buildStreetEasyListingUrl,
  normalizeStreetEasyListingUrl,
  extractStreetEasyListingPath,
  fetchStreetEasyListingJsonOrHtml,
  type StreetEasyRentalNode,
} from "../../importers/streeteasyApi";
import type { SearchTarget } from "../searchTargets";

afterEach(() => { vi.restoreAllMocks(); });

// bushwick target has area ID 313 in STREETEASY_AREA_IDS → GraphQL path
const STUB_TARGET_BUSHWICK: SearchTarget = {
  id: "streeteasy-url-first-bushwick-2br-max3100",
  source: "streeteasy",
  priority: "primary",
  enabled: true,
  label: "StreetEasy / Bushwick / 2BR / max $3100",
  searchUrl: "https://streeteasy.com/for-rent/bushwick/price%3A-3100%7Cbeds%3A2",
  urlNeedsVerification: false,
  expectedFilters: { maxRent: 3100, beds: 2, allowedBoroughs: ["Brooklyn"], neighborhoods: ["Bushwick"] },
  hardFilters: {
    maxRent: 3100, beds: 2, minBaths: 1,
    allowedBoroughs: ["Brooklyn"],
    rejectIfClearlyOutsideNeighborhoods: true,
    allowUnknownNeighborhoodIfSearchTargetIsSpecific: true,
  },
  discoveryLimits: { maxCandidateUrlsPerRun: 40 },
};

// unknown area ID → HTML fallback path
const STUB_TARGET: SearchTarget = {
  id: "test-streeteasy",
  source: "streeteasy",
  priority: "primary",
  enabled: true,
  label: "Test StreetEasy",
  searchUrl: "https://streeteasy.com/for-rent/bushwick/price%3A-3100%7Cbeds%3A2",
  urlNeedsVerification: false,
  expectedFilters: { maxRent: 3100, beds: 2, allowedBoroughs: ["Brooklyn"], neighborhoods: ["Bushwick"] },
  hardFilters: {
    maxRent: 3100, beds: 2, minBaths: 1,
    allowedBoroughs: ["Brooklyn"],
    rejectIfClearlyOutsideNeighborhoods: true,
    allowUnknownNeighborhoodIfSearchTargetIsSpecific: true,
  },
  discoveryLimits: { maxCandidateUrlsPerRun: 40 },
};

const SE_PADDING = "<p>streeteasy rental listing in brooklyn</p>".repeat(150);

function makeHtml(listings: Array<{ id: number; price?: number; beds?: number }>): string {
  const cards = listings.map(({ id, price, beds }) => `
    <div class="listing-card">
      <a href="/rental/${id}">
        ${price != null ? `<span class="price">$${price}/mo</span>` : ""}
        ${beds != null ? `<span>${beds} bed</span>` : ""}
      </a>
    </div>
  `).join("\n");
  return `<html><head>
    <title>Bushwick Rentals in Brooklyn | StreetEasy</title>
    <link rel="canonical" href="https://streeteasy.com/for-rent/bushwick/price:-3100|beds:2"/>
  </head><body>
    <script>var __next_f = 1; var listingId = 123; var propertyDetails = {};</script>
    ${SE_PADDING}
    ${cards}
  </body></html>`;
}

function makeNode(overrides: Partial<StreetEasyRentalNode> = {}): StreetEasyRentalNode {
  return {
    id: "12345",
    areaName: "Bushwick",
    bedroomCount: 2,
    buildingType: "apartment",
    fullBathroomCount: 1,
    halfBathroomCount: 0,
    geoPoint: { latitude: 40.694, longitude: -73.932 },
    leadMedia: null as unknown as undefined,
    price: 2800,
    totalMonthlyPrice: null,
    sourceGroupLabel: "StreetEasy",
    status: "ACTIVE",
    street: "123 Test St",
    unit: "1A",
    urlPath: "/building/123-test-st-brooklyn/1a",
    tier: "standard",
    ...overrides,
  };
}

function makeGraphQLResponse(nodes: StreetEasyRentalNode[]) {
  return {
    data: {
      searchRentals: {
        search: { criteria: "area:313|beds:2-2|price:-3100|status:open" },
        totalCount: nodes.length,
        edges: nodes.map((node) => ({ node })),
      },
    },
  };
}

function graphqlFetchMock(response: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true, status: 200,
    headers: { get: (h: string) => h === "content-type" ? "application/json" : null },
    json: async () => response,
  });
}

const PADDING = "<p>streeteasy rental listings in brooklyn new york</p>".repeat(100);

describe("isStreetEasyListingHref", () => {
  it("accepts /rental/12345 format", () => {
    expect(isStreetEasyListingHref("/rental/12345")).toBe(true);
    expect(isStreetEasyListingHref("/rental/7073869")).toBe(true);
    expect(isStreetEasyListingHref("https://streeteasy.com/rental/12345")).toBe(true);
  });

  it("accepts /for-rent/.../listing/12345 format", () => {
    expect(isStreetEasyListingHref("/for-rent/bushwick/123-main-st/listing/12345")).toBe(true);
  });

  it("rejects rental IDs that are too short or too long", () => {
    expect(isStreetEasyListingHref("/rental/123")).toBe(false);
    expect(isStreetEasyListingHref("/rental/12345678901")).toBe(false);
  });

  it("rejects non-listing SE paths", () => {
    expect(isStreetEasyListingHref("/for-rent/bushwick")).toBe(false);
    expect(isStreetEasyListingHref("/neighborhoods/bushwick")).toBe(false);
    expect(isStreetEasyListingHref("")).toBe(false);
  });

  it("rejects non-streeteasy URLs", () => {
    expect(isStreetEasyListingHref("https://nooklyn.com/rental/12345")).toBe(false);
  });
});

describe("isStreetEasyUnitListingPath", () => {
  it("accepts /building/<slug>/<unit> paths", () => {
    expect(isStreetEasyUnitListingPath("/building/29-granite-street-brooklyn/3")).toBe(true);
    expect(isStreetEasyUnitListingPath("/building/1362-decatur-street-brooklyn/1f")).toBe(true);
    expect(isStreetEasyUnitListingPath("/building/1115-decatur-street-brooklyn/3a")).toBe(true);
  });

  it("rejects /building/<slug> pages (no unit segment)", () => {
    expect(isStreetEasyUnitListingPath("/building/29-granite-street-brooklyn")).toBe(false);
    expect(isStreetEasyUnitListingPath("/building/29-granite-street-brooklyn/")).toBe(false);
  });

  it("rejects non-building paths", () => {
    expect(isStreetEasyUnitListingPath("/rental/12345")).toBe(false);
    expect(isStreetEasyUnitListingPath("/for-rent/bushwick")).toBe(false);
  });
});

describe("buildStreetEasyListingUrl", () => {
  it("prepends streeteasy.com base", () => {
    expect(buildStreetEasyListingUrl("/building/29-granite-street-brooklyn/3"))
      .toBe("https://streeteasy.com/building/29-granite-street-brooklyn/3");
    expect(buildStreetEasyListingUrl("/rental/12345"))
      .toBe("https://streeteasy.com/rental/12345");
  });
});

describe("normalizeStreetEasyListingUrl", () => {
  it("strips query params and hash", () => {
    expect(normalizeStreetEasyListingUrl(
      "https://streeteasy.com/building/1496-bushwick-avenue-brooklyn/4a?source=search&foo=bar#anchor"
    )).toBe("https://streeteasy.com/building/1496-bushwick-avenue-brooklyn/4a");
  });

  it("returns clean URLs unchanged", () => {
    expect(normalizeStreetEasyListingUrl("https://streeteasy.com/building/slug/unit"))
      .toBe("https://streeteasy.com/building/slug/unit");
  });
});

describe("extractStreetEasyListingPath", () => {
  it("extracts path from absolute URL", () => {
    expect(extractStreetEasyListingPath("https://streeteasy.com/building/slug/1a"))
      .toBe("/building/slug/1a");
  });

  it("returns relative paths as-is", () => {
    expect(extractStreetEasyListingPath("/building/slug/unit")).toBe("/building/slug/unit");
  });

  it("returns null for non-streeteasy URLs", () => {
    expect(extractStreetEasyListingPath("https://nooklyn.com/listings/slug")).toBeNull();
  });
});

describe("mapStreetEasyRentalNodeToCandidate", () => {
  it("maps node to candidate with all fields", () => {
    const node = makeNode();
    const c = mapStreetEasyRentalNodeToCandidate(node);
    expect(c.listingUrl).toBe("https://streeteasy.com/building/123-test-st-brooklyn/1a");
    expect(c.canonicalUrl).toBe("https://streeteasy.com/building/123-test-st-brooklyn/1a");
    expect(c.sourceListingId).toBe("12345");
    expect(c.title).toBe("123 Test St #1A");
    expect(c.price).toBe(2800);
    expect(c.beds).toBe(2);
    expect(c.baths).toBe(1);
    expect(c.neighborhood).toBe("Bushwick");
    expect(c.address).toBe("123 Test St");
    expect(c.latitude).toBe(40.694);
    expect(c.longitude).toBe(-73.932);
    expect(c.confidence).toBe("high");
  });

  it("adds half bath to full bath count", () => {
    const node = makeNode({ fullBathroomCount: 1, halfBathroomCount: 1 });
    expect(mapStreetEasyRentalNodeToCandidate(node).baths).toBe(1.5);
  });

  it("omits geo when geoPoint is missing", () => {
    const node = makeNode({ geoPoint: undefined });
    const c = mapStreetEasyRentalNodeToCandidate(node);
    expect(c.latitude).toBeUndefined();
    expect(c.longitude).toBeUndefined();
  });

  it("omits unit from title when unit is empty", () => {
    const node = makeNode({ unit: "" });
    expect(mapStreetEasyRentalNodeToCandidate(node).title).toBe("123 Test St");
  });
});

describe("extractStreetEasyListings", () => {
  it("extracts listing candidates from card HTML", () => {
    const html = makeHtml([
      { id: 7000001, price: 2800, beds: 2 },
      { id: 7000002, price: 2500, beds: 2 },
    ]);
    const { candidates, rejected } = extractStreetEasyListings(html, 40);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].listingUrl).toBe("https://streeteasy.com/rental/7000001");
    expect(candidates[0].sourceListingId).toBe("7000001");
    expect(candidates[0].price).toBe(2800);
    expect(candidates[0].beds).toBe(2);
    expect(candidates[0].confidence).toBe("high");
    expect(rejected).toHaveLength(0);
  });

  it("deduplicates repeated listing URLs", () => {
    const html = makeHtml([
      { id: 7000001, price: 2800, beds: 2 },
      { id: 7000001, price: 2800, beds: 2 },
    ]);
    const { candidates, rejected } = extractStreetEasyListings(html, 40);
    expect(candidates).toHaveLength(1);
    expect(rejected.some((r) => r.reason === "duplicate")).toBe(true);
  });

  it("respects the per-run limit", () => {
    const listings = Array.from({ length: 10 }, (_, i) => ({ id: 7000000 + i, price: 2000, beds: 2 }));
    const html = makeHtml(listings);
    const { candidates, rejected } = extractStreetEasyListings(html, 5);
    expect(candidates).toHaveLength(5);
    expect(rejected.filter((r) => r.reason === "exceeded_limit")).toHaveLength(5);
  });

  it("hard-filters listings over maxRent", () => {
    const html = makeHtml([
      { id: 7000001, price: 2500, beds: 2 },
      { id: 7000002, price: 4000, beds: 2 },
    ]);
    const { candidates, rejected } = extractStreetEasyListings(html, 40, { maxRent: 3100 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceListingId).toBe("7000001");
    expect(rejected.some((r) => r.note?.includes("price 4000"))).toBe(true);
  });

  it("hard-filters listings with wrong bed count", () => {
    const html = makeHtml([
      { id: 7000001, price: 2500, beds: 2 },
      { id: 7000002, price: 1800, beds: 1 },
    ]);
    const { candidates, rejected } = extractStreetEasyListings(html, 40, { beds: 2 });
    expect(candidates).toHaveLength(1);
    expect(rejected.some((r) => r.note?.includes("beds 1"))).toBe(true);
  });

  it("extracts listings from __NEXT_DATA__ when anchors find none", () => {
    const nextData = JSON.stringify({
      props: { pageProps: { listings: [{ id: 9000001, price: 2700, beds: 2 }] } },
    });
    const html = `<html><body>
      <script id="__NEXT_DATA__" type="application/json">${nextData}</script>
      <p>no anchor listing links here</p>
    </body></html>`;
    const { candidates } = extractStreetEasyListings(html, 40);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceListingId).toBe("9000001");
    expect(candidates[0].price).toBe(2700);
  });

  it("assigns medium confidence when only price is known", () => {
    const html = makeHtml([{ id: 7000001, price: 2800 }]);
    const { candidates } = extractStreetEasyListings(html, 40);
    expect(candidates[0].confidence).toBe("medium");
  });

  it("assigns low confidence when no metadata found", () => {
    const html = makeHtml([{ id: 7000001 }]);
    const { candidates } = extractStreetEasyListings(html, 40);
    expect(candidates[0].confidence).toBe("low");
  });

  it("normalizes relative hrefs to absolute canonical URLs", () => {
    const html = makeHtml([{ id: 7000001 }]);
    const { candidates } = extractStreetEasyListings(html, 40);
    expect(candidates[0].listingUrl).toBe("https://streeteasy.com/rental/7000001");
    expect(candidates[0].canonicalUrl).toBe("https://streeteasy.com/rental/7000001");
  });
});

describe("fetchStreetEasyListingJsonOrHtml", () => {
  it("returns contentType html for html response", async () => {
    const html = "<html><head><title>Test</title></head><body>content</body></html>" + "x".repeat(200);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: (h: string) => h === "content-type" ? "text/html; charset=utf-8" : null },
      text: async () => html,
    }));
    const result = await fetchStreetEasyListingJsonOrHtml("https://streeteasy.com/building/slug/1a");
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe("html");
    expect(result.html).toBeDefined();
  });

  it("returns contentType json for json response", async () => {
    const json = [{ "@type": "Apartment", "name": "Test" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: (h: string) => h === "content-type" ? "application/json" : null },
      json: async () => json,
    }));
    const result = await fetchStreetEasyListingJsonOrHtml("https://streeteasy.com/building/slug/1a");
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe("json");
    expect(result.json).toEqual(json);
  });

  it("returns ok false on non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403,
      headers: { get: () => "text/html" },
      text: async () => "blocked",
    }));
    const result = await fetchStreetEasyListingJsonOrHtml("https://streeteasy.com/building/slug/1a");
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(403);
  });
});

describe("discoverStreetEasyListings", () => {
  it("returns candidates from GraphQL API response", async () => {
    const nodes = [
      makeNode({ id: "111", price: 2800, urlPath: "/building/apt-1-brooklyn/1a" }),
      makeNode({ id: "222", price: 2500, urlPath: "/building/apt-2-brooklyn/2b" }),
    ];
    vi.stubGlobal("fetch", graphqlFetchMock(makeGraphQLResponse(nodes)));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, {});
    expect(result.candidatesFound).toBe(2);
    expect(result.blockStatus).toBe("not_blocked");
    expect(result.candidates[0].listingUrl).toBe("https://streeteasy.com/building/apt-1-brooklyn/1a");
    expect(result.candidates[0].price).toBe(2800);
    expect(result.candidates[0].confidence).toBe("high");
  });

  it("includes apiCriteria in debug", async () => {
    vi.stubGlobal("fetch", graphqlFetchMock(makeGraphQLResponse([makeNode()])));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, { debug: true });
    expect(result.debug?.streeteasyFetchMethod).toBe("streeteasy_graphql_search");
    expect(result.debug?.streeteasyApiCriteria).toBe("area:313|beds:2-2|price:-3100|status:open");
    expect(result.debug?.streeteasyAreaIds).toEqual([313]);
    expect(result.debug?.streeteasyAreaIdSource).toBe("configured");
  });

  it("filters price_over_max from GraphQL results", async () => {
    const nodes = [
      makeNode({ id: "1", price: 2500, urlPath: "/building/123-test-st-brooklyn/1a" }),
      makeNode({ id: "2", price: 4000, urlPath: "/building/456-other-st-brooklyn/2b" }),
    ];
    vi.stubGlobal("fetch", graphqlFetchMock(makeGraphQLResponse(nodes)));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, {});
    expect(result.candidatesFound).toBe(1);
    expect(result.rejected.some((r) => r.reason === "price_over_max")).toBe(true);
    expect(result.candidateStats?.priceOverMax).toBe(1);
  });

  it("filters beds_incompatible from GraphQL results", async () => {
    const nodes = [
      makeNode({ id: "1", bedroomCount: 2, urlPath: "/building/123-test-st-brooklyn/1a" }),
      makeNode({ id: "2", bedroomCount: 1, urlPath: "/building/456-other-st-brooklyn/2b" }),
    ];
    vi.stubGlobal("fetch", graphqlFetchMock(makeGraphQLResponse(nodes)));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, {});
    expect(result.candidatesFound).toBe(1);
    expect(result.rejected.some((r) => r.reason === "beds_incompatible")).toBe(true);
  });

  it("filters inactive_status from GraphQL results", async () => {
    const nodes = [
      makeNode({ id: "1", status: "ACTIVE" }),
      makeNode({ id: "2", status: "RENTED", urlPath: "/building/rented-st-brooklyn/1a" }),
    ];
    vi.stubGlobal("fetch", graphqlFetchMock(makeGraphQLResponse(nodes)));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, {});
    expect(result.candidatesFound).toBe(1);
    expect(result.rejected.some((r) => r.reason === "inactive_status")).toBe(true);
  });

  it("filters missing_url_path from GraphQL results", async () => {
    const nodes = [
      makeNode({ id: "1" }),
      makeNode({ id: "2", urlPath: "" }),
    ];
    vi.stubGlobal("fetch", graphqlFetchMock(makeGraphQLResponse(nodes)));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, {});
    expect(result.candidatesFound).toBe(1);
    expect(result.rejected.some((r) => r.reason === "missing_url_path")).toBe(true);
  });

  it("GraphQL success does not call fetchStreetEasyDirect or proxy", async () => {
    const mockFetch = graphqlFetchMock(makeGraphQLResponse([makeNode()]));
    vi.stubGlobal("fetch", mockFetch);
    await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, { scraperApiKeys: ["key"] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns streeteasy_area_id_not_configured warning and uses HTML fallback when area ID missing", async () => {
    const html = makeHtml([{ id: 7000001, price: 2800, beds: 2 }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, url: STUB_TARGET.searchUrl,
      headers: { get: (h: string) => h === "content-type" ? "text/html" : null },
      text: async () => html,
    }));
    const result = await discoverStreetEasyListings(STUB_TARGET, {});
    expect(result.warnings.some((w) => w.includes("streeteasy_area_id_not_configured"))).toBe(true);
    // falls back to HTML path which finds the listing
    expect(result.candidatesFound).toBe(1);
  });

  it("falls back to HTML scraping when GraphQL API fails with streeteasy_api_search_failed warning", async () => {
    const html = makeHtml([{ id: 7000001, price: 2800, beds: 2 }]);
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      callCount++;
      const isGraphQL = String(url).includes("api-v6.streeteasy.com");
      if (isGraphQL) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      return Promise.resolve({
        ok: true, status: 200, url: String(url),
        headers: { get: (h: string) => h === "content-type" ? "text/html" : null },
        text: async () => html,
      });
    }));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, {});
    expect(result.warnings.some((w) => w.includes("streeteasy_api_search_failed"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("streeteasy_html_fallback_used"))).toBe(true);
    expect(callCount).toBeGreaterThan(1); // GraphQL + at least one direct profile
  });

  it("HTML fallback falls back to proxy when direct is blocked", async () => {
    const goodHtml = makeHtml([{ id: 7000001, price: 2800, beds: 2 }]);
    const blockedHtml = "access denied " + PADDING;
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      callCount++;
      const isGraphQL = String(url).includes("api-v6.streeteasy.com");
      const isProxy = String(url).includes("api.scraperapi.com");
      if (isGraphQL) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      const responseHtml = isProxy ? goodHtml : blockedHtml;
      return Promise.resolve({
        ok: true, status: 200, url: String(url),
        headers: { get: (h: string) => h === "content-type" ? "text/html" : null },
        text: async () => responseHtml,
      });
    }));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, { scraperApiKeys: ["key1"] });
    expect(result.candidatesFound).toBe(1);
    // 1 graphql + 5 direct profiles + 1 proxy
    expect(callCount).toBe(7);
  });

  it("includes debug info with GraphQL fields when debug is true", async () => {
    vi.stubGlobal("fetch", graphqlFetchMock(makeGraphQLResponse([makeNode()])));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, { debug: true });
    expect(result.debug).toBeDefined();
    expect(result.debug?.streeteasyFetchMethod).toBe("streeteasy_graphql_search");
    expect(result.debug?.streeteasyApiEdgesCount).toBe(1);
    expect(result.debug?.streeteasyApiTotalCount).toBe(1);
    expect(result.debug?.streeteasyFallbackUsed).toBe(false);
  });

  it("omits debug when debug is false", async () => {
    vi.stubGlobal("fetch", graphqlFetchMock(makeGraphQLResponse([makeNode()])));
    const result = await discoverStreetEasyListings(STUB_TARGET_BUSHWICK, { debug: false });
    expect(result.debug).toBeUndefined();
  });
});
