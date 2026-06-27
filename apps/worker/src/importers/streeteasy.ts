import type { ExtractedFields } from "./types";

export interface StreetEasyExtractResult {
  fields: ExtractedFields;
  warnings: string[];
  extractorsUsed: string[];
}

// placeholder — streeteasy blocks direct fetches; scraperapi + rendering needed for full data.
// generic layer (og/meta/json-ld/regex) still runs after this and fills what it can.
export function extractStreetEasyFields(args: { url: string; html: string }): StreetEasyExtractResult {
  const { url, html } = args;
  const fields: ExtractedFields = { canonical_url: url, source: "streeteasy" };

  // source_listing_id from URL: /for-rent/listing/12345
  const idM = url.match(/\/listing[s]?\/(\d+)/i);
  if (idM) fields.source_listing_id = idM[1];

  // short-circuit if blocked (typical direct-fetch response)
  const isBlocked = html.length < 5000 || /enable javascript|access denied|robot/i.test(html.slice(0, 2000));

  return {
    fields,
    warnings: [
      "streeteasy parser used",
      "streeteasy parser incomplete",
      ...(isBlocked ? ["streeteasy may have blocked direct fetch — try scraperapi mode"] : []),
    ],
    extractorsUsed: ["streeteasy"],
  };
}
