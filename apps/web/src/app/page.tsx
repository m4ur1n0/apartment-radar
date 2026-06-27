import Link from "next/link";
import ListingRatingControls from "./ListingRatingControls";

type SubwayEstimate = {
  station_id: string;
  station_name: string;
  lines: string;
  estimated_walk_minutes: number;
  confidence: string;
  google_maps_directions_url: string | null;
};

type Listing = {
  id: string;
  canonical_url: string;
  source: string;
  source_listing_id: string | null;
  title: string | null;
  description: string | null;
  address_text: string | null;
  neighborhood: string | null;
  borough: string;
  latitude: number | null;
  longitude: number | null;
  rent: number;
  beds: number;
  baths: number;
  sqft: number | null;
  available_date: string | null;
  nearest_subway_station: string | null;
  nearest_subway_lines: string | null;
  subway_walk_minutes: number | null;
  subway_walk_source: string | null;
  subway_walk_confidence: string | null;
  google_maps_directions_url: string | null;
  manhattan_commute_minutes: number | null;
  fee_status: string | null;
  laundry: string | null;
  dishwasher: number | null;
  outdoor_space: number | null;
  pets: string | null;
  floor_number: number | null;
  elevator: number | null;
  fit_score: number;
  deal_score: number;
  urgency_score: number;
  risk_score: number;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  subway_estimates: SubwayEstimate[];
  amenities: string[];
};

function urgencyLabel(score: number): string {
  if (score >= 80) return "Hot";
  if (score >= 65) return "Strong";
  if (score >= 50) return "Good";
  return "Fair";
}

function urgencyBadge(score: number): string {
  if (score >= 80) return "bg-red-500 text-white";
  if (score >= 65) return "bg-orange-500 text-white";
  if (score >= 50) return "bg-yellow-500 text-black";
  return "bg-zinc-700 text-zinc-300";
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-green-400";
  if (score >= 55) return "text-yellow-400";
  return "text-red-400";
}

function riskColor(score: number): string {
  if (score <= 20) return "text-green-400";
  if (score <= 40) return "text-yellow-400";
  return "text-red-400";
}

export default async function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  let listings: Listing[] = [];

  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/listings`, {
        next: { revalidate: 60 },
      });
      if (res.ok) {
        const data = (await res.json()) as { listings: Listing[] };
        listings = data.listings;
      }
    } catch {
      // api unreachable at build time
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">
              Today&apos;s best Brooklyn 2BRs
            </h1>
            <p className="text-zinc-400 text-sm">
              {listings.length} active listing{listings.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Link href="/new" className="text-sm text-zinc-400 hover:text-zinc-200">
            Add listing
          </Link>
        </div>

        {listings.length === 0 ? (
          <div className="text-center py-20 text-zinc-500">
            <p className="text-lg">No listings yet.</p>
            <p className="text-sm mt-2">
              <Link href="/new" className="underline">Add one.</Link>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {listings.map((l) => (
              <div
                key={l.id}
                className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${urgencyBadge(l.urgency_score)}`}
                    >
                      {urgencyLabel(l.urgency_score)} &middot; {l.urgency_score}
                    </span>
                    <span className="text-xs text-zinc-500 uppercase tracking-wide">
                      {l.source}
                    </span>
                    {l.fee_status && (
                      <span className="text-xs text-zinc-400">{l.fee_status}</span>
                    )}
                  </div>
                  <a
                    href={l.canonical_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
                  >
                    View listing &rarr;
                  </a>
                </div>

                {l.title && (
                  <h2 className="text-base font-semibold text-white mb-1">
                    {l.title}
                  </h2>
                )}

                <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-sm">
                  {(l.neighborhood || l.borough) && (
                    <span className="text-zinc-300">
                      {[l.neighborhood, l.borough].filter(Boolean).join(", ")}
                    </span>
                  )}
                  <span className="text-white font-bold">
                    ${l.rent.toLocaleString()}/mo
                  </span>
                  <span className="text-zinc-400">
                    {l.beds}BR / {l.baths}BA
                    {l.sqft ? ` · ${l.sqft} sqft` : ""}
                  </span>
                </div>

                {(l.nearest_subway_station ||
                  l.nearest_subway_lines ||
                  l.subway_walk_minutes != null) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-sm text-zinc-400">
                    {l.subway_walk_minutes != null && l.nearest_subway_station && (
                      <span>
                        ~{l.subway_walk_minutes} min to {l.nearest_subway_station}
                        {l.nearest_subway_lines ? ` (${l.nearest_subway_lines})` : ""}
                        {l.subway_walk_source === "estimated_haversine" ? ", estimated" : ""}
                      </span>
                    )}
                    {l.subway_walk_minutes != null && !l.nearest_subway_station && (
                      <span>{l.subway_walk_minutes} min walk</span>
                    )}
                    {!l.nearest_subway_station && l.nearest_subway_lines && (
                      <span>{l.nearest_subway_lines}</span>
                    )}
                    {l.google_maps_directions_url && (
                      <a
                        href={l.google_maps_directions_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Verify walk in Maps
                      </a>
                    )}
                    {l.manhattan_commute_minutes != null && (
                      <span>{l.manhattan_commute_minutes} min to Manhattan</span>
                    )}
                  </div>
                )}
                {l.subway_estimates && l.subway_estimates.length > 1 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-3 text-xs text-zinc-500">
                    {l.subway_estimates.slice(1, 3).map((e) => (
                      <span key={e.station_id}>
                        {e.station_name} ({e.lines}) ~{e.estimated_walk_minutes} min
                      </span>
                    ))}
                  </div>
                )}

                {(l.available_date || l.laundry) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-sm text-zinc-400">
                    {l.available_date && <span>Available {l.available_date}</span>}
                    {l.laundry && <span>{l.laundry}</span>}
                  </div>
                )}

                {l.description && (
                  <p className="text-sm text-zinc-400 mb-3 line-clamp-3">
                    {l.description}
                  </p>
                )}

                {l.amenities && l.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {l.amenities.slice(0, 6).map((a) => (
                      <span key={a} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                        {a}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-4 text-xs pt-3 border-t border-zinc-800">
                  <span>
                    Fit{" "}
                    <span className={`font-bold ${scoreColor(l.fit_score)}`}>
                      {l.fit_score}
                    </span>
                  </span>
                  <span>
                    Deal{" "}
                    <span className={`font-bold ${scoreColor(l.deal_score)}`}>
                      {l.deal_score}
                    </span>
                  </span>
                  <span>
                    Risk{" "}
                    <span className={`font-bold ${riskColor(l.risk_score)}`}>
                      {l.risk_score}
                    </span>
                  </span>
                </div>

                <ListingRatingControls listingId={l.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
