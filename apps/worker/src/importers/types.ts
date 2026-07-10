export type ImportSource =
  | "streeteasy"
  | "zillow"
  | "craigslist"
  | "nooklyn"
  | "renthop"
  | "apartments"
  | "unknown";

export type ProductionSource = "nooklyn" | "craigslist" | "streeteasy" | "zillow";

export type Confidence = "low" | "medium" | "high";

export type FetchMode = "direct" | "proxy";

export type SourceStatus = "production" | "experimental" | "disabled";
export type SourceSpeed = "fast" | "slow";

// describes how a source is fetched by default
// source_api: dedicated structured API (nooklyn)
// direct: plain http fetch with standard headers
// direct_with_proxy_fallback: try direct profiles first, fall back to scraperapi
// proxy: scraperapi with optional js rendering
export type SourceFetchMode = "source_api" | "direct" | "direct_with_proxy_fallback" | "proxy";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface SourceHardFilters {
  minPriceDollars?: number;
  maxPriceDollars?: number;
  minBeds?: number;
  minBaths?: number;
  // lowercase borough names: "brooklyn", "queens"
  allowedBoroughs?: string[];
}

export interface SourceConfig {
  status: SourceStatus;
  speed: SourceSpeed;
  crawlEnabled: boolean;
  defaultFetchMode: SourceFetchMode;
  timeoutMs: number;
  maxConcurrency: number;
  retryPolicy: RetryPolicy;
  // minimum minutes between discovery runs for this source; the global schedule drives cadence,
  // this is a safety floor to avoid hammering a single source on errors or reruns
  sourceCooldownMinutes: number;
  hardFilters: SourceHardFilters;
}

// --- crawler-level policy types ---

export type CrawlSeason = "june" | "july" | "august" | "manual";

export interface DiscoveryScheduleEntry {
  discoveryRunsPerDay: number;
  notes?: string;
}

export type DiscoverySchedule = Record<CrawlSeason, DiscoveryScheduleEntry>;

export interface ListingRefreshPolicy {
  defaultRefreshIntervalDays: number;
  refreshKnownListings: boolean;
  // skip refresh for listings that are not currently active
  refreshOnlyActiveListings: boolean;
  refreshFavoritesMoreOften: boolean;
  refreshRejectedListings: boolean;
}

export type ListingStatus =
  | "active"
  | "inactive"
  | "off_market"
  | "unavailable"
  | "not_seen_recently"
  | "unknown";

export interface ListingLifecyclePolicy {
  // never hard-delete; soft-mark so history/images/ratings stay intact
  softDeleteOnly: boolean;
  markInactiveWhenDetailPageSaysUnavailable: boolean;
  markNotSeenRecentlyAfterDays: number;
  markOffMarketAfterDays: number;
  // don't mark off-market after one missed run; require several consecutive misses
  requireConsecutiveMissingSearchRuns: number;
}

export interface ExtractedFields {
  canonical_url?: string;
  source?: string;
  source_listing_id?: string;
  title?: string;
  description?: string;
  address_text?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  rent?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  available_date?: string;
  nearest_subway_station?: string;
  nearest_subway_lines?: string;
  subway_walk_minutes?: number;
  subway_walk_source?: string;
  subway_walk_confidence?: string;
  google_maps_directions_url?: string;
  fee_status?: string;
  laundry?: string;
  dishwasher?: boolean;
  outdoor_space?: boolean;
  elevator?: boolean;
  floor_number?: number;
  pets?: string;
  amenities?: string[];
  image_urls?: string[];
}

export interface ImportPreviewResult {
  url: string;
  source: ImportSource;
  confidence: Confidence;
  fetchMode: FetchMode;
  fields: ExtractedFields;
  warnings: string[];
  debug?: {
    httpStatus?: number;
    htmlCharsParsed?: number;
    extractorsUsed: string[];
    fetchModeActuallyUsed?: string;
    zillowDetailSignalsFound?: number;
    zillowJsonScriptsFound?: number;
    zillowPropertyCardsFound?: number;
    nooklynDetailSignalsFound?: number;
    amenitiesFoundCount?: number;
    nooklynTransitText?: string;
    nooklynApiAttempted?: boolean;
    nooklynApiSucceeded?: boolean;
    nooklynApiStatus?: number;
    nooklynApiFieldsFound?: number;
    nooklynDirectFallbackUsed?: boolean;
    nooklynProxyFallbackUsed?: boolean;
    streeteasyJsonLdScriptsFound?: number;
    streeteasyEmbeddedJsonCandidatesFound?: number;
    streeteasyBlockedSignalsFound?: number;
    streeteasyApiDetailAttempted?: boolean;
    streeteasyApiDetailSucceeded?: boolean;
    streeteasyApiDetailStatus?: number;
    streeteasyApiDetailContentType?: "json" | "html" | "unknown";
    streeteasyDirectAttempted?: boolean;
    streeteasyDirectProfilesTried?: Array<{ name: string; status?: number; bytes?: number; blocked: boolean; signals: number }>;
    streeteasyDirectProfileUsed?: string;
    streeteasyDirectStatus?: number;
    streeteasyDirectBlocked?: boolean;
    streeteasyRealPageSignalsFound?: string[];
    streeteasyProxyFallbackUsed?: boolean;
    streeteasyNextScriptsFound?: number;
    debugSnippets?: Record<string, string>;
    textSample?: string;
    imageUrlsFound?: number;
    imageCandidatesFound?: number;
    imageCandidatesAfterBasicFilter?: number;
    imageUrlsReturned?: number;
    imageRejectReasons?: Record<string, number>;
    imageExtractionSources?: string[];
    imageExtractorsUsed?: string[];
  };
}
