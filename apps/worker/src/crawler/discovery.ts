import type { SearchTarget } from "./searchTargets";
import type { DiscoveryOptions, DiscoveryResult } from "./types";
import { discoverCraigslistListings } from "./sources/craigslist";
import { discoverNooklynListings } from "./sources/nooklyn";
import { discoverStreetEasyListings } from "./sources/streeteasy";
import { discoverZillowListings } from "./sources/zillow";

export async function discoverListingUrlsForTarget(
  target: SearchTarget,
  options?: DiscoveryOptions
): Promise<DiscoveryResult> {
  switch (target.source) {
    case "craigslist":
      return discoverCraigslistListings(target, options);
    case "nooklyn":
      return discoverNooklynListings(target, options);
    case "streeteasy":
      return discoverStreetEasyListings(target, options);
    case "zillow":
      return discoverZillowListings(target, options);
  }
}
