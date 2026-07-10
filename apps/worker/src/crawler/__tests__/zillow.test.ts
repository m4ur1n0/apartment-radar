import { describe, it, expect, vi, afterEach } from "vitest";
import { isZillowListingHref, extractZillowListings, discoverZillowListings } from "../sources/zillow";
import type { SearchTarget } from "../searchTargets";

afterEach(() => { vi.restoreAllMocks(); });

const STUB_TARGET: SearchTarget = {
  id: "test-zillow",
  source: "zillow",
  priority: "primary",
  enabled: true,
  label: "Test Zillow",
  searchUrl: "https://www.zillow.com/bushwick-brooklyn-new-york-ny/rentals/",
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

function makeHtml(listings: Array<{ zpid: number; slug: string; price?: number; beds?: number }>): string {
  const cards = listings.map(({ zpid, slug, price, beds }) => `
    <div class="property-card">
      <a href="/homedetails/${slug}/${zpid}_zpid/">
        ${price != null ? `<span data-test="property-card-price">$${price}/mo</span>` : ""}
        ${beds != null ? `<span>${beds} bds</span>` : ""}
        <address data-test="property-card-addr">${slug.split("-").join(" ")}</address>
      </a>
    </div>
  `).join("\n");
  return `<html><head><title>Zillow Rentals</title></head><body>${cards}</body></html>`;
}

const PADDING = "<p>zillow rental listings in brooklyn new york</p>".repeat(100);

describe("isZillowListingHref", () => {
  it("accepts /homedetails/.../12345_zpid/ format", () => {
    expect(isZillowListingHref("/homedetails/123-Main-St-Brooklyn-NY-11221/56789_zpid/")).toBe(true);
    expect(isZillowListingHref("https://www.zillow.com/homedetails/123-Main-St/56789_zpid/")).toBe(true);
  });

  it("accepts paths without trailing slash", () => {
    expect(isZillowListingHref("/homedetails/123-Main-St/56789_zpid")).toBe(true);
  });

  it("rejects non-homedetails paths", () => {
    expect(isZillowListingHref("/bushwick-brooklyn-new-york-ny/rentals/")).toBe(false);
    expect(isZillowListingHref("/agent/12345")).toBe(false);
    expect(isZillowListingHref("")).toBe(false);
  });

  it("rejects homedetails without zpid", () => {
    expect(isZillowListingHref("/homedetails/123-Main-St/no-zpid-here/")).toBe(false);
  });

  it("rejects zpids that are too short", () => {
    expect(isZillowListingHref("/homedetails/123-Main-St/1234_zpid/")).toBe(false);
  });
});

describe("extractZillowListings", () => {
  it("extracts listing candidates from card HTML", () => {
    const html = makeHtml([
      { zpid: 56789001, slug: "123-main-st-brooklyn-ny", price: 2800, beds: 2 },
      { zpid: 56789002, slug: "456-elm-st-brooklyn-ny", price: 2500, beds: 2 },
    ]);
    const { candidates, rejected } = extractZillowListings(html, 40);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].listingUrl).toContain("56789001_zpid");
    expect(candidates[0].sourceListingId).toBe("56789001");
    expect(candidates[0].price).toBe(2800);
    expect(candidates[0].beds).toBe(2);
    expect(candidates[0].confidence).toBe("high");
    expect(rejected).toHaveLength(0);
  });

  it("deduplicates repeated listing URLs", () => {
    const html = makeHtml([
      { zpid: 56789001, slug: "123-main-st", price: 2800, beds: 2 },
      { zpid: 56789001, slug: "123-main-st", price: 2800, beds: 2 },
    ]);
    const { candidates, rejected } = extractZillowListings(html, 40);
    expect(candidates).toHaveLength(1);
    expect(rejected.some((r) => r.reason === "duplicate")).toBe(true);
  });

  it("respects the per-run limit", () => {
    const listings = Array.from({ length: 10 }, (_, i) => ({
      zpid: 56789000 + i, slug: `listing-${i}-brooklyn-ny`, price: 2000, beds: 2,
    }));
    const html = makeHtml(listings);
    const { candidates, rejected } = extractZillowListings(html, 5);
    expect(candidates).toHaveLength(5);
    expect(rejected.filter((r) => r.reason === "exceeded_limit")).toHaveLength(5);
  });

  it("hard-filters listings over maxRent", () => {
    const html = makeHtml([
      { zpid: 56789001, slug: "cheap-place-brooklyn-ny", price: 2500, beds: 2 },
      { zpid: 56789002, slug: "expensive-place-brooklyn-ny", price: 4000, beds: 2 },
    ]);
    const { candidates, rejected } = extractZillowListings(html, 40, { maxRent: 3100 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceListingId).toBe("56789001");
    expect(rejected.some((r) => r.note?.includes("price 4000"))).toBe(true);
  });

  it("hard-filters listings with wrong bed count", () => {
    const html = makeHtml([
      { zpid: 56789001, slug: "two-bed-brooklyn-ny", price: 2800, beds: 2 },
      { zpid: 56789002, slug: "one-bed-brooklyn-ny", price: 1800, beds: 1 },
    ]);
    const { candidates, rejected } = extractZillowListings(html, 40, { beds: 2 });
    expect(candidates).toHaveLength(1);
    expect(rejected.some((r) => r.note?.includes("beds 1"))).toBe(true);
  });

  it("falls back to script text extraction when no anchor hrefs found", () => {
    const html = `<html><body>
      ${PADDING}
      <script>
        var data = {
          "listings": ["/homedetails/456-elm-st-brooklyn-ny/99887766_zpid/"]
        };
      </script>
    </body></html>`;
    const { candidates, strategyResults } = extractZillowListings(html, 40);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceListingId).toBe("99887766");
    expect(strategyResults["script-text"]).toBeGreaterThan(0);
    expect(strategyResults["anchor-hrefs"]).toBe(0);
  });

  it("assigns medium confidence when only price is known", () => {
    const html = makeHtml([{ zpid: 56789001, slug: "123-main-st-brooklyn-ny", price: 2800 }]);
    const { candidates } = extractZillowListings(html, 40);
    expect(candidates[0].confidence).toBe("medium");
  });

  it("assigns low confidence when no metadata found", () => {
    const html = makeHtml([{ zpid: 56789001, slug: "no-meta-brooklyn-ny" }]);
    const { candidates } = extractZillowListings(html, 40);
    expect(candidates[0].confidence).toBe("low");
  });

  it("extracts address from <address> tag in card context", () => {
    const html = makeHtml([{ zpid: 56789001, slug: "123-main-st-brooklyn-ny", price: 2800, beds: 2 }]);
    const { candidates } = extractZillowListings(html, 40);
    expect(candidates[0].address).toBeTruthy();
  });
});

describe("discoverZillowListings", () => {
  it("returns warning immediately when no proxy keys configured", async () => {
    const result = await discoverZillowListings(STUB_TARGET, { scraperApiKeys: [] });
    expect(result.candidatesFound).toBe(0);
    expect(result.warnings.some((w) => w.includes("proxy keys"))).toBe(true);
  });

  it("returns empty result with warning when proxy fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("proxy error")));
    const result = await discoverZillowListings(STUB_TARGET, { scraperApiKeys: ["key1"] });
    expect(result.candidatesFound).toBe(0);
    expect(result.warnings.some((w) => w.includes("error"))).toBe(true);
  });

  it("extracts candidates from proxy HTML response", async () => {
    const html = makeHtml([
      { zpid: 56789001, slug: "123-main-st-brooklyn-ny-11221", price: 2800, beds: 2 },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, url: "https://api.scraperapi.com/?url=...",
      headers: { get: () => "text/html" },
      text: async () => html,
    }));
    const result = await discoverZillowListings(STUB_TARGET, { scraperApiKeys: ["key1"] });
    expect(result.candidatesFound).toBe(1);
    expect(result.candidates[0].price).toBe(2800);
    expect(result.candidates[0].sourceListingId).toBe("56789001");
  });

  it("includes debug info when debug is true", async () => {
    const html = makeHtml([{ zpid: 56789001, slug: "123-main-st-brooklyn-ny", price: 2800, beds: 2 }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, url: "https://api.scraperapi.com/?url=...",
      headers: { get: () => "text/html" },
      text: async () => html,
    }));
    const result = await discoverZillowListings(STUB_TARGET, { scraperApiKeys: ["key1"], debug: true });
    expect(result.debug).toBeDefined();
    expect(result.debug?.htmlLength).toBeGreaterThan(0);
    expect(result.debug?.listingLikeAnchorCount).toBe(1);
  });

  it("omits debug when debug is false", async () => {
    const html = makeHtml([{ zpid: 56789001, slug: "123-main-st-brooklyn-ny" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, url: "https://api.scraperapi.com/?url=...",
      headers: { get: () => "text/html" },
      text: async () => html,
    }));
    const result = await discoverZillowListings(STUB_TARGET, { scraperApiKeys: ["key1"], debug: false });
    expect(result.debug).toBeUndefined();
  });

  it("makes exactly one outbound fetch (to scraperapi)", async () => {
    const html = makeHtml([{ zpid: 56789001, slug: "123-main-st-brooklyn-ny", price: 2800, beds: 2 }]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, url: "https://api.scraperapi.com/?url=...",
      headers: { get: () => "text/html" },
      text: async () => html,
    });
    vi.stubGlobal("fetch", mockFetch);
    await discoverZillowListings(STUB_TARGET, { scraperApiKeys: ["key1"] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain("scraperapi.com");
  });
});
