"use client";

import { useState } from "react";
import type { Listing } from "./types";
import { REVIEWERS } from "./types";

type Props = {
  listing: Listing;
  onClick: () => void;
  animDelay?: number;
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

function urgencyBorderColor(score: number) {
  if (score >= 80) return "border-red-200";
  if (score >= 65) return "border-amber-200";
  return "border-stone-200";
}

function urgencyDotColor(score: number) {
  if (score >= 80) return "bg-red-300";
  if (score >= 65) return "bg-amber-300";
  if (score >= 50) return "bg-emerald-300";
  return "bg-stone-300";
}

function Thumb({ url, alt }: { url: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-full aspect-[3/2] bg-stone-100 flex items-center justify-center">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-300">no photo</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt ?? "listing photo"}
      className="w-full aspect-[3/2] object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export default function ListingCard({ listing: l, onClick, animDelay = 0 }: Props) {
  const bothReviewed = REVIEWERS.every((r) => l.ratings?.some((x) => x.user_name === r));

  return (
    <div
      className="bg-white border border-stone-200 cursor-pointer hover:border-stone-400 transition-colors duration-200 flex flex-col anim-fade-in-up"
      style={{ animationDelay: `${animDelay}s` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
    >
      {/* image */}
      {l.image_urls?.[0] ? (
        <Thumb url={l.image_urls[0]} alt={l.title ?? undefined} />
      ) : (
        <div className="w-full aspect-[3/2] bg-stone-100 flex items-center justify-center">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-300">no photo</span>
        </div>
      )}

      {/* content */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* rent + source */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-xl font-semibold text-stone-900 leading-none">
            ${l.rent.toLocaleString()}
            <span className="text-stone-400 text-sm font-normal">/mo</span>
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-500 border border-stone-200 px-1.5 py-0.5 shrink-0">
            {l.source}
          </span>
        </div>

        {/* beds/baths */}
        <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-500">
          {l.beds}br · {l.baths}ba{l.sqft ? ` · ${l.sqft} sqft` : ""}
        </p>

        {/* neighborhood */}
        {(l.neighborhood || l.borough) && (
          <p className="text-sm text-stone-700 leading-snug">
            {[l.neighborhood, l.borough].filter(Boolean).join(", ")}
          </p>
        )}

        {/* subway — body font, readable */}
        {l.subway_walk_minutes != null && (
          <p className="text-sm text-stone-600 leading-snug">
            {l.subway_walk_minutes} min walk
            {l.nearest_subway_station ? ` · ${l.nearest_subway_station}` : ""}
            {l.nearest_subway_lines ? ` (${l.nearest_subway_lines})` : ""}
          </p>
        )}

        {/* fee / availability */}
        {(l.fee_status || l.available_date) && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {l.fee_status && (
              <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-500">{l.fee_status}</span>
            )}
            {l.available_date && (
              <span className="text-sm text-stone-600">avail {l.available_date}</span>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* score row — stacked label + number, urgency as a bordered badge */}
        <div className="border-t border-stone-100 pt-2.5 mt-1 flex items-end justify-between gap-2">
          <div className="flex items-end gap-5">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-stone-400">fit</span>
              <span className={`font-mono text-[18px] font-semibold leading-none ${scoreColor(l.fit_score)}`}>{l.fit_score}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-stone-400">deal</span>
              <span className={`font-mono text-[18px] font-semibold leading-none ${scoreColor(l.deal_score)}`}>{l.deal_score}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-stone-400">risk</span>
              <span className={`font-mono text-[18px] font-semibold leading-none ${riskColor(l.risk_score)}`}>{l.risk_score}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {bothReviewed && (
              <span className="font-mono text-[9px] uppercase tracking-[0.07em] bg-stone-900 text-white px-1.5 py-0.5">
                Seen
              </span>
            )}
            <div className={`border px-2 py-1 flex items-center gap-1.5 shrink-0 ${urgencyBorderColor(l.urgency_score)}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgencyDotColor(l.urgency_score)}`} />
              <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-500">
                {urgencyLabel(l.urgency_score)}
              </span>
            </div>
          </div>
        </div>

        {/* image count if multiple */}
        {l.image_urls && l.image_urls.length > 1 && (
          <p className="font-mono text-[9px] text-stone-400">{l.image_urls.length} photos</p>
        )}
      </div>
    </div>
  );
}
