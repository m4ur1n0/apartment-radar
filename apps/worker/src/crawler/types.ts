export type BlockStatus = "not_blocked" | "suspected_but_usable" | "blocked";

export type CandidateStats = {
  listingLikeUrlsFound: number;
  acceptedCandidates: number;
  rejectedListingUrls: number;
  duplicateUrls: number;
  priceOverMax: number;
  bedsIncompatible: number;
  outsideTargetArea?: number;
  unsupportedBuildingUrls?: number;
};

export type DiscoveryRejectionReason =
  | "not_a_listing_url"
  | "nav_or_filter_url"
  | "duplicate"
  | "exceeded_limit"
  | "fetch_failed"
  | "parse_failed"
  | "not_implemented"
  | "price_over_max"
  | "beds_incompatible"
  | "building_url_not_supported"
  | "outside_target_area"
  | "inactive_status"
  | "missing_url_path"
  | "streeteasy_area_id_not_configured";

export type DiscoveredListingCandidate = {
  listingUrl: string;
  canonicalUrl?: string;
  sourceListingId?: string;
  title?: string;
  price?: number;
  beds?: number;
  baths?: number;
  neighborhood?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  confidence?: "high" | "medium" | "low";
};

export type DiscoveryRejection = {
  url: string;
  reason: DiscoveryRejectionReason;
  note?: string;
  price?: number;
  beds?: number;
};

export type DiscoveryDebug = {
  responseContentType?: string;
  htmlLength: number;
  htmlTitle?: string;
  htmlSnippetStart: string;
  totalAnchorCount: number;
  listingLikeAnchorCount: number;
  firstHrefSamples: string[];
  blockedOrCaptchaLikely: boolean;
  blockedOrCaptchaSignals: string[];
  extractionStrategyResults: Record<string, number>;
  // streeteasy graphql discovery diagnostics
  streeteasyFetchMethod?: "streeteasy_graphql_search" | "streeteasy_html_fallback";
  streeteasyApiStatus?: number;
  streeteasyApiTotalCount?: number;
  streeteasyApiCriteria?: string;
  streeteasyApiEdgesCount?: number;
  streeteasyAreaIds?: number[];
  streeteasyAreaIdSource?: "configured" | "missing";
  streeteasyFallbackUsed?: boolean;
};

export type DiscoveryOptions = {
  debug?: boolean;
  scraperApiKeys?: string[];
};

export type DiscoveryResult = {
  targetId: string;
  source: "craigslist" | "nooklyn" | "streeteasy" | "zillow";
  searchUrl: string;
  finalUrl?: string;
  httpStatus?: number;
  blockStatus?: BlockStatus;
  candidatesFound: number;
  candidates: DiscoveredListingCandidate[];
  rejected: DiscoveryRejection[];
  rejectedPreview?: DiscoveryRejection[];
  candidateStats?: CandidateStats;
  warnings: string[];
  durationMs: number;
  debug?: DiscoveryDebug;
};
