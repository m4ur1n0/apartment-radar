// run with: npx tsx scripts/discovery-debug.ts [target-id] [--debug] [--show-rejected] [--source <name>] [--limit <n>] [--validate-candidates] [--limit-validation <n>]
// examples:
//   npx tsx scripts/discovery-debug.ts nooklyn-url-first-bushwick-2br-max3100 --debug --show-rejected --validate-candidates --limit-validation 3
//   npx tsx scripts/discovery-debug.ts --source zillow --limit 1 --debug
// pass SCRAPERAPI_KEY env var for targets that need proxy (zillow, streeteasy)

import { discoverListingUrlsForTarget } from "../src/crawler/discovery.js";
import { SEARCH_TARGETS, ENABLED_SEARCH_TARGETS } from "../src/crawler/searchTargets.js";
import { fetchNooklynListingBySlug, extractNooklynSlugFromUrl } from "../src/importers/nooklynApi.js";
import { fetchStreetEasyListingJsonOrHtml } from "../src/importers/streeteasyApi.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positionals = args.filter((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const showDebug = flags.has("--debug");
const showRejected = flags.has("--show-rejected");
const validateCandidates = flags.has("--validate-candidates");
const sourceFilter = flagValue("--source");
const limitArg = flagValue("--limit");
const limitN = limitArg ? parseInt(limitArg, 10) : 1;
const limitValidationArg = flagValue("--limit-validation");
const limitValidationN = limitValidationArg ? parseInt(limitValidationArg, 10) : 3;
const targetIdArg = positionals[0];

const scraperApiKeys = [
  process.env.SCRAPERAPI_KEY,
  process.env.SCRAPERAPI_KEY_01,
  process.env.SCRAPERAPI_KEY_02,
  process.env.SCRAPERAPI_KEY_03,
].filter((k): k is string => Boolean(k));

let targets;
if (targetIdArg && !targetIdArg.startsWith("--")) {
  const t = SEARCH_TARGETS.find((t) => t.id === targetIdArg);
  if (!t) {
    console.error(`unknown target id: ${targetIdArg}`);
    console.error("available ids:\n  " + SEARCH_TARGETS.map((t) => t.id).join("\n  "));
    process.exit(1);
  }
  targets = [t];
} else {
  let pool = sourceFilter
    ? ENABLED_SEARCH_TARGETS.filter((t) => t.source === sourceFilter)
    : ENABLED_SEARCH_TARGETS;
  targets = pool.slice(0, limitN);
  if (targets.length === 0) {
    console.error(`no enabled targets found${sourceFilter ? ` for source: ${sourceFilter}` : ""}`);
    process.exit(1);
  }
}

for (const target of targets) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`target: ${target.id}`);
  console.log(`source: ${target.source}`);
  console.log(`search url: ${target.searchUrl}`);
  console.log(`proxy keys available: ${scraperApiKeys.length}`);

  const result = await discoverListingUrlsForTarget(target, { debug: showDebug, scraperApiKeys });
  const d = result.debug;

  console.log("\n--- fetch ---");
  console.log(`  status:      ${result.httpStatus ?? "n/a"}`);
  console.log(`  blockStatus: ${result.blockStatus ?? "n/a"}`);
  if (d) {
    console.log(`  html length: ${d.htmlLength} chars`);
    console.log(`  title:       ${d.htmlTitle ?? "(none)"}`);
  }

  if (d) {
    if (target.source === "streeteasy" && d.streeteasyFetchMethod) {
      console.log("\n--- streeteasy api ---");
      console.log(`  fetch method:   ${d.streeteasyFetchMethod}`);
      console.log(`  area ids:       ${d.streeteasyAreaIds?.join(", ") ?? "n/a"} (${d.streeteasyAreaIdSource ?? "unknown"})`);
      if (d.streeteasyFetchMethod === "streeteasy_graphql_search") {
        console.log(`  api status:     ${d.streeteasyApiStatus ?? "n/a"}`);
        console.log(`  total count:    ${d.streeteasyApiTotalCount ?? "n/a"}`);
        console.log(`  edges returned: ${d.streeteasyApiEdgesCount ?? "n/a"}`);
        console.log(`  criteria:       ${d.streeteasyApiCriteria ?? "n/a"}`);
      }
      if (d.streeteasyFallbackUsed) {
        console.log(`  fallback used:  yes`);
      }
    }

    console.log("\n--- blocking signals ---");
    console.log(`  blocked likely: ${d.blockedOrCaptchaLikely}`);
    console.log(`  signals:        ${d.blockedOrCaptchaSignals?.join(", ") || "(none)"}`);

    if (d.htmlLength > 0) {
      console.log("\n--- anchor analysis ---");
      console.log(`  total anchors:        ${d.totalAnchorCount}`);
      console.log(`  listing-like anchors: ${d.listingLikeAnchorCount}`);
      console.log(`  first 25 hrefs:`);
      for (const href of d.firstHrefSamples ?? []) {
        console.log(`    ${href}`);
      }
    }

    console.log("\n--- extraction strategies ---");
    for (const [k, v] of Object.entries(d.extractionStrategyResults ?? {})) {
      console.log(`  ${k}: ${v}`);
    }
  }

  console.log("\n--- result ---");
  console.log(`  candidates:  ${result.candidatesFound}`);
  console.log(`  warnings:    ${result.warnings.join(", ") || "(none)"}`);
  if (result.candidateStats) {
    const s = result.candidateStats;
    console.log(`  stats:       found=${s.listingLikeUrlsFound} accepted=${s.acceptedCandidates} price_over=${s.priceOverMax} beds_mismatch=${s.bedsIncompatible} dupes=${s.duplicateUrls}${s.unsupportedBuildingUrls != null ? ` buildings=${s.unsupportedBuildingUrls}` : ""}`);
  }

  if (result.candidates.length > 0) {
    console.log("\n--- candidates (first 10) ---");
    for (const c of result.candidates.slice(0, 10)) {
      console.log(`  ${c.listingUrl}`);
      console.log(`    price=${c.price ?? "?"} beds=${c.beds ?? "?"} baths=${c.baths ?? "?"} confidence=${c.confidence}`);
      if (c.neighborhood || c.address) {
        console.log(`    neighborhood=${c.neighborhood ?? "?"} address=${c.address ?? "?"}`);
      }
    }
  }

  if (showRejected) {
    const interestingRejects = (result.rejectedPreview ?? result.rejected).filter(
      (r) => r.reason === "price_over_max" || r.reason === "beds_incompatible" || r.reason === "building_url_not_supported"
    );
    if (interestingRejects.length > 0) {
      console.log("\n--- rejected listing urls ---");
      for (const r of interestingRejects) {
        console.log(`  [${r.reason}] ${r.url}${r.note ? ` — ${r.note}` : ""}`);
      }
    }
  }

  if (d && d.htmlLength > 0) {
    console.log("\n--- html snippet (first 500 chars) ---");
    console.log(d.htmlSnippetStart?.slice(0, 500) ?? "(none)");
  }

  if (validateCandidates && target.source === "streeteasy" && result.candidates.length > 0) {
    const toValidate = result.candidates.slice(0, limitValidationN);
    console.log(`\n--- candidate validation (first ${toValidate.length}) ---`);
    for (const c of toValidate) {
      const detail = await fetchStreetEasyListingJsonOrHtml(c.listingUrl);
      if (!detail.ok) {
        console.log(`  ${c.listingUrl} — fetch failed (${detail.httpStatus ?? "no status"}): ${detail.warnings.join(", ")}`);
        continue;
      }
      const dataSize = detail.contentType === "html"
        ? `${detail.html?.length ?? 0} chars html`
        : `json (${detail.contentType})`;
      console.log(`  ${c.listingUrl}`);
      console.log(`    content-type=${detail.contentType} size=${dataSize}`);
      console.log(`    price=${c.price ?? "?"} beds=${c.beds ?? "?"} baths=${c.baths ?? "?"} neighborhood=${c.neighborhood ?? "?"}`);
    }
  }

  if (validateCandidates && target.source === "nooklyn" && result.candidates.length > 0) {
    const toValidate = result.candidates.slice(0, limitValidationN);
    console.log(`\n--- candidate validation (first ${toValidate.length}) ---`);
    for (const c of toValidate) {
      const slug = extractNooklynSlugFromUrl(c.listingUrl);
      if (!slug) { console.log(`  ${c.listingUrl} — could not extract slug`); continue; }
      const detail = await fetchNooklynListingBySlug(slug, c.listingUrl);
      if (!detail.ok || !detail.listing) {
        console.log(`  ${c.listingUrl} — fetch failed: ${detail.warnings.join(", ")}`);
        continue;
      }
      const l = detail.listing;
      const price = typeof l.price === "number" ? Math.round(l.price / 100) : "?";
      const beds = l.bedrooms ?? "?";
      const baths = l.bathrooms ?? "?";
      const address = l.address ?? "?";
      const neigh = (l.neighborhood as { name?: string } | undefined)?.name ?? "?";
      console.log(`  ${c.listingUrl}`);
      console.log(`    price=${price} beds=${beds} baths=${baths}`);
      console.log(`    neighborhood=${neigh} address=${address}`);
    }
  }
}
