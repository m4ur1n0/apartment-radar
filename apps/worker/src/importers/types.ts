export type ImportSource =
  | "streeteasy"
  | "zillow"
  | "craigslist"
  | "nooklyn"
  | "renthop"
  | "apartments"
  | "unknown";

export type Confidence = "low" | "medium" | "high";

export type FetchMode = "direct" | "scraperapi";

export interface ExtractedFields {
  canonical_url?: string;
  source?: string;
  source_listing_id?: string;
  title?: string;
  description?: string;
  address_text?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  rent?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  available_date?: string;
  nearest_subway_station?: string;
  nearest_subway_lines?: string;
  subway_walk_minutes?: number;
  subway_walk_source?: string;
  subway_walk_confidence?: string;
  google_maps_directions_url?: string;
  fee_status?: string;
  laundry?: string;
  dishwasher?: boolean;
  outdoor_space?: boolean;
  elevator?: boolean;
  pets?: string;
  amenities?: string[];
}

export interface ImportPreviewResult {
  url: string;
  source: ImportSource;
  confidence: Confidence;
  fetchMode: FetchMode;
  fields: ExtractedFields;
  warnings: string[];
  debug?: {
    httpStatus?: number;
    htmlCharsParsed?: number;
    extractorsUsed: string[];
    zillowDetailSignalsFound?: number;
    zillowJsonScriptsFound?: number;
    zillowPropertyCardsFound?: number;
    nooklynDetailSignalsFound?: number;
    amenitiesFoundCount?: number;
    textSample?: string;
  };
}
