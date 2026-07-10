// apps/worker/src/crawler/searchTargets.ts

export type SearchTargetPriority =
  | "primary"
  | "secondary"
  | "fallback"
  | "experimental";

export type SearchTarget = {
  id: string;
  source: "nooklyn" | "craigslist" | "streeteasy" | "zillow";
  priority: SearchTargetPriority;
  enabled: boolean;

  // deliberately human-readable so bad guessed urls are easy to spot
  label: string;

  // expected to be manually verified/replaced before scheduler is enabled
  searchUrl: string;
  urlNeedsVerification: boolean;
  verificationNotes?: string;

  expectedFilters: {
    maxRent: number;
    beds: 2 | number;
    allowedBoroughs: Array<"Brooklyn" | "Queens">;
    neighborhoods: string[];
  };

  hardFilters: {
    maxRent: number;
    beds: 2 | number;
    minBaths: 1 | number;
    allowedBoroughs: Array<"Brooklyn" | "Queens">;
    rejectIfClearlyOutsideNeighborhoods: boolean;
    allowUnknownNeighborhoodIfSearchTargetIsSpecific: boolean;
  };

  discoveryLimits: {
    maxCandidateUrlsPerRun: number;
    maxPagesPerRun?: number;
  };

  notes?: string;
};

const COMMON_HARD_FILTERS = {
  maxRent: 3100,
  beds: 2,
  minBaths: 1,
  allowedBoroughs: ["Brooklyn", "Queens"] as Array<"Brooklyn" | "Queens">,
  rejectIfClearlyOutsideNeighborhoods: true,
  allowUnknownNeighborhoodIfSearchTargetIsSpecific: true,
};

const PRIMARY_NEIGHBORHOODS = ["Ridgewood", "Bushwick"];

const EXTENDED_NEIGHBORHOODS = [
  "Ridgewood",
  "Bushwick",
  "East Williamsburg",
  "Bed-Stuy",
  "Ocean Hill",
  "Maspeth",
  "Cypress Hills",
  "Glendale",
  "Stuyvesant Heights",
  "Crown Heights",
  "Clinton Hill",
  "Greenpoint",
];

export const SEARCH_TARGETS: SearchTarget[] = [
  // ---------------------------------------------------------------------------
  // NOOKLYN
  // These are the highest-value targets because Nooklyn now has a structured
  // listing API once we discover listing URLs.
  // Replace guessed urls with copied URLs after setting filters manually.
  // ---------------------------------------------------------------------------

  {
    id: "nooklyn-url-first-bushwick-2br-max3100",
    source: "nooklyn",
    priority: "primary",
    enabled: true,
    label: "Nooklyn / listings search / Bushwick / 2BR / max $3100",
    searchUrl:
      "https://nooklyn.com/rentals?neighborhood=bushwick&bedrooms=2&price=,3100",
    urlNeedsVerification: true,
    verificationNotes:
      "Open Nooklyn, search Bushwick rentals, set 2 bedrooms and max $3100, then replace this URL with the copied filtered URL.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Bushwick"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 40,
      maxPagesPerRun: 2,
    },
    notes: "Primary target. Import newly discovered listing URLs immediately.",
  },

  {
    id: "nooklyn-url-first-ridgewood-2br-max3100",
    source: "nooklyn",
    priority: "primary",
    enabled: true,
    label: "Nooklyn / listings search / Ridgewood / 2BR / max $3100",
    searchUrl:
      "https://nooklyn.com/rentals?neighborhood=ridgewood&bedrooms=2&price=,3100",
    urlNeedsVerification: true,
    verificationNotes:
      "Open Nooklyn, search Ridgewood rentals, set 2 bedrooms and max $3100, then replace this URL with the copied filtered URL.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Ridgewood"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 40,
      maxPagesPerRun: 2,
    },
  },

  {
    id: "nooklyn-url-first-east-williamsburg-2br-max3100",
    source: "nooklyn",
    priority: "secondary",
    enabled: true,
    label: "Nooklyn / listings search / East Williamsburg / 2BR / max $3100",
    searchUrl:
      "https://nooklyn.com/rentals?neighborhood=east-williamsburg&bedrooms=2&price=,3100",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["East Williamsburg"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 30,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "nooklyn-url-first-bed-stuy-2br-max3100",
    source: "nooklyn",
    priority: "secondary",
    enabled: true,
    label: "Nooklyn / listings search / Bed-Stuy / 2BR / max $3100",
    searchUrl:
      "https://nooklyn.com/rentals?neighborhood=bed-stuy&bedrooms=2&price=,3100",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Bed-Stuy", "Stuyvesant Heights", "Ocean Hill"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 35,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "nooklyn-url-first-maspeth-2br-max3100",
    source: "nooklyn",
    priority: "secondary",
    enabled: true,
    label: "Nooklyn / listings search / Maspeth / 2BR / max $3100",
    searchUrl:
      "https://nooklyn.com/rentals?neighborhood=maspeth&bedrooms=2&price=,3100",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Maspeth"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 25,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "nooklyn-url-first-cypress-hills-2br-max3100",
    source: "nooklyn",
    priority: "fallback",
    enabled: false,
    label: "Nooklyn / listings search / Cypress Hills / 2BR / max $3100",
    searchUrl:
      "https://nooklyn.com/rentals?neighborhood=cypress-hills&bedrooms=2&price=,3100",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Cypress Hills"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 20,
      maxPagesPerRun: 1,
    },
    notes: "Keep disabled initially unless primary/secondary search volume is too low.",
  },

  // ---------------------------------------------------------------------------
  // CRAIGSLIST
  // Craigslist URL params are the most predictable. These should be close.
  // brk = Brooklyn, que = Queens, apa = apartments/housing for rent.
  // ---------------------------------------------------------------------------

  {
    id: "craigslist-url-first-brooklyn-apa-2br-max3100-query-bushwick-ridgewood",
    source: "craigslist",
    priority: "primary",
    enabled: true,
    label:
      "Craigslist / brk apa / query Bushwick OR Ridgewood-ish / 2BR / max $3100",
    searchUrl:
      "https://newyork.craigslist.org/search/brk/apa?max_bedrooms=2&max_price=3100&min_bedrooms=2&query=bushwick%20OR%20ridgewood#search=2",
    urlNeedsVerification: true,
    verificationNotes:
      "Craigslist query OR behavior may not work as expected. Replace with separate query URLs if needed.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn", "Queens"],
      neighborhoods: PRIMARY_NEIGHBORHOODS,
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 50,
      maxPagesPerRun: 2,
    },
  },

  {
    id: "craigslist-url-first-brooklyn-apa-2br-max3100-query-bushwick",
    source: "craigslist",
    priority: "primary",
    enabled: true,
    label: "Craigslist / brk apa / query Bushwick / 2BR / max $3100",
    searchUrl:
      "https://newyork.craigslist.org/search/brk/apa?max_bedrooms=2&max_price=3100&min_bedrooms=2&query=bushwick#search=2~list~0",
    urlNeedsVerification: false,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Bushwick"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 50,
      maxPagesPerRun: 2,
    },
  },



  {
    id: "craigslist-url-first-queens-apa-2br-max3100-query-ridgewood",
    source: "craigslist",
    priority: "primary",
    enabled: true,
    label: "Craigslist / que apa / query Ridgewood / 2BR / max $3100",
    searchUrl:
      "https://www.craigslist.org/search/subarea/que?cat=apa&max_bedrooms=2&max_price=3100&min_bedrooms=2&query=ridgewood",
    urlNeedsVerification: false,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Ridgewood"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 50,
      maxPagesPerRun: 2,
    },
  },

  {
    id: "craigslist-url-first-brooklyn-apa-2br-max3100-query-bedstuy",
    source: "craigslist",
    priority: "secondary",
    enabled: true,
    label: "Craigslist / brk apa / query Bed-Stuy / 2BR / max $3100",
    searchUrl:
      "https://www.craigslist.org/search/subarea/brk?cat=apa&max_bedrooms=2&max_price=3100&min_bedrooms=2&query=bed%20stuy",
    urlNeedsVerification: false,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Bed-Stuy", "Stuyvesant Heights", "Ocean Hill"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 50,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "craigslist-url-first-brooklyn-apa-2br-max3100-query-east-williamsburg",
    source: "craigslist",
    priority: "secondary",
    enabled: true,
    label: "Craigslist / brk apa / query East Williamsburg / 2BR / max $3100",
    searchUrl:
      "https://www.craigslist.org/search/subarea/brk?cat=apa&max_bedrooms=2&max_price=3100&min_bedrooms=2&query=east%20williamsburg",
    urlNeedsVerification: false,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["East Williamsburg", "Williamsburg"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 40,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "craigslist-url-first-queens-apa-2br-max3100-query-maspeth",
    source: "craigslist",
    priority: "secondary",
    enabled: true,
    label: "Craigslist / que apa / query Maspeth / 2BR / max $3100",
    searchUrl:
      "https://www.craigslist.org/search/subarea/que?cat=apa&max_bedrooms=2&max_price=3100&min_bedrooms=2&query=maspeth",
    urlNeedsVerification: false,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Maspeth"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 35,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "craigslist-url-first-brooklyn-apa-2br-max3100-no-query-broad",
    source: "craigslist",
    priority: "fallback",
    enabled: false,
    label: "Craigslist / brk apa / broad Brooklyn / 2BR / max $3100",
    searchUrl:
      "https://www.craigslist.org/search/subarea/brk?cat=apa&max_bedrooms=2&max_price=3100&min_bedrooms=2",
    urlNeedsVerification: false,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: EXTENDED_NEIGHBORHOODS,
    },
    hardFilters: {
      ...COMMON_HARD_FILTERS,
      rejectIfClearlyOutsideNeighborhoods: true,
      allowUnknownNeighborhoodIfSearchTargetIsSpecific: false,
    },
    discoveryLimits: {
      maxCandidateUrlsPerRun: 80,
      maxPagesPerRun: 1,
    },
    notes: "Disabled initially; broad Craigslist could produce too much junk.",
  },

  {
    id: "craigslist-url-first-queens-apa-2br-max3100-no-query-broad",
    source: "craigslist",
    priority: "fallback",
    enabled: false,
    label: "Craigslist / que apa / broad Queens / 2BR / max $3100",
    searchUrl:
      "https://www.craigslist.org/search/subarea/que?cat=apa&max_bedrooms=2&max_price=3100&min_bedrooms=2",
    urlNeedsVerification: false,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Ridgewood", "Maspeth", "Glendale"],
    },
    hardFilters: {
      ...COMMON_HARD_FILTERS,
      rejectIfClearlyOutsideNeighborhoods: true,
      allowUnknownNeighborhoodIfSearchTargetIsSpecific: false,
    },
    discoveryLimits: {
      maxCandidateUrlsPerRun: 80,
      maxPagesPerRun: 1,
    },
    notes: "Disabled initially; broad Queens can drift too far from target areas.",
  },

  // ---------------------------------------------------------------------------
  // STREETEASY
  // StreetEasy URL shapes are likely close but should be manually verified.
  // Best approach: open StreetEasy, apply filters, copy final URL into these.
  // ---------------------------------------------------------------------------

  {
    id: "streeteasy-url-first-bushwick-2br-max3100",
    source: "streeteasy",
    priority: "primary",
    enabled: true,
    label: "StreetEasy / Bushwick / 2BR / max $3100",
    searchUrl: "https://streeteasy.com/for-rent/bushwick/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    verificationNotes:
      "StreetEasy filter URL syntax may differ. Open StreetEasy, set Bushwick + 2 beds + max base rent $3100, then replace.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Bushwick"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 40,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "streeteasy-url-first-ridgewood-2br-max3100",
    source: "streeteasy",
    priority: "primary",
    enabled: true,
    label: "StreetEasy / Ridgewood / 2BR / max $3100",
    searchUrl: "https://streeteasy.com/for-rent/ridgewood/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    verificationNotes:
      "Verify StreetEasy's Ridgewood area slug and filter syntax by manually copying a filtered search.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Ridgewood"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 40,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "streeteasy-url-first-east-williamsburg-2br-max3100",
    source: "streeteasy",
    priority: "secondary",
    enabled: true,
    label: "StreetEasy / East Williamsburg / 2BR / max $3100",
    searchUrl:
      "https://streeteasy.com/for-rent/east-williamsburg/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["East Williamsburg", "Williamsburg"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 30,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "streeteasy-url-first-bed-stuy-2br-max3100",
    source: "streeteasy",
    priority: "secondary",
    enabled: true,
    label: "StreetEasy / Bed-Stuy / 2BR / max $3100",
    searchUrl:
      "https://streeteasy.com/for-rent/bedford-stuyvesant/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    verificationNotes:
      "Verify whether StreetEasy uses bedford-stuyvesant, bed-stuy, or a different neighborhood slug.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Bed-Stuy", "Stuyvesant Heights", "Ocean Hill"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 35,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "streeteasy-url-first-stuyvesant-heights-2br-max3100",
    source: "streeteasy",
    priority: "secondary",
    enabled: true,
    label: "StreetEasy / Stuyvesant Heights / 2BR / max $3100",
    searchUrl:
      "https://streeteasy.com/for-rent/stuyvesant-heights/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Stuyvesant Heights", "Bed-Stuy"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 25,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "streeteasy-url-first-maspeth-2br-max3100",
    source: "streeteasy",
    priority: "secondary",
    enabled: true,
    label: "StreetEasy / Maspeth / 2BR / max $3100",
    searchUrl: "https://streeteasy.com/for-rent/maspeth/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Maspeth"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 25,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "streeteasy-url-first-ocean-hill-2br-max3100",
    source: "streeteasy",
    priority: "fallback",
    enabled: false,
    label: "StreetEasy / Ocean Hill / 2BR / max $3100",
    searchUrl: "https://streeteasy.com/for-rent/ocean-hill/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Ocean Hill", "Bed-Stuy", "Bushwick"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 20,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "streeteasy-url-first-brooklyn-broad-2br-max3100",
    source: "streeteasy",
    priority: "fallback",
    enabled: false,
    label: "StreetEasy / Brooklyn broad / 2BR / max $3100",
    searchUrl: "https://streeteasy.com/for-rent/brooklyn/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: EXTENDED_NEIGHBORHOODS,
    },
    hardFilters: {
      ...COMMON_HARD_FILTERS,
      allowUnknownNeighborhoodIfSearchTargetIsSpecific: false,
    },
    discoveryLimits: {
      maxCandidateUrlsPerRun: 80,
      maxPagesPerRun: 1,
    },
    notes: "Disabled initially; useful later if specific searches miss inventory.",
  },

  {
    id: "streeteasy-url-first-queens-broad-2br-max3100",
    source: "streeteasy",
    priority: "fallback",
    enabled: false,
    label: "StreetEasy / Queens broad / 2BR / max $3100",
    searchUrl: "https://streeteasy.com/for-rent/queens/price%3A-3100%7Cbeds%3A2",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Ridgewood", "Maspeth", "Glendale"],
    },
    hardFilters: {
      ...COMMON_HARD_FILTERS,
      allowUnknownNeighborhoodIfSearchTargetIsSpecific: false,
    },
    discoveryLimits: {
      maxCandidateUrlsPerRun: 80,
      maxPagesPerRun: 1,
    },
    notes: "Disabled initially; Queens broad search can drift too far east/north.",
  },

  // ---------------------------------------------------------------------------
  // ZILLOW
  // Zillow search URLs are the least reliable as hand-written strings because
  // useful filters are often encoded in searchQueryState. These are placeholders.
  // Best method: use the site UI, set filters, copy URL into these targets.
  // ---------------------------------------------------------------------------

  {
    id: "zillow-url-first-bushwick-2br-max3100",
    source: "zillow",
    priority: "primary",
    enabled: true,
    label: "Zillow / Bushwick / rentals / 2BR / max $3100",
    searchUrl: "https://www.zillow.com/bushwick-brooklyn-new-york-ny/rentals/?price=0-3100&searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Atrue%2C%22mapBounds%22%3A%7B%22west%22%3A-73.96788238134766%2C%22east%22%3A-73.86282561865235%2C%22south%22%3A40.65681043175302%2C%22north%22%3A40.72969753485881%7D%2C%22usersSearchTerm%22%3A%22Bushwick%20New%20York%20NY%22%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A193587%2C%22regionType%22%3A8%7D%5D%2C%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22priorityscore%22%7D%2C%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22lsact%22%3A%7B%22value%22%3Afalse%7D%2C%22lscmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22lszp%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22beds%22%3A%7B%22min%22%3A2%2C%22max%22%3Anull%7D%2C%22mf%22%3A%7B%22value%22%3Afalse%7D%2C%22land%22%3A%7B%22value%22%3Afalse%7D%2C%22manu%22%3A%7B%22value%22%3Afalse%7D%2C%22mp%22%3A%7B%22max%22%3A3100%7D%7D%2C%22isListVisible%22%3Atrue%2C%22mapZoom%22%3A13%7D",
    urlNeedsVerification: true,
    verificationNotes:
      "Zillow may ignore this simplified URL. Use Zillow UI filters, copy final URL with searchQueryState, and replace.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Bushwick"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 40,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "zillow-url-first-ridgewood-2br-max3100",
    source: "zillow",
    priority: "primary",
    enabled: true,
    label: "Zillow / Ridgewood / rentals / 2BR / max $3100",
    searchUrl:
      "https://www.zillow.com/ridgewood-queens-new-york-ny/rentals/?price=0-3100&searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Afalse%2C%22mapBounds%22%3A%7B%22west%22%3A-73.924159%2C%22east%22%3A-73.890257%2C%22south%22%3A40.691812%2C%22north%22%3A40.714012%7D%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A275173%2C%22regionType%22%3A8%7D%5D%2C%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22priorityscore%22%7D%2C%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22lsact%22%3A%7B%22value%22%3Afalse%7D%2C%22lscmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22lszp%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22mf%22%3A%7B%22value%22%3Afalse%7D%2C%22land%22%3A%7B%22value%22%3Afalse%7D%2C%22manu%22%3A%7B%22value%22%3Afalse%7D%2C%22beds%22%3A%7B%22min%22%3A2%7D%2C%22mp%22%3A%7B%22max%22%3A3100%7D%7D%2C%22isListVisible%22%3Atrue%2C%22usersSearchTerm%22%3A%22Ridgewood%20New%20York%20NY%22%7D",
    urlNeedsVerification: true,
    verificationNotes:
      "Verify Zillow's Ridgewood place slug. It may be ridgewood-new-york-ny, ridgewood-queens-new-york-ny, or a searchQueryState URL.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Ridgewood"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 40,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "zillow-url-first-east-williamsburg-2br-max3100",
    source: "zillow",
    priority: "secondary",
    enabled: true,
    label: "Zillow / East Williamsburg / rentals / 2BR / max $3100",
    searchUrl:
      "https://www.zillow.com/east-williamsburg-brooklyn-new-york-ny/rentals/?price=0-3100&searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Afalse%2C%22mapBounds%22%3A%7B%22west%22%3A-73.942179%2C%22east%22%3A-73.919849%2C%22south%22%3A40.701842%2C%22north%22%3A40.727804%7D%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A838365%2C%22regionType%22%3A31%7D%5D%2C%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22priorityscore%22%7D%2C%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22lsact%22%3A%7B%22value%22%3Afalse%7D%2C%22lscmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22lszp%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22mf%22%3A%7B%22value%22%3Afalse%7D%2C%22land%22%3A%7B%22value%22%3Afalse%7D%2C%22manu%22%3A%7B%22value%22%3Afalse%7D%2C%22mp%22%3A%7B%22max%22%3A3100%7D%2C%22beds%22%3A%7B%22min%22%3A2%7D%7D%2C%22isListVisible%22%3Atrue%2C%22usersSearchTerm%22%3A%22East%20Williamsburg%20NY%22%7D",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["East Williamsburg", "Williamsburg"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 30,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "zillow-url-first-bed-stuy-2br-max3100",
    source: "zillow",
    priority: "secondary",
    enabled: true,
    label: "Zillow / Bed-Stuy / rentals / 2BR / max $3100",
    searchUrl:
      "https://www.zillow.com/bedford-stuyvesant-brooklyn-new-york-ny/rentals/?price=0-3100&searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Afalse%2C%22mapBounds%22%3A%7B%22west%22%3A-73.961922%2C%22east%22%3A-73.899379%2C%22south%22%3A40.675772%2C%22north%22%3A40.700738%7D%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A272902%2C%22regionType%22%3A8%7D%5D%2C%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22priorityscore%22%7D%2C%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22lsact%22%3A%7B%22value%22%3Afalse%7D%2C%22lscmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22lszp%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22mf%22%3A%7B%22value%22%3Afalse%7D%2C%22land%22%3A%7B%22value%22%3Afalse%7D%2C%22manu%22%3A%7B%22value%22%3Afalse%7D%2C%22mp%22%3A%7B%22max%22%3A3100%7D%2C%22beds%22%3A%7B%22min%22%3A2%7D%7D%2C%22isListVisible%22%3Atrue%2C%22usersSearchTerm%22%3A%22Bedford-Stuyvesant%20New%20York%20NY%22%7D",
    urlNeedsVerification: true,
    verificationNotes: "Verify Zillow's exact Bed-Stuy slug via UI-copied search URL.",
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Bed-Stuy", "Stuyvesant Heights", "Ocean Hill"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 35,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "zillow-url-first-stuyvesant-heights-2br-max3100",
    source: "zillow",
    priority: "secondary",
    enabled: true,
    label: "Zillow / Stuyvesant Heights / rentals / 2BR / max $3100",
    searchUrl:
      "https://www.zillow.com/stuyvesant-heights-brooklyn-new-york-ny/rentals/?price=0-3100&searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Afalse%2C%22mapBounds%22%3A%7B%22west%22%3A-73.944425%2C%22east%22%3A-73.916059%2C%22south%22%3A40.676622%2C%22north%22%3A40.700752%7D%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A838366%2C%22regionType%22%3A31%7D%5D%2C%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22priorityscore%22%7D%2C%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22lsact%22%3A%7B%22value%22%3Afalse%7D%2C%22lscmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22lszp%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22mf%22%3A%7B%22value%22%3Afalse%7D%2C%22land%22%3A%7B%22value%22%3Afalse%7D%2C%22manu%22%3A%7B%22value%22%3Afalse%7D%2C%22mp%22%3A%7B%22max%22%3A3100%7D%2C%22beds%22%3A%7B%22min%22%3A2%7D%7D%2C%22isListVisible%22%3Atrue%2C%22usersSearchTerm%22%3A%22Stuyvesant%20Heights%20NY%22%7D",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: ["Stuyvesant Heights", "Bed-Stuy"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 25,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "zillow-url-first-maspeth-2br-max3100",
    source: "zillow",
    priority: "secondary",
    enabled: true,
    label: "Zillow / Maspeth / rentals / 2BR / max $3100",
    searchUrl: "https://www.zillow.com/maspeth-queens-new-york-ny/rentals/?price=0-3100&searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Afalse%2C%22mapBounds%22%3A%7B%22west%22%3A-73.928889%2C%22east%22%3A-73.885777%2C%22south%22%3A40.712674%2C%22north%22%3A40.73653%7D%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A5837%2C%22regionType%22%3A8%7D%5D%2C%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22priorityscore%22%7D%2C%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22lsact%22%3A%7B%22value%22%3Afalse%7D%2C%22lscmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22lszp%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22mf%22%3A%7B%22value%22%3Afalse%7D%2C%22land%22%3A%7B%22value%22%3Afalse%7D%2C%22manu%22%3A%7B%22value%22%3Afalse%7D%2C%22mp%22%3A%7B%22max%22%3A3100%7D%2C%22beds%22%3A%7B%22min%22%3A2%7D%7D%2C%22isListVisible%22%3Atrue%2C%22usersSearchTerm%22%3A%22Maspeth%20New%20York%20NY%22%7D",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Maspeth"],
    },
    hardFilters: COMMON_HARD_FILTERS,
    discoveryLimits: {
      maxCandidateUrlsPerRun: 25,
      maxPagesPerRun: 1,
    },
  },

  {
    id: "zillow-url-first-brooklyn-broad-2br-max3100",
    source: "zillow",
    priority: "fallback",
    enabled: false,
    label: "Zillow / Brooklyn broad / rentals / 2BR / max $3100",
    searchUrl: "https://www.zillow.com/brooklyn-new-york-ny/rentals/?price=0-3100&searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Afalse%2C%22mapBounds%22%3A%7B%22west%22%3A-74.041878%2C%22east%22%3A-73.833552%2C%22south%22%3A40.570842%2C%22north%22%3A40.739135%7D%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A37607%2C%22regionType%22%3A17%7D%5D%2C%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22priorityscore%22%7D%2C%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22lsact%22%3A%7B%22value%22%3Afalse%7D%2C%22lscmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22lszp%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22mf%22%3A%7B%22value%22%3Afalse%7D%2C%22land%22%3A%7B%22value%22%3Afalse%7D%2C%22manu%22%3A%7B%22value%22%3Afalse%7D%2C%22mp%22%3A%7B%22max%22%3A3100%7D%2C%22beds%22%3A%7B%22min%22%3A2%7D%7D%2C%22isListVisible%22%3Atrue%2C%22usersSearchTerm%22%3A%22Brooklyn%20New%20York%20NY%22%7D",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Brooklyn"],
      neighborhoods: EXTENDED_NEIGHBORHOODS,
    },
    hardFilters: {
      ...COMMON_HARD_FILTERS,
      allowUnknownNeighborhoodIfSearchTargetIsSpecific: false,
    },
    discoveryLimits: {
      maxCandidateUrlsPerRun: 80,
      maxPagesPerRun: 1,
    },
    notes: "Disabled initially. Broad Zillow search likely needs stronger card-level filtering.",
  },

  {
    id: "zillow-url-first-queens-broad-2br-max3100",
    source: "zillow",
    priority: "fallback",
    enabled: false,
    label: "Zillow / Queens broad / rentals / 2BR / max $3100",
    searchUrl: "https://www.zillow.com/queens-new-york-ny/rentals/?price=0-3100&searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Afalse%2C%22mapBounds%22%3A%7B%22west%22%3A-73.962632%2C%22east%22%3A-73.700272%2C%22south%22%3A40.541722%2C%22north%22%3A40.80071%7D%2C%22regionSelection%22%3A%5B%7B%22regionId%22%3A270915%2C%22regionType%22%3A17%7D%5D%2C%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22priorityscore%22%7D%2C%22fr%22%3A%7B%22value%22%3Atrue%7D%2C%22fsba%22%3A%7B%22value%22%3Afalse%7D%2C%22fsbo%22%3A%7B%22value%22%3Afalse%7D%2C%22nc%22%3A%7B%22value%22%3Afalse%7D%2C%22lsact%22%3A%7B%22value%22%3Afalse%7D%2C%22lscmsn%22%3A%7B%22value%22%3Afalse%7D%2C%22lszp%22%3A%7B%22value%22%3Afalse%7D%2C%22auc%22%3A%7B%22value%22%3Afalse%7D%2C%22fore%22%3A%7B%22value%22%3Afalse%7D%2C%22mf%22%3A%7B%22value%22%3Afalse%7D%2C%22land%22%3A%7B%22value%22%3Afalse%7D%2C%22manu%22%3A%7B%22value%22%3Afalse%7D%2C%22mp%22%3A%7B%22max%22%3A3100%7D%2C%22beds%22%3A%7B%22min%22%3A2%7D%7D%2C%22isListVisible%22%3Atrue%2C%22usersSearchTerm%22%3A%22Queens%20New%20York%20NY%22%7D",
    urlNeedsVerification: true,
    expectedFilters: {
      maxRent: 3100,
      beds: 2,
      allowedBoroughs: ["Queens"],
      neighborhoods: ["Ridgewood", "Maspeth", "Glendale"],
    },
    hardFilters: {
      ...COMMON_HARD_FILTERS,
      allowUnknownNeighborhoodIfSearchTargetIsSpecific: false,
    },
    discoveryLimits: {
      maxCandidateUrlsPerRun: 80,
      maxPagesPerRun: 1,
    },
    notes: "Disabled initially. Queens broad can drift far outside useful areas.",
  },
];

export const ENABLED_SEARCH_TARGETS = SEARCH_TARGETS.filter((target) => target.enabled);