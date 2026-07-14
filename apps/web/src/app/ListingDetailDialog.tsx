"use client";

import { useState, useEffect, useCallback } from "react";
import type { Listing } from "./types";
import { REVIEWERS } from "./types";
import ListingRatingControls from "./ListingRatingControls";
import ApartmentMap from "../components/ApartmentMap";
import type { SubwayStationPoint } from "../components/ApartmentMap";
import { haversineDistanceMiles } from "../lib/geo";

type Props = {
  listing: Listing;
  onClose: () => void;
  onHidden?: (listingId: string) => void;
};

function scoreColor(s: number) {
  if (s >= 75) return "text-emerald-500";
  if (s >= 55) return "text-amber-500";
  return "text-stone-400";
}

function riskColor(s: number) {
  if (s <= 25) return "text-emerald-500";
  if (s <= 45) return "text-amber-500";
  return "text-red-400";
}

function urgencyLabel(score: number) {
  if (score >= 80) return "Hot";
  if (score >= 65) return "Strong";
  if (score >= 50) return "Good";
  return "Fair";
}

function SectionRule({ label }: { label: string }) {
  return (
    <div className="relative border-t border-stone-200 mb-4 mt-6">
      <span className="absolute top-[-0.55rem] left-0 font-mono text-[9px] uppercase tracking-[0.14em] text-stone-400 bg-white pr-3">
        {label}
      </span>
    </div>
  );
}

function ImageCarousel({ urls }: { urls: string[] }) {
  const [idx, setIdx] = useState(0);
  const [failedSet, setFailedSet] = useState<Set<number>>(new Set());

  const visibleUrls = urls.map((u, i) => ({ url: u, i })).filter(({ i }) => !failedSet.has(i));

  function markFailed(originalIdx: number) {
    setFailedSet((prev) => {
      const next = new Set(prev);
      next.add(originalIdx);
      return next;
    });
    setIdx((prev) => Math.max(0, prev - 1));
  }

  const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIdx((i) => Math.min(visibleUrls.length - 1, i + 1)), [visibleUrls.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  if (visibleUrls.length === 0) {
    return <div className="w-full h-64 bg-stone-100 flex items-center justify-center">
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-300">no photos</span>
    </div>;
  }

  const cur = visibleUrls[Math.min(idx, visibleUrls.length - 1)];

  return (
    <div className="relative bg-stone-900 select-none">
      <img
        key={cur.url}
        src={cur.url}
        alt={`photo ${idx + 1}`}
        className="w-full h-72 object-cover anim-fade-in"
        referrerPolicy="no-referrer"
        onError={() => markFailed(cur.i)}
      />

      {/* prev/next */}
      {visibleUrls.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            disabled={idx <= 0}
            className="absolute left-0 top-0 bottom-0 px-3 bg-transparent hover:bg-stone-900/20 transition-colors duration-150 disabled:opacity-0 text-white font-mono text-xl"
            aria-label="previous photo"
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            disabled={idx >= visibleUrls.length - 1}
            className="absolute right-0 top-0 bottom-0 px-3 bg-transparent hover:bg-stone-900/20 transition-colors duration-150 disabled:opacity-0 text-white font-mono text-xl"
            aria-label="next photo"
          >
            ›
          </button>

          {/* dot strip */}
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {visibleUrls.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setIdx(i); }}
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-150 ${
                  i === idx ? "bg-white" : "bg-white/35 hover:bg-white/60"
                }`}
              />
            ))}
          </div>
        </>
      )}

      {/* count badge */}
      <div className="absolute top-2 right-2 bg-stone-900/55 px-2 py-0.5">
        <span className="font-mono text-[9px] text-white/70">{Math.min(idx, visibleUrls.length - 1) + 1} / {visibleUrls.length}</span>
      </div>
    </div>
  );
}

const NEARBY_MILES = 0.75;

export default function ListingDetailDialog({ listing: l, onClose, onHidden }: Props) {
  const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "loading" | "error">("idle");
  const [nearbyStations, setNearbyStations] = useState<SubwayStationPoint[]>([]);
  const bothReviewed = REVIEWERS.every((r) => l.ratings?.some((x) => x.user_name === r));

  useEffect(() => {
    if (!l.latitude || !l.longitude) return;
    (async () => {
      try {
        const res = await fetch("/api/subway-stations");
        if (!res.ok) return;
        const data = await res.json() as { stations: SubwayStationPoint[] };
        const lat = l.latitude!;
        const lng = l.longitude!;
        setNearbyStations(
          data.stations.filter(
            (s) => haversineDistanceMiles(lat, lng, s.latitude, s.longitude) <= NEARBY_MILES
          )
        );
      } catch { /* map section just stays empty */ }
    })();
  }, [l.latitude, l.longitude]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function confirmHide() {
    setDeleteState("loading");
    try {
      const res = await fetch(`/api/listings/${l.id}/hide`, { method: "POST" });
      if (res.ok) {
        onHidden?.(l.id);
      } else {
        setDeleteState("error");
      }
    } catch {
      setDeleteState("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8 anim-fade-in"
      style={{ background: "rgba(28, 25, 23, 0.5)" }}
      onClick={onClose}
    >
      <div
        className="relative bg-white w-full max-w-2xl my-auto"
        style={{ animation: "fadeInUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) both" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* corner ticks */}
        <div className="absolute -top-5 -left-5 w-6 h-6 border-t border-l border-stone-300 pointer-events-none" aria-hidden />
        <div className="absolute -bottom-5 -right-5 w-6 h-6 border-b border-r border-stone-300 pointer-events-none" aria-hidden />

        {/* close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150 bg-white px-2 py-1"
        >
          ✕
        </button>

        {/* carousel */}
        {l.image_urls && l.image_urls.length > 0 ? (
          <ImageCarousel urls={l.image_urls} />
        ) : (
          <div className="w-full h-32 bg-stone-100" />
        )}

        {/* body */}
        <div className="p-6">
          {/* header row */}
          <div className="flex items-start justify-between gap-4 mb-1">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-semibold text-stone-900">
                ${l.rent.toLocaleString()}
                <span className="text-stone-400 text-base font-normal">/mo</span>
              </span>
              {bothReviewed && (
                <span className="font-mono text-[9px] uppercase tracking-[0.07em] bg-stone-900 text-white px-1.5 py-0.5 self-center">
                  Seen
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400 border border-stone-200 px-1.5 py-0.5">
                {l.source}
              </span>
              <a
                href={l.canonical_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--color-sage-text)] border border-[var(--color-sage-border)] bg-[var(--color-sage-light)] px-2.5 py-1 hover:bg-[var(--color-sage-hover)] transition-colors duration-150"
              >
                View ↗
              </a>
            </div>
          </div>

          <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-500 mb-1">
            {l.beds}br · {l.baths}ba{l.sqft ? ` · ${l.sqft} sqft` : ""}
          </p>
          {(l.neighborhood || l.borough) && (
            <p className="text-sm text-stone-700 mb-0.5">
              {[l.neighborhood, l.borough].filter(Boolean).join(", ")}
            </p>
          )}
          {l.address_text && (
            <p className="text-sm text-stone-500">{l.address_text}</p>
          )}
          {l.title && (
            <p className="text-sm text-stone-500 mt-1 italic">{l.title}</p>
          )}

          {/* location */}
          {(l.subway_walk_minutes != null || l.manhattan_commute_minutes != null || l.subway_estimates?.length > 0) && (
            <>
              <SectionRule label="location" />
              {l.subway_walk_minutes != null && (
                <p className="text-sm text-stone-700 mb-1">
                  ~{l.subway_walk_minutes} min to{l.nearest_subway_station ? ` ${l.nearest_subway_station}` : " subway"}
                  {l.nearest_subway_lines ? ` (${l.nearest_subway_lines})` : ""}
                  {l.subway_walk_source === "estimated_haversine" ? " — estimated" : ""}
                </p>
              )}
              {l.google_maps_directions_url && (
                <a
                  href={l.google_maps_directions_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm text-[var(--color-sage-text)] hover:underline"
                >
                  Verify in Maps ↗
                </a>
              )}
              {l.manhattan_commute_minutes != null && (
                <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 mt-1">
                  {l.manhattan_commute_minutes} min to Manhattan
                </p>
              )}
              {l.subway_estimates && l.subway_estimates.length > 1 && (
                <div className="flex flex-wrap gap-3 mt-2">
                  {l.subway_estimates.slice(0, 4).map((e) => (
                    <span key={e.station_id} className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-400">
                      {e.station_name} ({e.lines}) ~{e.estimated_walk_minutes} min
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* details */}
          {(l.available_date || l.fee_status || l.laundry || l.pets || l.floor_number != null || l.dishwasher || l.outdoor_space || l.elevator) && (
            <>
              <SectionRule label="details" />
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {l.available_date && <span className="text-sm text-stone-600">Available {l.available_date}</span>}
                {l.fee_status && <span className="text-sm text-stone-600">{l.fee_status}</span>}
                {l.laundry && <span className="text-sm text-stone-600">{l.laundry}</span>}
                {l.pets && <span className="text-sm text-stone-600">Pets: {l.pets}</span>}
                {l.floor_number != null && <span className="text-sm text-stone-600">Floor {l.floor_number}</span>}
                {l.dishwasher ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-500 border border-stone-200 px-1.5 py-0.5">Dishwasher</span>
                ) : null}
                {l.outdoor_space ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-500 border border-stone-200 px-1.5 py-0.5">Outdoor space</span>
                ) : null}
                {l.elevator ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-500 border border-stone-200 px-1.5 py-0.5">Elevator</span>
                ) : null}
              </div>
            </>
          )}

          {/* amenities */}
          {l.amenities && l.amenities.length > 0 && (
            <>
              <SectionRule label="amenities" />
              <div className="flex flex-wrap gap-1">
                {l.amenities.map((a) => (
                  <span
                    key={a}
                    className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-500 border border-stone-200 px-1.5 py-0.5"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* scores */}
          <SectionRule label="scores" />
          <div className="flex flex-wrap gap-6">
            <div>
              <span className="font-mono text-[9px] text-stone-300">fit </span>
              <span className={`font-mono text-sm font-semibold ${scoreColor(l.fit_score)}`}>{l.fit_score}</span>
            </div>
            <div>
              <span className="font-mono text-[9px] text-stone-300">deal </span>
              <span className={`font-mono text-sm font-semibold ${scoreColor(l.deal_score)}`}>{l.deal_score}</span>
            </div>
            <div>
              <span className="font-mono text-[9px] text-stone-300">risk </span>
              <span className={`font-mono text-sm font-semibold ${riskColor(l.risk_score)}`}>{l.risk_score}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                l.urgency_score >= 80 ? "bg-red-300" :
                l.urgency_score >= 65 ? "bg-amber-300" :
                l.urgency_score >= 50 ? "bg-emerald-300" : "bg-stone-300"
              }`} />
              <span className="font-mono text-[9px] text-stone-400 uppercase tracking-[0.07em]">
                {urgencyLabel(l.urgency_score)} ({l.urgency_score})
              </span>
            </div>
          </div>

          {/* reviews */}
          <SectionRule label="reviews" />
          <div className="flex flex-col gap-4 mb-2">
            {REVIEWERS.map((reviewer) => {
              const r = l.ratings?.find((x) => x.user_name === reviewer);
              return (
                <div key={reviewer}>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-stone-400 block mb-1">{reviewer}</span>
                  {r ? (
                    <div className="flex items-start gap-3">
                      <span className="font-mono text-sm font-semibold text-stone-900">{r.rating}/5</span>
                      {r.notes && <span className="text-sm text-stone-600 leading-snug">{r.notes}</span>}
                    </div>
                  ) : (
                    <span className="text-sm text-stone-400 italic">Not reviewed yet</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* rate */}
          <SectionRule label="add / update rating" />
          <ListingRatingControls listingId={l.id} />

          {/* description */}
          {l.description && (
            <>
              <SectionRule label="description" />
              <p className="text-sm text-stone-600 leading-relaxed">{l.description}</p>
            </>
          )}

          {/* map */}
          <SectionRule label="nearby map" />
          {l.latitude && l.longitude ? (
            <div style={{ height: 220 }} className="w-full overflow-hidden border border-stone-200">
              <ApartmentMap
                listings={[{
                  id: l.id,
                  title: l.title ?? undefined,
                  address: l.address_text ?? undefined,
                  price: l.rent,
                  latitude: l.latitude,
                  longitude: l.longitude,
                  neighborhood: l.neighborhood ?? undefined,
                }]}
                subwayStations={nearbyStations}
                mode="listing-detail"
                className="w-full h-full"
              />
            </div>
          ) : (
            <p className="text-sm text-stone-400 italic">Map unavailable for this listing.</p>
          )}

          {/* delete */}
          <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between gap-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-300">
              first seen {new Date(l.first_seen_at).toLocaleDateString()} · last seen {new Date(l.last_seen_at).toLocaleDateString()}
            </p>
            {deleteState === "idle" && (
              <button
                onClick={() => setDeleteState("confirm")}
                className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-400 hover:text-red-400 transition-colors duration-150 shrink-0"
              >
                Delete
              </button>
            )}
            {deleteState === "confirm" && (
              <div className="flex flex-col items-end gap-2">
                <p className="text-xs text-stone-500 text-right max-w-xs">
                  Delete this apartment from Apt Radar? It will be hidden and should not reappear from crawler imports.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteState("idle")}
                    className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmHide}
                    className="font-mono text-[9px] uppercase tracking-[0.07em] text-red-500 hover:text-red-700 border border-red-300 px-2 py-1 transition-colors duration-150"
                  >
                    Yes, delete
                  </button>
                </div>
              </div>
            )}
            {deleteState === "loading" && (
              <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-400">Deleting…</span>
            )}
            {deleteState === "error" && (
              <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-red-400">Failed to delete</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
