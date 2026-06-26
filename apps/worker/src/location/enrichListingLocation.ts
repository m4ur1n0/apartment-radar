import type { SubwayStation } from "./generatedSubwayStations";

export type { SubwayStation };

interface Coords {
  latitude: number;
  longitude: number;
}

export interface SubwayEstimate {
  station_id: string;
  station_name: string;
  lines: string[];
  straight_line_miles: number;
  estimated_walk_minutes: number;
  estimate_method: "haversine_grid_estimate";
  confidence: "low" | "medium" | "high";
  google_maps_directions_url: string;
}

export interface LocationEnrichmentResult {
  nearest_subway_station?: string;
  nearest_subway_lines?: string;
  subway_walk_minutes?: number;
  subway_walk_source?: string;
  subway_walk_confidence?: string;
  google_maps_directions_url?: string;
  subway_estimates: SubwayEstimate[];
  warnings: string[];
}

export function haversineMiles(a: Coords, b: Coords): number {
  const R = 3958.8;
  const dLat = (b.latitude - a.latitude) * (Math.PI / 180);
  const dLon = (b.longitude - a.longitude) * (Math.PI / 180);
  const sinHalfDLat = Math.sin(dLat / 2);
  const sinHalfDLon = Math.sin(dLon / 2);
  const h =
    sinHalfDLat * sinHalfDLat +
    Math.cos(a.latitude * (Math.PI / 180)) *
      Math.cos(b.latitude * (Math.PI / 180)) *
      sinHalfDLon *
      sinHalfDLon;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function estimateWalkMinutes(straightLineMiles: number): number {
  // 1.25 street-grid fudge factor, 3.0 mph walking speed
  return Math.round((straightLineMiles * 1.25) / 3.0 * 60);
}

export function buildGoogleMapsWalkingDirectionsUrl(
  origin: Coords,
  destination: Coords
): string {
  const o = `${origin.latitude},${origin.longitude}`;
  const d = `${destination.latitude},${destination.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=walking`;
}

export function findNearestSubwayStations(
  coords: Coords,
  stations: SubwayStation[],
  limit = 5
): SubwayEstimate[] {
  return stations
    .map((s) => {
      const miles = haversineMiles(coords, s);
      const walkMins = estimateWalkMinutes(miles);
      const confidence: SubwayEstimate["confidence"] =
        walkMins <= 8 ? "high" : walkMins <= 16 ? "medium" : "low";
      return {
        station_id: s.id,
        station_name: s.name,
        lines: s.lines,
        straight_line_miles: Math.round(miles * 10000) / 10000,
        estimated_walk_minutes: walkMins,
        estimate_method: "haversine_grid_estimate" as const,
        confidence,
        google_maps_directions_url: buildGoogleMapsWalkingDirectionsUrl(coords, s),
      };
    })
    .sort((a, b) => a.estimated_walk_minutes - b.estimated_walk_minutes)
    .slice(0, limit);
}

export function enrichListingLocation(
  input: {
    latitude?: number | null;
    longitude?: number | null;
    address_text?: string | null;
  },
  stations: SubwayStation[]
): LocationEnrichmentResult {
  if (!input.latitude || !input.longitude) {
    return {
      subway_estimates: [],
      warnings: ["subway estimate unavailable because coordinates were not found"],
    };
  }

  const coords = { latitude: input.latitude, longitude: input.longitude };
  const estimates = findNearestSubwayStations(coords, stations);

  if (!estimates.length) {
    return {
      subway_estimates: [],
      warnings: ["no subway stations found near coordinates"],
    };
  }

  const nearest = estimates[0];
  return {
    nearest_subway_station: nearest.station_name,
    nearest_subway_lines: nearest.lines.join(", "),
    subway_walk_minutes: nearest.estimated_walk_minutes,
    subway_walk_source: "estimated_haversine",
    subway_walk_confidence: nearest.confidence,
    google_maps_directions_url: nearest.google_maps_directions_url,
    subway_estimates: estimates,
    warnings: ["subway walk time estimated from coordinates"],
  };
}
