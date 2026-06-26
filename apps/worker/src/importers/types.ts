export type ImportSource =
  | "streeteasy"
  | "zillow"
  | "craigslist"
  | "nooklyn"
  | "renthop"
  | "apartments"
  | "unknown";

export type Confidence = "low" | "medium" | "high";

export interface ExtractedFields {
  canonical_url?: string;
  source?: string;
  title?: string;
  description?: string;
  address_text?: string;
  neighborhood?: string;
  rent?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  available_date?: string;
  nearest_subway_station?: string;
  nearest_subway_lines?: string;
  fee_status?: string;
  laundry?: string;
  dishwasher?: boolean;
  outdoor_space?: boolean;
  pets?: string;
}

export interface ImportPreviewResult {
  url: string;
  source: ImportSource;
  confidence: Confidence;
  fields: ExtractedFields;
  warnings: string[];
}
