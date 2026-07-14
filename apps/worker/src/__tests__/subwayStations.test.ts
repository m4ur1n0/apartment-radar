import { describe, it, expect } from "vitest";
import { app } from "../index";
import { SUBWAY_STATIONS } from "../location/generatedSubwayStations";

// minimal mock db — this endpoint doesn't touch the DB
const mockDb = {} as unknown as D1Database;

describe("GET /subway-stations", () => {
  it("returns 200 with a stations array", async () => {
    const res = await app.request("/subway-stations", { method: "GET" }, { DB: mockDb });
    expect(res.status).toBe(200);
    const body = await res.json() as { stations: unknown[] };
    expect(Array.isArray(body.stations)).toBe(true);
    expect(body.stations.length).toBeGreaterThan(0);
  });

  it("station count matches generated constant", async () => {
    const res = await app.request("/subway-stations", { method: "GET" }, { DB: mockDb });
    const body = await res.json() as { stations: unknown[] };
    expect(body.stations.length).toBe(SUBWAY_STATIONS.length);
  });

  it("each station has required normalized fields", async () => {
    const res = await app.request("/subway-stations", { method: "GET" }, { DB: mockDb });
    const body = await res.json() as { stations: Record<string, unknown>[] };

    for (const s of body.stations) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(typeof s.latitude).toBe("number");
      expect(typeof s.longitude).toBe("number");
      expect(Array.isArray(s.lines)).toBe(true);
      expect(typeof s.borough).toBe("string");
    }
  });

  it("does not expose raw gtfs_stop_ids field", async () => {
    const res = await app.request("/subway-stations", { method: "GET" }, { DB: mockDb });
    const body = await res.json() as { stations: Record<string, unknown>[] };
    const first = body.stations[0];
    expect(first.gtfs_stop_ids).toBeUndefined();
  });

  it("station ids start with mta_", async () => {
    const res = await app.request("/subway-stations", { method: "GET" }, { DB: mockDb });
    const body = await res.json() as { stations: Record<string, unknown>[] };
    for (const s of body.stations) {
      expect((s.id as string).startsWith("mta_")).toBe(true);
    }
  });

  it("lines are arrays of strings", async () => {
    const res = await app.request("/subway-stations", { method: "GET" }, { DB: mockDb });
    const body = await res.json() as { stations: Record<string, unknown>[] };
    const withLines = body.stations.filter((s) => (s.lines as string[]).length > 0);
    expect(withLines.length).toBeGreaterThan(0);
    for (const s of withLines) {
      for (const line of s.lines as string[]) {
        expect(typeof line).toBe("string");
      }
    }
  });
});
