"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Listing } from "../types";
import ApartmentMap from "../../components/ApartmentMap";
import type { ListingMapPoint, SubwayStationPoint, DrawnPolygon } from "../../components/ApartmentMap";
import ListingDetailDialog from "../ListingDetailDialog";

type LoadState = "loading" | "loaded" | "error";

type DrawState =
  | { type: "idle" }
  | { type: "drawing" }
  | { type: "complete"; polygon: DrawnPolygon; matches: Listing[] };

function pointInPolygon(lat: number, lng: number, polygon: DrawnPolygon): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [lat_i, lng_i] = polygon[i];
    const [lat_j, lng_j] = polygon[j];
    if ((lat_i > lat) !== (lat_j > lat)) {
      const lng_cross = lng_i + ((lat - lat_i) * (lng_j - lng_i)) / (lat_j - lat_i);
      if (lng < lng_cross) inside = !inside;
    }
  }
  return inside;
}

function scoreColor(s: number) {
  if (s >= 75) return "text-emerald-500";
  if (s >= 55) return "text-amber-500";
  return "text-stone-400";
}

function urgencyDot(score: number) {
  if (score >= 80) return "bg-red-300";
  if (score >= 65) return "bg-amber-300";
  if (score >= 50) return "bg-emerald-300";
  return "bg-stone-300";
}

function ResultListingRow({
  listing: l,
  onClick,
}: {
  listing: Listing;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border-b border-stone-100 hover:bg-stone-50 transition-colors duration-150"
    >
      {/* price + source */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-base font-semibold text-stone-900">
          ${l.rent.toLocaleString()}
          <span className="text-stone-400 text-xs font-normal">/mo</span>
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400 border border-stone-200 px-1.5 py-0.5 shrink-0">
          {l.source}
        </span>
      </div>

      {/* beds/baths */}
      <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-500 mb-0.5">
        {l.beds}br · {l.baths}ba{l.sqft ? ` · ${l.sqft} sqft` : ""}
      </p>

      {/* neighborhood */}
      {(l.neighborhood || l.borough) && (
        <p className="text-xs text-stone-700 mb-1.5">
          {[l.neighborhood, l.borough].filter(Boolean).join(", ")}
        </p>
      )}

      {/* scores */}
      <div className="flex items-center gap-3.5">
        <span className="font-mono text-[9px] text-stone-400">
          fit{" "}
          <span className={`font-semibold ${scoreColor(l.fit_score)}`}>
            {l.fit_score}
          </span>
        </span>
        <span className="font-mono text-[9px] text-stone-400">
          deal{" "}
          <span className={`font-semibold ${scoreColor(l.deal_score)}`}>
            {l.deal_score}
          </span>
        </span>
        <span className="font-mono text-[9px] text-stone-400">
          risk{" "}
          <span className="font-semibold">{l.risk_score}</span>
        </span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ml-auto ${urgencyDot(l.urgency_score)}`} />
      </div>
    </button>
  );
}

export default function MapPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [stations, setStations] = useState<SubwayStationPoint[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [drawState, setDrawState] = useState<DrawState>({ type: "idle" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [listRes, stationRes] = await Promise.all([
          fetch("/api/listings"),
          fetch("/api/subway-stations"),
        ]);
        if (!active) return;
        if (listRes.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!listRes.ok || !stationRes.ok) {
          setLoadState("error");
          return;
        }
        const [listData, stationData] = await Promise.all([
          listRes.json() as Promise<{ listings: Listing[] }>,
          stationRes.json() as Promise<{ stations: SubwayStationPoint[] }>,
        ]);
        if (!active) return;
        setListings(listData.listings ?? []);
        setStations(stationData.stations ?? []);
        setLoadState("loaded");
      } catch {
        if (active) setLoadState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const mappedListings = useMemo(
    () => listings.filter((l) => l.latitude != null && l.longitude != null),
    [listings]
  );

  const unmappedCount = listings.length - mappedListings.length;

  const mapPoints: ListingMapPoint[] = mappedListings.map((l) => ({
    id: l.id,
    title: l.title ?? undefined,
    address: l.address_text ?? undefined,
    price: l.rent,
    latitude: l.latitude!,
    longitude: l.longitude!,
    neighborhood: l.neighborhood ?? undefined,
  }));

  const highlightedIds = useMemo(() => {
    if (drawState.type !== "complete") return undefined;
    return new Set(drawState.matches.map((l) => l.id));
  }, [drawState]);

  function handleDrawComplete(polygon: DrawnPolygon) {
    const matches = mappedListings
      .filter((l) => pointInPolygon(l.latitude!, l.longitude!, polygon))
      .sort((a, b) => b.fit_score - a.fit_score);
    setDrawState({ type: "complete", polygon, matches });
  }

  function handleListingHidden(listingId: string) {
    setListings((prev) => prev.filter((l) => l.id !== listingId));
    setSelectedListing(null);
    if (drawState.type === "complete") {
      setDrawState((prev) =>
        prev.type === "complete"
          ? { ...prev, matches: prev.matches.filter((l) => l.id !== listingId) }
          : prev
      );
    }
  }

  const isDrawMode = drawState.type === "drawing";
  const drawnPolygon = drawState.type === "complete" ? drawState.polygon : null;
  const showPanel = drawState.type === "complete";

  return (
    <div className="flex flex-col" style={{ height: "100dvh", background: "var(--background)" }}>
      {/* header */}
      <header className="bg-white border-b border-stone-200 shrink-0 relative z-50">
        <div className="max-w-none px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1
              className="text-xl text-stone-900 leading-none mb-1"
              style={{ fontFamily: "var(--font-chonburi, serif)", fontWeight: 400 }}
            >
              apt-radar / map
            </h1>
            <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">
              {loadState === "loading" && "loading"}
              {loadState === "error" && "unavailable"}
              {loadState === "loaded" && (
                <>
                  {mappedListings.length} listing{mappedListings.length !== 1 ? "s" : ""} mapped
                  {unmappedCount > 0 && ` · ${unmappedCount} without coordinates`}
                  {drawState.type === "complete" &&
                    ` · ${drawState.matches.length} in selection`}
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Draw mode controls */}
            {loadState === "loaded" && mappedListings.length > 0 && (
              <>
                {drawState.type === "idle" && (
                  <button
                    onClick={() => setDrawState({ type: "drawing" })}
                    className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-500 border border-stone-300 px-3 py-1.5 hover:border-stone-600 hover:text-stone-800 transition-colors duration-150"
                  >
                    ◎ Select area
                  </button>
                )}
                {drawState.type === "drawing" && (
                  <button
                    onClick={() => setDrawState({ type: "idle" })}
                    className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-500 border border-stone-300 px-3 py-1.5 hover:border-stone-600 transition-colors duration-150"
                  >
                    Cancel
                  </button>
                )}
                {drawState.type === "complete" && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDrawState({ type: "drawing" })}
                      className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-500 border border-stone-300 px-3 py-1.5 hover:border-stone-600 transition-colors duration-150"
                    >
                      Redraw
                    </button>
                    <button
                      onClick={() => setDrawState({ type: "idle" })}
                      className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150 px-1"
                    >
                      Clear ✕
                    </button>
                  </div>
                )}
              </>
            )}

            <Link
              href="/"
              className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150"
            >
              ← Listings
            </Link>
          </div>
        </div>
      </header>

      {/* map + panel area */}
      <div className="flex-1 relative overflow-hidden z-40">
        {loadState === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-300 anim-breathe" />
            <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">
              Loading
            </span>
          </div>
        )}

        {loadState === "error" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-red-400">
              Could not load map data
            </p>
          </div>
        )}

        {loadState === "loaded" && mappedListings.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">
              No listings with coordinates
            </p>
          </div>
        )}

        {loadState === "loaded" && mappedListings.length > 0 && (
          <>
            {/* Draw instruction banner */}
            {isDrawMode && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                <div
                  className="bg-stone-900/80 px-5 py-2.5"
                  style={{ backdropFilter: "blur(6px)" }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/90 text-center whitespace-nowrap">
                    Click and drag to draw a selection · release to finish
                  </p>
                </div>
              </div>
            )}

            <ApartmentMap
              listings={mapPoints}
              subwayStations={stations}
              focusedListingId={selectedListing?.id}
              mode="all-listings"
              onListingClick={(id) => {
                const found = listings.find((l) => l.id === id);
                if (found) setSelectedListing(found);
              }}
              className="absolute inset-0"
              drawMode={isDrawMode}
              drawnPolygon={drawnPolygon}
              onDrawComplete={handleDrawComplete}
              highlightedIds={highlightedIds}
            />

            {/* Results panel */}
            {showPanel && (
              <div
                className="absolute right-0 top-0 bottom-0 w-80 bg-white border-l border-stone-200 shadow-2xl z-40 flex flex-col"
                style={{ animation: "slideInRight 0.22s cubic-bezier(0.16, 1, 0.3, 1) both" }}
              >
                {/* Panel header */}
                <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between shrink-0 bg-white">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-stone-400 mb-0.5">
                      Selection
                    </p>
                    <p className="text-sm font-semibold text-stone-900">
                      {drawState.type === "complete" && drawState.matches.length}{" "}
                      listing
                      {drawState.type === "complete" && drawState.matches.length !== 1
                        ? "s"
                        : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => setDrawState({ type: "idle" })}
                    className="font-mono text-[10px] text-stone-400 hover:text-stone-700 transition-colors px-1 py-1"
                    aria-label="Close selection"
                  >
                    ✕
                  </button>
                </div>

                {/* Sort label */}
                {drawState.type === "complete" && drawState.matches.length > 0 && (
                  <div className="px-4 py-1.5 border-b border-stone-100 bg-stone-50 shrink-0">
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">
                      Sorted by fit score
                    </span>
                  </div>
                )}

                {/* Listing rows */}
                <div className="overflow-y-auto flex-1">
                  {drawState.type === "complete" && drawState.matches.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
                      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-stone-400">
                        No listings in this area
                      </p>
                      <p className="text-xs text-stone-400">Try drawing a larger area</p>
                      <button
                        onClick={() => setDrawState({ type: "drawing" })}
                        className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-stone-500 border border-stone-300 px-3 py-1.5 hover:border-stone-600 transition-colors"
                      >
                        Redraw
                      </button>
                    </div>
                  ) : (
                    drawState.type === "complete" &&
                    drawState.matches.map((l) => (
                      <ResultListingRow
                        key={l.id}
                        listing={l}
                        onClick={() => setSelectedListing(l)}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedListing && (
        <ListingDetailDialog
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          onHidden={handleListingHidden}
        />
      )}
    </div>
  );
}
