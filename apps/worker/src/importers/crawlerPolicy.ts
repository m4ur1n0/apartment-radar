import type {
  CrawlSeason,
  DiscoverySchedule,
  ListingRefreshPolicy,
  ListingLifecyclePolicy,
} from "./types";

// how many discovery runs to do per day, by search-phase month.
// cadence ramps up as august approaches and competition for 2BR listings peaks.
export const DISCOVERY_SCHEDULE: DiscoverySchedule = {
  june: {
    discoveryRunsPerDay: 1,
    notes: "early monitoring; avoid over-crawling",
  },
  july: {
    discoveryRunsPerDay: 2,
    notes: "normal search period",
  },
  august: {
    discoveryRunsPerDay: 4,
    notes: "high-intensity search period",
  },
  manual: {
    discoveryRunsPerDay: 0,
    notes: "manual-only mode; no automated discovery",
  },
};

// new candidate URLs discovered during a run should be imported immediately.
// already-known active listings should be refreshed at most weekly.
// already-known listings seen again in search results only need last_seen_at updated.
export const LISTING_REFRESH_POLICY: ListingRefreshPolicy = {
  defaultRefreshIntervalDays: 7,
  refreshKnownListings: true,
  refreshOnlyActiveListings: true,
  refreshFavoritesMoreOften: false,
  refreshRejectedListings: false,
};

// listings are never hard-deleted; they are soft-marked so ratings/photos/history remain.
// disappearing from search results alone does not immediately mark a listing inactive —
// require several consecutive missing runs before escalating the status.
export const LISTING_LIFECYCLE_POLICY: ListingLifecyclePolicy = {
  softDeleteOnly: true,
  markInactiveWhenDetailPageSaysUnavailable: true,
  markNotSeenRecentlyAfterDays: 7,
  markOffMarketAfterDays: 14,
  requireConsecutiveMissingSearchRuns: 3,
};

export function getActiveSeason(): CrawlSeason {
  const month = new Date().getMonth(); // 0-indexed
  if (month === 5) return "june";
  if (month === 6) return "july";
  if (month === 7) return "august";
  return "manual";
}
