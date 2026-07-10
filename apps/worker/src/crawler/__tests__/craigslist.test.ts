import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isListingLikeHref,
  resolveAndNormalize,
  getAllHrefs,
  detectBlocked,
  getHtmlTitle,
  extractFromHtml,
  extractPrice,
  extractBeds,
  extractTitle,
  extractNeighborhood,
} from "../sources/craigslist";

// minimal CL search page with absolute hrefs
const FIXTURE_ABSOLUTE = `
<html><body>
<ul class="cl-search-result-list">
  <li class="cl-search-result" data-pid="7813892174">
    <span class="priceinfo">$2,800</span>
    <span class="bedrooms">2BR / 1Ba</span>
    <a class="posting-title" href="https://newyork.craigslist.org/brk/apa/d/brooklyn-nice-2br-bushwick/7813892174.html">
      <span class="label">Nice 2BR Bushwick</span>
    </a>
    <span class="hood">(Bushwick)</span>
  </li>
  <li class="cl-search-result" data-pid="7813892175">
    <span class="priceinfo">$3,000</span>
    <span class="bedrooms">2BR / 1Ba</span>
    <a class="posting-title" href="https://newyork.craigslist.org/brk/apa/d/brooklyn-large-2br-ridgewood/7813892175.html">
      <span class="label">Large 2BR Ridgewood</span>
    </a>
    <span class="hood">(Ridgewood)</span>
  </li>
</ul>
</body></html>
`;

// relative hrefs (common on newer CL pages) - old URL format
const FIXTURE_RELATIVE = `
<html><body>
  <a href="/brk/apa/d/bushwick-nice-apt/7813892174.html"><span class="label">Nice apt</span></a>
  <span class="priceinfo">$2,800</span>
  <span class="bedrooms">2BR</span>
  <span class="hood">(Bushwick)</span>
</body></html>
`;

// new craigslist URL format: /view/d/{slug}/{base62-hash}
const FIXTURE_NEW_FORMAT = `
<html><body>
  <a href="https://www.craigslist.org/view/d/brooklyn-rent-stabilized-bushwick/akav5hTwhPL1T5ayB8AtGQ">
    <span class="label">Rent stabilized Bushwick apt</span>
  </a>
  <span class="priceinfo">$2,800</span>
  <span class="bedrooms">2BR</span>
  <span class="hood">(Bushwick)</span>
  <a href="https://www.craigslist.org/view/d/brooklyn-beautifully-renovated-2br/4NjEKP3hNrQcdwdeoxPsmW">
    <span class="label">Renovated 2BR</span>
  </a>
  <span class="priceinfo">$3,000</span>
</body></html>
`;

// new format with relative paths (as seen in real CL search results that redirect to www.craigslist.org)
const FIXTURE_NEW_FORMAT_RELATIVE = `
<html><body>
  <a href="/view/d/brooklyn-rent-stabilized-bushwick/akav5hTwhPL1T5ayB8AtGQ">listing 1</a>
  <a href="/view/d/brooklyn-beautifully-renovated-2br/4NjEKP3hNrQcdwdeoxPsmW">listing 2</a>
</body></html>
`;

// nav/search links that should not be included
const FIXTURE_NAV_ONLY = `
<html><body>
  <a href="https://newyork.craigslist.org/">home</a>
  <a href="https://newyork.craigslist.org/search/brk/apa?max_price=3100">search</a>
  <a href="/about/sites">sites</a>
  <a href="https://newyork.craigslist.org/brk/apa/d/real-listing/7813892174.html">listing</a>
</body></html>
`;

const FIXTURE_WITH_DUPLICATE = `
<html><body>
  <a href="https://newyork.craigslist.org/brk/apa/d/brooklyn-apt/7813892100.html">first</a>
  <a href="https://newyork.craigslist.org/brk/apa/d/brooklyn-apt/7813892100.html">duplicate</a>
  <a href="https://newyork.craigslist.org/brk/apa/d/brooklyn-other/7813892101.html">second</a>
</body></html>
`;

// listing urls embedded in script json (newer CL)
const FIXTURE_SCRIPT_JSON = `
<html><body>
<script type="application/json">
{"listings":[
  {"href":"/brk/apa/d/bushwick-place/7813892200.html","ask":2800,"bedrooms":2},
  {"href":"/brk/apa/d/ridgewood-place/7813892201.html","ask":3000,"bedrooms":2}
]}
</script>
</body></html>
`;

// fragment and query params on a listing URL that need stripping
const FIXTURE_WITH_TRACKING = `
<html><body>
  <a href="https://newyork.craigslist.org/brk/apa/d/apt/7813892174.html?ref=searchbox#top">listing</a>
</body></html>
`;

function buildFixtureWithN(n: number): string {
  const items = Array.from({ length: n }, (_, i) => {
    const id = 7813892200 + i;
    return `<a href="https://newyork.craigslist.org/brk/apa/d/apt-${i}/${id}.html">apt</a>`;
  });
  return `<html><body>${items.join("\n")}</body></html>`;
}

// --- isListingLikeHref ---

describe("isListingLikeHref", () => {
  // old format
  it("accepts an absolute craigslist listing url (old format)", () => {
    expect(
      isListingLikeHref("https://newyork.craigslist.org/brk/apa/d/bushwick-apt/7813892174.html")
    ).toBe(true);
  });

  it("accepts a relative listing path (old format)", () => {
    expect(isListingLikeHref("/brk/apa/d/bushwick-apt/7813892174.html")).toBe(true);
  });

  it("accepts que (queens) area code (old format)", () => {
    expect(
      isListingLikeHref("https://newyork.craigslist.org/que/apa/d/ridgewood-place/7813892174.html")
    ).toBe(true);
  });

  // new format: /view/d/{slug}/{base62-hash}
  it("accepts new-format absolute url from www.craigslist.org", () => {
    expect(
      isListingLikeHref(
        "https://www.craigslist.org/view/d/brooklyn-rent-stabilized-bushwick/akav5hTwhPL1T5ayB8AtGQ"
      )
    ).toBe(true);
  });

  it("accepts new-format relative path /view/d/{slug}/{hash}", () => {
    expect(
      isListingLikeHref("/view/d/brooklyn-beautifully-renovated-2br/4NjEKP3hNrQcdwdeoxPsmW")
    ).toBe(true);
  });

  // rejections
  it("rejects the craigslist homepage", () => {
    expect(isListingLikeHref("https://www.craigslist.org/")).toBe(false);
  });

  it("rejects a search results URL", () => {
    expect(
      isListingLikeHref("https://www.craigslist.org/search/subarea/brk?cat=apa")
    ).toBe(false);
  });

  it("rejects a non-craigslist absolute URL even if path matches", () => {
    expect(isListingLikeHref("https://example.com/brk/apa/d/apt/7813892174.html")).toBe(false);
  });

  it("rejects a relative path without the /d/ segment", () => {
    expect(isListingLikeHref("/search/brk/apa")).toBe(false);
  });

  it("rejects a /view/d/ path with a hash that is too short", () => {
    expect(isListingLikeHref("/view/d/slug/abc")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isListingLikeHref("")).toBe(false);
  });
});

// --- resolveAndNormalize ---

describe("resolveAndNormalize", () => {
  const base = "https://newyork.craigslist.org/search/brk/apa?q=bushwick";

  it("strips fragment from an absolute url", () => {
    expect(
      resolveAndNormalize(
        "https://newyork.craigslist.org/brk/apa/d/title/7813892174.html#reply",
        base
      )
    ).toBe("https://newyork.craigslist.org/brk/apa/d/title/7813892174.html");
  });

  it("strips query params from a listing url", () => {
    expect(
      resolveAndNormalize(
        "https://newyork.craigslist.org/brk/apa/d/title/7813892174.html?ref=foo",
        base
      )
    ).toBe("https://newyork.craigslist.org/brk/apa/d/title/7813892174.html");
  });

  it("resolves a relative path against the base url", () => {
    expect(resolveAndNormalize("/brk/apa/d/bushwick-apt/7813892174.html", base)).toBe(
      "https://newyork.craigslist.org/brk/apa/d/bushwick-apt/7813892174.html"
    );
  });

  it("returns null for a non-craigslist domain", () => {
    expect(
      resolveAndNormalize("https://example.com/brk/apa/d/apt/7813892174.html", base)
    ).toBeNull();
  });
});

// --- extractFromHtml strategies ---

describe("extractFromHtml - anchor strategy (absolute hrefs)", () => {
  it("discovers listing urls from absolute hrefs", () => {
    const { candidates } = extractFromHtml(FIXTURE_ABSOLUTE, 50);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].listingUrl).toContain("7813892174");
    expect(candidates[1].listingUrl).toContain("7813892175");
  });

  it("extracts card metadata from surrounding html context", () => {
    const { candidates } = extractFromHtml(FIXTURE_ABSOLUTE, 50);
    const first = candidates[0];
    expect(first.price).toBe(2800);
    expect(first.beds).toBe(2);
    expect(first.title).toBe("Nice 2BR Bushwick");
    expect(first.neighborhood).toBe("Bushwick");
  });

  it("strips tracking params and fragments from discovered urls", () => {
    const { candidates } = extractFromHtml(FIXTURE_WITH_TRACKING, 50);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].listingUrl).toBe(
      "https://newyork.craigslist.org/brk/apa/d/apt/7813892174.html"
    );
  });
});

describe("extractFromHtml - anchor strategy (relative hrefs)", () => {
  it("resolves relative old-format listing hrefs against the provided base url", () => {
    const { candidates } = extractFromHtml(
      FIXTURE_RELATIVE,
      50,
      "https://newyork.craigslist.org/search/brk/apa"
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].listingUrl).toBe(
      "https://newyork.craigslist.org/brk/apa/d/bushwick-nice-apt/7813892174.html"
    );
  });

  it("resolves relative new-format listing hrefs against www.craigslist.org base", () => {
    const { candidates } = extractFromHtml(
      FIXTURE_NEW_FORMAT_RELATIVE,
      50,
      "https://www.craigslist.org/search/subarea/brk?cat=apa"
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0].listingUrl).toBe(
      "https://www.craigslist.org/view/d/brooklyn-rent-stabilized-bushwick/akav5hTwhPL1T5ayB8AtGQ"
    );
    expect(candidates[1].listingUrl).toBe(
      "https://www.craigslist.org/view/d/brooklyn-beautifully-renovated-2br/4NjEKP3hNrQcdwdeoxPsmW"
    );
  });

  it("falls back to www.craigslist.org origin when no base url is given", () => {
    const { candidates } = extractFromHtml(FIXTURE_RELATIVE, 50);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].listingUrl).toContain("craigslist.org");
  });
});

describe("extractFromHtml - new URL format (/view/d/{slug}/{hash})", () => {
  it("discovers listing urls in new craigslist format", () => {
    const { candidates } = extractFromHtml(FIXTURE_NEW_FORMAT, 50);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].listingUrl).toBe(
      "https://www.craigslist.org/view/d/brooklyn-rent-stabilized-bushwick/akav5hTwhPL1T5ayB8AtGQ"
    );
    expect(candidates[1].listingUrl).toBe(
      "https://www.craigslist.org/view/d/brooklyn-beautifully-renovated-2br/4NjEKP3hNrQcdwdeoxPsmW"
    );
  });

  it("extracts price and neighborhood from context around a new-format listing", () => {
    const { candidates } = extractFromHtml(FIXTURE_NEW_FORMAT, 50);
    expect(candidates[0].price).toBe(2800);
    expect(candidates[0].neighborhood).toBe("Bushwick");
  });
});

describe("extractFromHtml - filtering", () => {
  it("excludes non-listing anchors (nav, search links) and keeps only real listings", () => {
    const { candidates } = extractFromHtml(
      FIXTURE_NAV_ONLY,
      50,
      "https://newyork.craigslist.org/search/brk/apa"
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].listingUrl).toContain("7813892174");
  });

  it("deduplicates the same url appearing twice", () => {
    const { candidates, rejected } = extractFromHtml(FIXTURE_WITH_DUPLICATE, 50);
    expect(candidates).toHaveLength(2);
    const dupes = rejected.filter((r) => r.reason === "duplicate");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].url).toContain("7813892100");
  });

  it("respects maxCandidateUrlsPerRun limit", () => {
    const { candidates, rejected } = extractFromHtml(buildFixtureWithN(10), 3);
    expect(candidates).toHaveLength(3);
    expect(rejected.filter((r) => r.reason === "exceeded_limit")).toHaveLength(7);
  });
});

describe("extractFromHtml - script text strategy", () => {
  it("extracts listing urls embedded in script json when no anchor hrefs match", () => {
    const { candidates, strategyResults } = extractFromHtml(
      FIXTURE_SCRIPT_JSON,
      50,
      "https://newyork.craigslist.org/search/brk/apa"
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0].listingUrl).toContain("7813892200");
    expect(strategyResults["anchor-hrefs"]).toBe(0);
    expect(strategyResults["script-text"]).toBe(2);
  });
});

describe("extractFromHtml - zero candidate diagnostics", () => {
  it("returns empty results for html with no listing links", () => {
    const { candidates, rejected } = extractFromHtml(
      "<html><body>no links here</body></html>",
      50
    );
    expect(candidates).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });
});

// --- helpers ---

describe("extractPrice", () => {
  it("extracts a price with commas", () => {
    expect(extractPrice("<span>$2,800/mo</span>")).toBe(2800);
  });

  it("rejects implausibly low values", () => {
    expect(extractPrice("$100")).toBeUndefined();
  });

  it("returns undefined when no price present", () => {
    expect(extractPrice("no price here")).toBeUndefined();
  });
});

describe("extractBeds", () => {
  it("extracts 2BR", () => {
    expect(extractBeds("2BR / 1Ba")).toBe(2);
  });

  it("extracts '2 bedroom'", () => {
    expect(extractBeds("2 bedroom apartment")).toBe(2);
  });

  it("returns undefined when absent", () => {
    expect(extractBeds("no bed count")).toBeUndefined();
  });
});

describe("extractTitle", () => {
  it("extracts from a label span", () => {
    expect(
      extractTitle(
        '<a class="posting-title" href="#"><span class="label">Nice 2BR Bushwick</span></a>'
      )
    ).toBe("Nice 2BR Bushwick");
  });

  it("returns undefined when no label is present", () => {
    expect(extractTitle("<div>no title</div>")).toBeUndefined();
  });
});

describe("extractNeighborhood", () => {
  it("extracts a neighborhood from parentheses", () => {
    expect(extractNeighborhood("<span class='hood'>(Bushwick)</span>")).toBe("Bushwick");
  });

  it("skips numeric parens like (2BR)", () => {
    expect(extractNeighborhood("(2BR)")).toBeUndefined();
  });
});

describe("getAllHrefs", () => {
  it("returns all href values from anchor tags", () => {
    const html = `<a href="/foo">a</a><a href="https://example.com">b</a>`;
    expect(getAllHrefs(html)).toEqual(["/foo", "https://example.com"]);
  });
});

describe("detectBlocked", () => {
  it("flags html that is too small", () => {
    const { likely, signals } = detectBlocked("<html><body>hi</body></html>");
    expect(likely).toBe(true);
    expect(signals).toContain("html_too_small");
  });

  it("flags perimeterx captcha signals", () => {
    const { likely, signals } = detectBlocked("x".repeat(5000) + " px-captcha present");
    expect(likely).toBe(true);
    expect(signals).toContain("perimeterx_captcha");
  });

  it("does not flag normal html", () => {
    const { likely } = detectBlocked("x".repeat(5000) + " normal page content here");
    expect(likely).toBe(false);
  });
});

describe("getHtmlTitle", () => {
  it("extracts the page title", () => {
    expect(getHtmlTitle("<html><head><title>apartments for rent</title></head></html>")).toBe(
      "apartments for rent"
    );
  });

  it("returns undefined when no title", () => {
    expect(getHtmlTitle("<html><body>no title</body></html>")).toBeUndefined();
  });
});

// --- fetch integration ---

describe("discoverCraigslistListings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the search url with fragment stripped", async () => {
    const { discoverCraigslistListings } = await import("../sources/craigslist");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://newyork.craigslist.org/search/brk/apa",
      headers: { get: () => "text/html; charset=utf-8" },
      text: () => Promise.resolve(FIXTURE_ABSOLUTE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const target = makeTarget("https://newyork.craigslist.org/search/brk/apa#search=1~list~0");
    await discoverCraigslistListings(target);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://newyork.craigslist.org/search/brk/apa",
      expect.any(Object)
    );
  });

  it("returns candidates when fetch succeeds", async () => {
    const { discoverCraigslistListings } = await import("../sources/craigslist");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://newyork.craigslist.org/search/brk/apa",
        headers: { get: () => "text/html" },
        text: () => Promise.resolve(FIXTURE_ABSOLUTE),
      })
    );

    const result = await discoverCraigslistListings(makeTarget());
    expect(result.candidatesFound).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);
  });

  it("adds zero-candidate warnings when html has no listing links", async () => {
    const { discoverCraigslistListings } = await import("../sources/craigslist");

    // html must be > 2000 chars so it doesn't get flagged as empty_or_tiny first
    const padding = "<p>apartment listings for rent in brooklyn, new york</p>".repeat(50);
    const html = `<html><body>${padding}<a href='/search/brk/apa'>search</a></body></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://newyork.craigslist.org/search/brk/apa",
        headers: { get: () => "text/html" },
        text: () => Promise.resolve(html),
      })
    );

    const result = await discoverCraigslistListings(makeTarget());
    expect(result.candidatesFound).toBe(0);
    expect(result.warnings).toContain("no_listing_like_anchors");
  });

  it("warns empty_or_tiny_html when response body is tiny", async () => {
    const { discoverCraigslistListings } = await import("../sources/craigslist");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://newyork.craigslist.org/search/brk/apa",
        headers: { get: () => "text/html" },
        text: () => Promise.resolve("<html><body>loading...</body></html>"),
      })
    );

    const result = await discoverCraigslistListings(makeTarget());
    expect(result.warnings).toContain("empty_or_tiny_html");
  });

  it("returns a warning and empty candidates on http error", async () => {
    const { discoverCraigslistListings } = await import("../sources/craigslist");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        url: "https://newyork.craigslist.org/search/brk/apa",
        headers: { get: () => "text/html" },
      })
    );

    const result = await discoverCraigslistListings(makeTarget());
    expect(result.candidatesFound).toBe(0);
    expect(result.warnings.some((w) => w.includes("503"))).toBe(true);
  });

  it("includes debug info when options.debug is true", async () => {
    const { discoverCraigslistListings } = await import("../sources/craigslist");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://newyork.craigslist.org/search/brk/apa",
        headers: { get: () => "text/html" },
        text: () => Promise.resolve(FIXTURE_ABSOLUTE),
      })
    );

    const result = await discoverCraigslistListings(makeTarget(), { debug: true });
    expect(result.debug).toBeDefined();
    expect(result.debug!.htmlLength).toBeGreaterThan(0);
    expect(result.debug!.totalAnchorCount).toBeGreaterThan(0);
    expect(result.debug!.listingLikeAnchorCount).toBe(2);
    expect(result.debug!.firstHrefSamples.length).toBeGreaterThan(0);
    expect(result.debug!.extractionStrategyResults["anchor-hrefs"]).toBe(2);
  });

  it("omits debug field when options.debug is false (default)", async () => {
    const { discoverCraigslistListings } = await import("../sources/craigslist");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://newyork.craigslist.org/search/brk/apa",
        headers: { get: () => "text/html" },
        text: () => Promise.resolve(FIXTURE_ABSOLUTE),
      })
    );

    const result = await discoverCraigslistListings(makeTarget());
    expect(result.debug).toBeUndefined();
  });

  it("dry-run: only one outbound fetch call, no db/queue side effects", async () => {
    const { discoverCraigslistListings } = await import("../sources/craigslist");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://newyork.craigslist.org/search/brk/apa",
      headers: { get: () => "text/html" },
      text: () => Promise.resolve(FIXTURE_ABSOLUTE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await discoverCraigslistListings(makeTarget(), { debug: true });

    expect(result).toMatchObject({
      targetId: "test-target",
      source: "craigslist",
      candidatesFound: expect.any(Number),
      candidates: expect.any(Array),
      rejected: expect.any(Array),
      warnings: expect.any(Array),
      durationMs: expect.any(Number),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

function makeTarget(searchUrl = "https://newyork.craigslist.org/search/brk/apa") {
  return {
    id: "test-target",
    source: "craigslist" as const,
    priority: "primary" as const,
    enabled: true,
    label: "test",
    searchUrl,
    urlNeedsVerification: false,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn" as const],
      neighborhoods: [],
    },
    hardFilters: {
      maxRent: 3100,
      beds: 2,
      minBaths: 1,
      allowedBoroughs: ["Brooklyn" as const],
      rejectIfClearlyOutsideNeighborhoods: true,
      allowUnknownNeighborhoodIfSearchTargetIsSpecific: true,
    },
    discoveryLimits: { maxCandidateUrlsPerRun: 50 },
  };
}
