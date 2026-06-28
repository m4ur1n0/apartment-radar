"use client";

import { useState, useEffect, useCallback } from "react";
import type { Listing } from "./types";
import ListingRatingControls from "./ListingRatingControls";

type Props = {
  listing: Listing;
  onClose: () => void;
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

export default function ListingDetailDialog({ listing: l, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
            <div>
              <span className="text-2xl font-semibold text-stone-900">
                ${l.rent.toLocaleString()}
                <span className="text-stone-400 text-base font-normal">/mo</span>
              </span>
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

          {/* rate */}
          <SectionRule label="rate this listing" />
          <ListingRatingControls listingId={l.id} />

          {/* description */}
          {l.description && (
            <>
              <SectionRule label="description" />
              <p className="text-sm text-stone-600 leading-relaxed">{l.description}</p>
            </>
          )}

          {/* meta */}
          <div className="mt-6 pt-4 border-t border-stone-100">
            <p className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-300">
              first seen {new Date(l.first_seen_at).toLocaleDateString()} · last seen {new Date(l.last_seen_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
