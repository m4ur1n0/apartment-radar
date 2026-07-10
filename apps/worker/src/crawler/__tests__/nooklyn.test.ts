import { describe, it, expect, vi, afterEach } from "vitest";
import { isNooklynListingHref, extractNooklynListings, discoverNooklynListings } from "../sources/nooklyn";
import { extractNooklynSlugFromUrl, normalizeNooklynPrice, buildNooklynFetchUrl } from "../../importers/nooklynApi";
import type { SearchTarget } from "../searchTargets";

afterEach(() => { vi.restoreAllMocks(); });

const STUB_TARGET: SearchTarget = {
  id: "test-nooklyn",
  source: "nooklyn",
  priority: "primary",
  enabled: true,
  label: "Test Nooklyn",
  searchUrl: "https://nooklyn.com/rentals?neighborhood=bushwick&bedrooms=2&price=,3100",
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

function makeHtml(listings: Array<{ slug: string; price?: number; beds?: number }>): string {
  const cards = listings.map(({ slug, price, beds }) => `
    <div class="listing-card">
      <a href="/listings/${slug}">
        ${price != null ? `<span class="price">$${price}/Month</span>` : ""}
        ${beds != null ? `<span>${beds} Bed</span>` : ""}
      </a>
    </div>
  `).join("\n");
  return `<html><head><title>Nooklyn</title></head><body>${cards}</body></html>`;
}

function makeApiResponse(listings: Array<{
  id: number;
  price: number;
  bedrooms: number;
  bathrooms?: number;
  neighborhood?: string;
  address?: string;
  short_address?: string;
  url?: string;
}>) {
  return {
    ok: true,
    page_count: 1,
    total_count: listings.length,
    listings: listings.map((l) => ({
      id: l.id,
      price: l.price * 100,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms ?? 1,
      neighborhood: l.neighborhood ? { name: l.neighborhood } : undefined,
      address: l.address ?? `${l.id} Test St`,
      short_address: l.short_address,
      url: l.url ?? `/listings/listing-${l.id}-bushwick`,
    })),
  };
}

const PADDING = "<p>apartment listings for rent in brooklyn new york</p>".repeat(50);

describe("isNooklynListingHref", () => {
  it("accepts relative /listings/slug paths", () => {
    expect(isNooklynListingHref("/listings/123-main-st-apt-2b")).toBe(true);
    expect(isNooklynListingHref("/listings/abc-def-ghi")).toBe(true);
  });

  it("accepts absolute nooklyn.com listing URLs", () => {
    expect(isNooklynListingHref("https://nooklyn.com/listings/some-building-unit-3")).toBe(true);
  });

  it("rejects bare /listings path (no slug)", () => {
    expect(isNooklynListingHref("/listings")).toBe(false);
    expect(isNooklynListingHref("/listings/")).toBe(false);
  });

  it("rejects search page hrefs", () => {
    expect(isNooklynListingHref("/listings?neighborhood=bushwick")).toBe(false);
    expect(isNooklynListingHref("https://nooklyn.com/listings?bedrooms=2")).toBe(false);
  });

  it("rejects non-nooklyn URLs", () => {
    expect(isNooklynListingHref("https://zillow.com/listings/abc")).toBe(false);
    expect(isNooklynListingHref("/agents/123")).toBe(false);
    expect(isNooklynListingHref("")).toBe(false);
  });

  it("rejects slugs that are too short", () => {
    expect(isNooklynListingHref("/listings/ab")).toBe(false);
  });
});

describe("extractNooklynListings", () => {
  it("extracts listing candidates from card HTML", () => {
    const html = makeHtml([
      { slug: "123-main-st-apt-2b-brooklyn", price: 2800, beds: 2 },
      { slug: "456-elm-st-unit-3c-bushwick", price: 2500, beds: 2 },
    ]);
    const { candidates, rejected } = extractNooklynListings(html, 40);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].listingUrl).toBe("https://nooklyn.com/listings/123-main-st-apt-2b-brooklyn");
    expect(candidates[0].sourceListingId).toBe("123-main-st-apt-2b-brooklyn");
    expect(candidates[0].price).toBe(2800);
    expect(candidates[0].beds).toBe(2);
    expect(candidates[0].confidence).toBe("high");
    expect(rejected).toHaveLength(0);
  });

  it("deduplicates repeated listing URLs", () => {
    const html = makeHtml([
      { slug: "same-slug", price: 2800, beds: 2 },
      { slug: "same-slug", price: 2800, beds: 2 },
    ]);
    const { candidates, rejected } = extractNooklynListings(html, 40);
    expect(candidates).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe("duplicate");
  });

  it("respects the per-run limit", () => {
    const listings = Array.from({ length: 10 }, (_, i) => ({ slug: `listing-${i}`, price: 2000, beds: 2 }));
    const html = makeHtml(listings);
    const { candidates, rejected } = extractNooklynListings(html, 5);
    expect(candidates).toHaveLength(5);
    expect(rejected.filter((r) => r.reason === "exceeded_limit")).toHaveLength(5);
  });

  it("hard-filters listings over maxRent", () => {
    const html = makeHtml([
      { slug: "cheap-place", price: 2500, beds: 2 },
      { slug: "expensive-place", price: 3500, beds: 2 },
    ]);
    const { candidates, rejected } = extractNooklynListings(html, 40, { maxRent: 3100 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].listingUrl).toContain("cheap-place");
    expect(rejected[0].reason).toBe("price_over_max");
    expect(rejected[0].note).toMatch(/price 3500/);
  });

  it("hard-filters listings with wrong bed count", () => {
    const html = makeHtml([
      { slug: "two-bed", price: 2800, beds: 2 },
      { slug: "one-bed", price: 1800, beds: 1 },
    ]);
    const { candidates, rejected } = extractNooklynListings(html, 40, { beds: 2 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].listingUrl).toContain("two-bed");
    expect(rejected[0].reason).toBe("beds_incompatible");
    expect(rejected[0].note).toMatch(/beds 1/);
  });

  it("assigns medium confidence when only price is known", () => {
    const html = makeHtml([{ slug: "unknown-beds", price: 2800 }]);
    const { candidates } = extractNooklynListings(html, 40);
    expect(candidates[0].confidence).toBe("medium");
  });

  it("assigns low confidence when no metadata", () => {
    const html = makeHtml([{ slug: "no-meta" }]);
    const { candidates } = extractNooklynListings(html, 40);
    expect(candidates[0].confidence).toBe("low");
  });

  it("normalizes relative hrefs to absolute canonical URLs", () => {
    const html = makeHtml([{ slug: "some-listing" }]);
    const { candidates } = extractNooklynListings(html, 40);
    expect(candidates[0].listingUrl).toBe("https://nooklyn.com/listings/some-listing");
    expect(candidates[0].canonicalUrl).toBe("https://nooklyn.com/listings/some-listing");
  });
});

describe("extractNooklynSlugFromUrl", () => {
  it("extracts slug from absolute URL", () => {
    expect(extractNooklynSlugFromUrl("https://nooklyn.com/listings/my-slug-123")).toBe("my-slug-123");
  });

  it("extracts slug from relative path", () => {
    expect(extractNooklynSlugFromUrl("/listings/relative-slug")).toBe("relative-slug");
  });

  it("returns null for non-listing URLs", () => {
    expect(extractNooklynSlugFromUrl("https://nooklyn.com/rentals?q=bushwick")).toBeNull();
    expect(extractNooklynSlugFromUrl("")).toBeNull();
  });
});

describe("normalizeNooklynPrice", () => {
  it("divides by 100 and rounds", () => {
    expect(normalizeNooklynPrice(310000)).toBe(3100);
    expect(normalizeNooklynPrice(428000)).toBe(4280);
    expect(normalizeNooklynPrice(250050)).toBe(2501);
  });
});

describe("buildNooklynFetchUrl", () => {
  it("builds the correct API fetch URL", () => {
    expect(buildNooklynFetchUrl("my-slug")).toBe("https://nooklyn.com/api/v2/listings.fetch?slug=my-slug");
  });

  it("encodes special characters in slug", () => {
    const url = buildNooklynFetchUrl("slug with spaces");
    expect(url).toContain("slug%20with%20spaces");
  });
});

describe("discoverNooklynListings", () => {
  it("returns candidates from API response", async () => {
    const apiData = makeApiResponse([
      { id: 1, price: 2800, bedrooms: 2, neighborhood: "Bushwick", url: "/listings/apt-1-bushwick" },
      { id: 2, price: 2500, bedrooms: 2, neighborhood: "Bushwick", url: "/listings/apt-2-bushwick" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, {});
    expect(result.candidatesFound).toBe(2);
    expect(result.blockStatus).toBe("not_blocked");
    expect(result.candidates[0].price).toBe(2800);
    expect(result.candidates[0].confidence).toBe("high");
    expect(result.candidates[0].sourceListingId).toBe("1");
  });

  it("sets sourceListingId from listing.id", async () => {
    const apiData = makeApiResponse([
      { id: 42, price: 2900, bedrooms: 2, neighborhood: "Bushwick", url: "/listings/some-place-bushwick" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, {});
    expect(result.candidates[0].sourceListingId).toBe("42");
    expect(result.candidates[0].listingUrl).toBe("https://nooklyn.com/listings/some-place-bushwick");
  });

  it("hard-filters price_over_max from API results", async () => {
    const apiData = makeApiResponse([
      { id: 1, price: 2500, bedrooms: 2, neighborhood: "Bushwick" },
      { id: 2, price: 3500, bedrooms: 2, neighborhood: "Bushwick" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, {});
    expect(result.candidatesFound).toBe(1);
    expect(result.rejected.some((r) => r.reason === "price_over_max")).toBe(true);
    expect(result.candidateStats?.priceOverMax).toBe(1);
  });

  it("hard-filters beds_incompatible from API results", async () => {
    const apiData = makeApiResponse([
      { id: 1, price: 2500, bedrooms: 2, neighborhood: "Bushwick" },
      { id: 2, price: 2400, bedrooms: 1, neighborhood: "Bushwick" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, {});
    expect(result.candidatesFound).toBe(1);
    expect(result.rejected.some((r) => r.reason === "beds_incompatible")).toBe(true);
    expect(result.candidateStats?.bedsIncompatible).toBe(1);
  });

  it("rejects outside_target_area when neighborhood known and not in allowed list", async () => {
    const apiData = makeApiResponse([
      { id: 1, price: 2500, bedrooms: 2, neighborhood: "Bushwick" },
      { id: 2, price: 2600, bedrooms: 2, neighborhood: "Sunset Park" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, {});
    expect(result.candidatesFound).toBe(1);
    expect(result.rejected.some((r) => r.reason === "outside_target_area")).toBe(true);
    expect(result.candidateStats?.outsideTargetArea).toBe(1);
  });

  it("does not reject unknown neighborhood", async () => {
    const apiData = makeApiResponse([
      { id: 1, price: 2500, bedrooms: 2 },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, {});
    expect(result.candidatesFound).toBe(1);
  });

  it("falls back to proxy when API fails", async () => {
    const proxyHtml = makeHtml([
      { slug: "proxy-listing-bushwick", price: 2600, beds: 2 },
    ]);
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      callCount++;
      const isSearch = String(url).includes("listings.search");
      const isProxy = String(url).includes("scraperapi");
      if (isSearch) return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
      if (isProxy) return Promise.resolve({ ok: true, status: 200, url: String(url), headers: { get: () => "text/html" }, text: async () => proxyHtml });
      return Promise.resolve({ ok: true, status: 200, url: String(url), headers: { get: () => "text/html" }, text: async () => proxyHtml });
    }));
    const result = await discoverNooklynListings(STUB_TARGET, { scraperApiKeys: ["test-key"] });
    expect(result.candidatesFound).toBe(1);
    expect(result.warnings.some((w) => w.includes("nooklyn_api_failed"))).toBe(true);
  });

  it("returns blocked with no proxy keys when API fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({}),
    }));
    const result = await discoverNooklynListings(STUB_TARGET, {});
    expect(result.candidatesFound).toBe(0);
    expect(result.blockStatus).toBe("blocked");
    expect(result.warnings.some((w) => w.includes("nooklyn_api_failed"))).toBe(true);
  });

  it("does not call proxy when API succeeds", async () => {
    const apiData = makeApiResponse([
      { id: 1, price: 2800, bedrooms: 2, neighborhood: "Bushwick" },
    ]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    });
    vi.stubGlobal("fetch", mockFetch);
    await discoverNooklynListings(STUB_TARGET, { scraperApiKeys: ["test-key"] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("includes debug info when debug is true", async () => {
    const apiData = makeApiResponse([
      { id: 1, price: 2800, bedrooms: 2, neighborhood: "Bushwick" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, { debug: true });
    expect(result.debug).toBeDefined();
    expect(result.debug?.extractionStrategyResults["nooklyn-api"]).toBe(1);
  });

  it("omits debug when debug is false", async () => {
    const apiData = makeApiResponse([
      { id: 1, price: 2800, bedrooms: 2, neighborhood: "Bushwick" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, { debug: false });
    expect(result.debug).toBeUndefined();
  });

  it("warns when api page_count > 1", async () => {
    const apiData = { ...makeApiResponse([{ id: 1, price: 2800, bedrooms: 2, neighborhood: "Bushwick" }]), page_count: 3, total_count: 60 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => apiData,
    }));
    const result = await discoverNooklynListings(STUB_TARGET, {});
    expect(result.warnings.some((w) => w.includes("page_count=3"))).toBe(true);
  });
});
