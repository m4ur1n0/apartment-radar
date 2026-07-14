"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Listing } from "./types";
import { REVIEWERS } from "./types";
import ListingCard from "./ListingCard";
import ListingDetailDialog from "./ListingDetailDialog";
import ListingImportDialog from "./ListingImportDialog";
import CrawlerStatus from "./CrawlerStatus";

type LoadState = "loading" | "loaded" | "error";

type Filters = {
  search: string;
  maxRent: string;
  neighborhood: string;
  source: string;
  sort: string;
};

const DEFAULT_FILTERS: Filters = {
  search: "",
  maxRent: "",
  neighborhood: "",
  source: "",
  sort: "fit",
};

function ratingFor(listing: Listing, reviewer: string): number | null {
  const r = listing.ratings?.find((x) => x.user_name === reviewer);
  return r?.rating ?? null;
}

export default function Dashboard() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [fetchKey, setFetchKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [crawlerOpen, setCrawlerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/listings");
        if (!active) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) { setLoadState("error"); return; }
        const data = (await res.json()) as { listings: Listing[] };
        if (!active) return;
        setListings(data.listings ?? []);
        setLoadState("loaded");
      } catch {
        if (active) setLoadState("error");
      }
    })();
    return () => { active = false; };
  }, [fetchKey]);

  function triggerRefetch() {
    setLoadState("loading");
    setFetchKey((k) => k + 1);
  }

  function handleListingHidden(listingId: string) {
    setListings((prev) => prev.filter((l) => l.id !== listingId));
    setDetailListing(null);
  }

  const neighborhoods = useMemo(
    () => [...new Set(listings.map((l) => l.neighborhood).filter(Boolean))].sort() as string[],
    [listings]
  );

  const sources = useMemo(
    () => [...new Set(listings.map((l) => l.source))].sort(),
    [listings]
  );

  const filtered = useMemo(() => {
    let result = listings;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (l) =>
          l.title?.toLowerCase().includes(q) ||
          l.address_text?.toLowerCase().includes(q) ||
          l.neighborhood?.toLowerCase().includes(q)
      );
    }
    if (filters.maxRent) {
      const max = parseInt(filters.maxRent);
      result = result.filter((l) => l.rent <= max);
    }
    if (filters.neighborhood) {
      result = result.filter((l) => l.neighborhood === filters.neighborhood);
    }
    if (filters.source) {
      result = result.filter((l) => l.source === filters.source);
    }
    return [...result].sort((a, b) => {
      switch (filters.sort) {
        case "rent_asc":  return a.rent - b.rent;
        case "rent_desc": return b.rent - a.rent;
        case "newest":    return new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime();
        case "subway":    return (a.subway_walk_minutes ?? 99) - (b.subway_walk_minutes ?? 99);
        case "theo": {
          const ra = ratingFor(a, "Theo") ?? -1;
          const rb = ratingFor(b, "Theo") ?? -1;
          return rb - ra;
        }
        case "sam": {
          const ra = ratingFor(a, "Sam") ?? -1;
          const rb = ratingFor(b, "Sam") ?? -1;
          return rb - ra;
        }
        case "avg": {
          const avgRating = (l: Listing) => {
            const vals = REVIEWERS.map((r) => ratingFor(l, r)).filter((v): v is number => v !== null);
            return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : -1;
          };
          return avgRating(b) - avgRating(a);
        }
        default:          return b.fit_score - a.fit_score;
      }
    });
  }, [listings, filters]);

  const hasActiveFilters =
    filters.search || filters.maxRent || filters.neighborhood || filters.source;

  function setFilter(k: keyof Filters) {
    return (v: string) => setFilters((prev) => ({ ...prev, [k]: v }));
  }

  function clearFilters() {
    setFilters((prev) => ({ ...prev, search: "", maxRent: "", neighborhood: "", source: "" }));
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <h1
              className="text-2xl text-stone-900 leading-none mb-1.5"
              style={{ fontFamily: "var(--font-chonburi, serif)", fontWeight: 400 }}
            >
              apt-radar
            </h1>
            <div className="flex items-center gap-2.5">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  loadState === "loaded"
                    ? "bg-emerald-300"
                    : loadState === "error"
                    ? "bg-red-300"
                    : "bg-amber-300 anim-breathe"
                }`}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">
                {loadState === "loading"
                  ? "loading"
                  : loadState === "error"
                  ? "unavailable"
                  : `${filtered.length} of ${listings.length} listing${listings.length !== 1 ? "s" : ""}`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCrawlerOpen((o) => !o)}
              className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150"
            >
              Crawler
            </button>
            <Link
              href="/map"
              className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150"
            >
              Map
            </Link>
            <button
              onClick={triggerRefetch}
              className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150"
            >
              Refresh
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="font-mono text-[11px] uppercase tracking-[0.07em] bg-stone-900 text-white px-5 py-2.5 hover:bg-stone-800 transition-colors duration-150"
            >
              + Add listing
            </button>
          </div>
        </div>

        {crawlerOpen && <CrawlerStatus />}
      </header>

      {/* filter bar */}
      <div className="bg-white/70 border-b border-stone-200 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            placeholder="Search…"
            value={filters.search}
            onChange={(e) => setFilter("search")(e.target.value)}
            className="border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-300 focus:outline-none focus:border-stone-600 transition-colors duration-150 w-36"
          />
          <select
            value={filters.neighborhood}
            onChange={(e) => setFilter("neighborhood")(e.target.value)}
            className="border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 focus:outline-none focus:border-stone-600 transition-colors duration-150"
          >
            <option value="">All neighborhoods</option>
            {neighborhoods.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select
            value={filters.maxRent}
            onChange={(e) => setFilter("maxRent")(e.target.value)}
            className="border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 focus:outline-none focus:border-stone-600 transition-colors duration-150"
          >
            <option value="">Any rent</option>
            <option value="2500">≤ $2,500</option>
            <option value="3000">≤ $3,000</option>
            <option value="3500">≤ $3,500</option>
            <option value="4000">≤ $4,000</option>
          </select>
          <select
            value={filters.source}
            onChange={(e) => setFilter("source")(e.target.value)}
            className="border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 focus:outline-none focus:border-stone-600 transition-colors duration-150"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* spacer */}
          <div className="flex-1" />

          <select
            value={filters.sort}
            onChange={(e) => setFilter("sort")(e.target.value)}
            className="border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 focus:outline-none focus:border-stone-600 transition-colors duration-150"
          >
            <option value="fit">Best fit</option>
            <option value="rent_asc">Rent ↑</option>
            <option value="rent_desc">Rent ↓</option>
            <option value="newest">Newest</option>
            <option value="subway">Shortest walk</option>
            <option value="theo">Theo rating</option>
            <option value="sam">Sam rating</option>
            <option value="avg">Avg rating</option>
          </select>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150 border border-stone-200 px-2 py-1.5"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* main */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {loadState === "loading" && (
          <div className="flex items-center gap-2.5 py-24">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-300 anim-breathe" />
            <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">Loading listings</span>
          </div>
        )}

        {loadState === "error" && (
          <div className="py-24 border-l-2 border-red-300 pl-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-red-400">Could not load listings</p>
            <button
              onClick={triggerRefetch}
              className="mt-3 font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {loadState === "loaded" && filtered.length === 0 && (
          <div className="py-24">
            <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">
              {listings.length === 0
                ? "No listings yet — add one above."
                : "No listings match these filters."}
            </p>
          </div>
        )}

        {loadState === "loaded" && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((l, i) => (
              <ListingCard
                key={l.id}
                listing={l}
                onClick={() => setDetailListing(l)}
                animDelay={Math.min(i * 0.04, 0.3)}
              />
            ))}
          </div>
        )}
      </main>

      {importOpen && (
        <ListingImportDialog
          onClose={() => setImportOpen(false)}
          onSuccess={() => {
            setImportOpen(false);
            triggerRefetch();
          }}
        />
      )}

      {detailListing && (
        <ListingDetailDialog
          listing={detailListing}
          onClose={() => setDetailListing(null)}
          onHidden={handleListingHidden}
        />
      )}
    </div>
  );
}
