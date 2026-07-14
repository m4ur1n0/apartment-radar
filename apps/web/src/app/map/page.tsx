"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Listing } from "../types";
import ApartmentMap from "../../components/ApartmentMap";
import type { ListingMapPoint, SubwayStationPoint } from "../../components/ApartmentMap";
import ListingDetailDialog from "../ListingDetailDialog";

type LoadState = "loading" | "loaded" | "error";

export default function MapPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [stations, setStations] = useState<SubwayStationPoint[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);

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
    return () => { active = false; };
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

  function handleListingHidden(listingId: string) {
    setListings((prev) => prev.filter((l) => l.id !== listingId));
    setSelectedListing(null);
  }

  return (
    <div className="flex flex-col" style={{ height: "100dvh", background: "var(--background)" }}>
      {/* header */}
      <header className="bg-white border-b border-stone-200 shrink-0">
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
                </>
              )}
            </span>
          </div>
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150"
          >
            ← Listings
          </Link>
        </div>
      </header>

      {/* map area */}
      <div className="flex-1 relative overflow-hidden z-40">
        {loadState === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-300 anim-breathe" />
            <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">Loading</span>
          </div>
        )}

        {loadState === "error" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-red-400">Could not load map data</p>
          </div>
        )}

        {loadState === "loaded" && mappedListings.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">No listings with coordinates</p>
          </div>
        )}

        {loadState === "loaded" && mappedListings.length > 0 && (
          <ApartmentMap
            listings={mapPoints}
            subwayStations={stations}
            focusedListingId={selectedListing?.id}
            mode="all-listings"
            onListingClick={(id) => {
              const found = listings.find((l) => l.id === id);
              if (found) setSelectedListing(found);
            }}
            className="w-full h-full"
          />
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
