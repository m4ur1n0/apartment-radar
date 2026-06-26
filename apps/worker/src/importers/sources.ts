import type { ImportSource } from "./types";

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
