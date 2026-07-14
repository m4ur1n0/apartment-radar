import { describe, it, expect } from "vitest";
import { haversineDistanceMiles } from "../lib/geo";

// --- haversine helper ---

describe("haversineDistanceMiles", () => {
  it("returns ~0 for identical points", () => {
    expect(haversineDistanceMiles(40.7, -73.9, 40.7, -73.9)).toBeCloseTo(0, 3);
  });

  it("JFK to LGA is roughly 10 miles", () => {
    const dist = haversineDistanceMiles(40.6413, -73.7781, 40.7769, -73.8740);
    expect(dist).toBeGreaterThan(9);
    expect(dist).toBeLessThan(13);
  });

  it("two nearby Brooklyn points are under 0.5 miles", () => {
    const dist = haversineDistanceMiles(40.6892, -73.9442, 40.6930, -73.9480);
    expect(dist).toBeLessThan(0.5);
  });

  it("cross-NYC points Manhattan to Bronx are over 5 miles", () => {
    const dist = haversineDistanceMiles(40.7128, -74.0060, 40.8448, -73.8648);
    expect(dist).toBeGreaterThan(5);
  });
});

// --- listing coordinate filter ---

type PartialListing = {
  id: string;
  latitude: number | null;
  longitude: number | null;
};

function filterMappedListings(listings: PartialListing[]) {
  return listings.filter((l) => l.latitude != null && l.longitude != null);
}

describe("filterMappedListings", () => {
  it("keeps listings with valid coordinates", () => {
    const result = filterMappedListings([
      { id: "a", latitude: 40.7, longitude: -73.9 },
      { id: "b", latitude: null, longitude: null },
      { id: "c", latitude: 40.6, longitude: -73.8 },
    ]);
    expect(result.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("returns empty for all-null coords", () => {
    const result = filterMappedListings([
      { id: "x", latitude: null, longitude: null },
    ]);
    expect(result).toHaveLength(0);
  });

  it("counts unmapped as total minus mapped", () => {
    const all = [
      { id: "a", latitude: 40.7, longitude: -73.9 },
      { id: "b", latitude: null, longitude: null },
    ];
    const mapped = filterMappedListings(all);
    expect(all.length - mapped.length).toBe(1);
  });
});

// --- nearby station filter (mirrors listing detail logic) ---

const NEARBY_MILES = 0.75;

type StationPoint = { id: string; latitude: number; longitude: number };

function filterNearbyStations(
  listingLat: number,
  listingLng: number,
  stations: StationPoint[],
) {
  return stations.filter(
    (s) => haversineDistanceMiles(listingLat, listingLng, s.latitude, s.longitude) <= NEARBY_MILES
  );
}

describe("filterNearbyStations", () => {
  it("keeps stations within 0.75 miles", () => {
    const listing = { lat: 40.7, lng: -73.9 };
    // ~0.1 miles away
    const close = { id: "close", latitude: 40.7014, longitude: -73.9 };
    // ~5 miles away
    const far = { id: "far", latitude: 40.75, longitude: -73.95 };
    const result = filterNearbyStations(listing.lat, listing.lng, [close, far]);
    expect(result.map((s) => s.id)).toEqual(["close"]);
  });

  it("returns empty when no stations are nearby", () => {
    const result = filterNearbyStations(40.7, -73.9, [
      { id: "far", latitude: 40.85, longitude: -73.85 },
    ]);
    expect(result).toHaveLength(0);
  });
});
