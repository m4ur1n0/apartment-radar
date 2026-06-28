import type { FetchMode, ImportPreviewResult } from "./types";
import { detectSource } from "./sources";
import { genericExtract } from "./generic";

export async function importPreview(
  url: string,
  options: { fetchMode?: FetchMode; scraperApiKey?: string; debugText?: boolean; debugFetchProfiles?: boolean } = {}
): Promise<ImportPreviewResult> {
  const { fetchMode = "direct", scraperApiKey, debugText, debugFetchProfiles } = options;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { url, source: "unknown", confidence: "low", fetchMode, fields: {}, warnings: ["invalid url"] };
  }

  const source = detectSource(parsedUrl.hostname);
  return genericExtract(url, source, fetchMode, scraperApiKey, { debugText, debugFetchProfiles });
}
