import type { ImportSource, ProductionSource, SourceConfig } from "./types";

function matches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function detectSource(hostname: string): ImportSource {
  const h = hostname.toLowerCase();
  if (matches(h, "streeteasy.com")) return "streeteasy";
  if (matches(h, "zillow.com") || matches(h, "trulia.com") || matches(h, "hotpads.com")) return "zillow";
  if (matches(h, "craigslist.org")) return "craigslist";
  if (matches(h, "nooklyn.com")) return "nooklyn";
  if (matches(h, "renthop.com")) return "renthop";
  if (matches(h, "apartments.com")) return "apartments";
  return "unknown";
}

const SHARED_HARD_FILTERS = {
  minPriceDollars: 500,
  maxPriceDollars: 3100,
  minBeds: 2,
  minBaths: 1,
  allowedBoroughs: ["brooklyn", "queens"],
};

export const SOURCE_CONFIG: Record<ProductionSource, SourceConfig> = {
  nooklyn: {
    status: "production",
    speed: "fast",
    crawlEnabled: true,
    defaultFetchMode: "source_api",
    timeoutMs: 8000,
    maxConcurrency: 3,
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    sourceCooldownMinutes: 180,
    hardFilters: SHARED_HARD_FILTERS,
  },
  craigslist: {
    status: "production",
    speed: "fast",
    crawlEnabled: true,
    defaultFetchMode: "direct",
    timeoutMs: 8000,
    maxConcurrency: 3,
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    sourceCooldownMinutes: 120,
    hardFilters: SHARED_HARD_FILTERS,
  },
  streeteasy: {
    status: "production",
    speed: "slow",
    crawlEnabled: true,
    defaultFetchMode: "direct_with_proxy_fallback",
    timeoutMs: 20000,
    maxConcurrency: 1,
    retryPolicy: { maxAttempts: 1, backoffMs: 2000 },
    sourceCooldownMinutes: 360,
    hardFilters: SHARED_HARD_FILTERS,
  },
  zillow: {
    status: "production",
    speed: "slow",
    crawlEnabled: true,
    defaultFetchMode: "proxy",
    timeoutMs: 20000,
    maxConcurrency: 1,
    retryPolicy: { maxAttempts: 1, backoffMs: 2000 },
    sourceCooldownMinutes: 360,
    hardFilters: SHARED_HARD_FILTERS,
  },
};

export function getSourceConfig(source: ImportSource): SourceConfig | null {
  return (SOURCE_CONFIG as Record<string, SourceConfig>)[source] ?? null;
}
