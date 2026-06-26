import type { ImportPreviewResult } from "./types";
import { detectSource } from "./sources";
import { genericExtract } from "./generic";

export async function importPreview(url: string): Promise<ImportPreviewResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { url, source: "unknown", confidence: "low", fields: {}, warnings: ["invalid url"] };
  }

  const source = detectSource(parsedUrl.hostname);

  // all sources use generic extraction for now; add source-specific extractors here later
  return genericExtract(url, source);
}
