interface GeoResult {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": "apt-radar/1.0" },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    const latitude = parseFloat(data[0].lat);
    const longitude = parseFloat(data[0].lon);
    // sanity-check: NYC metro bounding box
    if (latitude >= 40.0 && latitude <= 41.5 && longitude >= -75.0 && longitude <= -73.0) {
      return { latitude, longitude };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
