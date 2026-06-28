"use client";

import { useState, useEffect } from "react";

type FetchStatus = "idle" | "fetching" | "done" | "error";
type SaveStatus = "idle" | "saving" | "error";
type FetchMode = "direct" | "scraperapi";

type ExtractedFields = {
  canonical_url?: string;
  source?: string;
  source_listing_id?: string;
  title?: string;
  description?: string;
  address_text?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  rent?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  available_date?: string;
  nearest_subway_station?: string;
  nearest_subway_lines?: string;
  subway_walk_minutes?: number;
  subway_walk_source?: string;
  subway_walk_confidence?: string;
  google_maps_directions_url?: string;
  fee_status?: string;
  laundry?: string;
  dishwasher?: boolean;
  outdoor_space?: boolean;
  elevator?: boolean;
  pets?: string;
  amenities?: string[];
  image_urls?: string[];
};

type ImportPreview = {
  source: string;
  confidence: string;
  fetchMode?: FetchMode;
  fields: ExtractedFields;
  warnings: string[];
  debug?: {
    httpStatus?: number;
    htmlCharsParsed?: number;
    extractorsUsed?: string[];
    imageCandidatesFound?: number;
    imageUrlsReturned?: number;
  };
};

type FormValues = {
  canonical_url: string;
  source: string;
  source_listing_id: string;
  title: string;
  description: string;
  address_text: string;
  neighborhood: string;
  rent: string;
  beds: string;
  baths: string;
  sqft: string;
  available_date: string;
  nearest_subway_station: string;
  nearest_subway_lines: string;
  subway_walk_minutes: string;
  manhattan_commute_minutes: string;
  fee_status: string;
  laundry: string;
  pets: string;
  floor_number: string;
  dishwasher: boolean;
  outdoor_space: boolean;
  elevator: boolean;
  amenities: string[];
};

const EMPTY: FormValues = {
  canonical_url: "",
  source: "manual",
  source_listing_id: "",
  title: "",
  description: "",
  address_text: "",
  neighborhood: "",
  rent: "",
  beds: "",
  baths: "",
  sqft: "",
  available_date: "",
  nearest_subway_station: "",
  nearest_subway_lines: "",
  subway_walk_minutes: "",
  manhattan_commute_minutes: "",
  fee_status: "",
  laundry: "",
  pets: "",
  floor_number: "",
  dishwasher: false,
  outdoor_space: false,
  elevator: false,
  amenities: [],
};

function applyPreview(prev: FormValues, fields: ExtractedFields, importUrl: string): FormValues {
  return {
    ...prev,
    canonical_url: fields.canonical_url ?? importUrl,
    source: fields.source ?? prev.source,
    ...(fields.source_listing_id != null && { source_listing_id: fields.source_listing_id }),
    ...(fields.title != null && { title: fields.title }),
    ...(fields.description != null && { description: fields.description }),
    ...(fields.address_text != null && { address_text: fields.address_text }),
    ...(fields.neighborhood != null && { neighborhood: fields.neighborhood }),
    ...(fields.rent != null && { rent: String(fields.rent) }),
    ...(fields.beds != null && { beds: String(fields.beds) }),
    ...(fields.baths != null && { baths: String(fields.baths) }),
    ...(fields.sqft != null && { sqft: String(fields.sqft) }),
    ...(fields.available_date != null && { available_date: fields.available_date }),
    ...(fields.nearest_subway_station != null && { nearest_subway_station: fields.nearest_subway_station }),
    ...(fields.nearest_subway_lines != null && { nearest_subway_lines: fields.nearest_subway_lines }),
    ...(fields.subway_walk_minutes != null && { subway_walk_minutes: String(fields.subway_walk_minutes) }),
    ...(fields.fee_status != null && { fee_status: fields.fee_status }),
    ...(fields.laundry != null && { laundry: fields.laundry }),
    ...(fields.pets != null && { pets: fields.pets }),
    ...(fields.dishwasher != null && { dishwasher: fields.dishwasher }),
    ...(fields.outdoor_space != null && { outdoor_space: fields.outdoor_space }),
    ...(fields.elevator != null && { elevator: fields.elevator }),
    ...(fields.amenities?.length && { amenities: fields.amenities }),
  };
}

function SectionRule({ label }: { label: string }) {
  return (
    <div className="relative border-t border-stone-200 mb-5 mt-8">
      <span className="absolute top-[-0.55rem] left-0 font-mono text-[9px] uppercase tracking-[0.14em] text-stone-400 bg-white pr-3">
        {label}
      </span>
    </div>
  );
}

const inputCls =
  "border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:outline-none focus:border-stone-600 transition-colors duration-150 w-full";

type Props = {
  onClose: () => void;
  onSuccess: () => void;
};

export default function ListingImportDialog({ onClose, onSuccess }: Props) {
  const [importUrl, setImportUrl] = useState("");
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [activeFetchMode, setActiveFetchMode] = useState<FetchMode>("direct");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [previewImageUrls, setPreviewImageUrls] = useState<string[]>([]);

  const [values, setValues] = useState<FormValues>(EMPTY);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setField(k: keyof FormValues) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((prev) => ({ ...prev, [k]: e.target.value }));
  }

  function setCheck(k: keyof FormValues) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setValues((prev) => ({ ...prev, [k]: e.target.checked }));
  }

  async function handleFetch(fetchMode: FetchMode) {
    if (!importUrl) return;
    setActiveFetchMode(fetchMode);
    setFetchStatus("fetching");
    setFetchError("");
    setPreview(null);
    setPreviewImageUrls([]);
    try {
      const res = await fetch("/api/listings/import-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl, fetchMode }),
      });
      const data = (await res.json()) as ImportPreview & { error?: string };
      if (!res.ok || data.error) {
        setFetchError(data.error ?? "fetch failed");
        setFetchStatus("error");
        return;
      }
      setPreview(data);
      setValues((prev) => applyPreview(prev, data.fields, importUrl));
      setPreviewImageUrls(data.fields.image_urls ?? []);
      setFetchStatus("done");
    } catch {
      setFetchError("network error");
      setFetchStatus("error");
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveStatus("saving");
    setSaveError("");

    const n = (v: string) => { const p = parseFloat(v); return isNaN(p) ? undefined : p; };

    const body: Record<string, unknown> = {
      canonical_url: values.canonical_url,
      source: values.source || "manual",
    };

    if (values.title) body.title = values.title;
    if (values.description) body.description = values.description;
    if (values.address_text) body.address_text = values.address_text;
    if (values.neighborhood) body.neighborhood = values.neighborhood;
    if (values.available_date) body.available_date = values.available_date;
    if (values.nearest_subway_station) body.nearest_subway_station = values.nearest_subway_station;
    if (values.nearest_subway_lines) body.nearest_subway_lines = values.nearest_subway_lines;
    if (values.fee_status) body.fee_status = values.fee_status;
    if (values.laundry) body.laundry = values.laundry;
    if (values.pets) body.pets = values.pets;
    if (values.source_listing_id) body.source_listing_id = values.source_listing_id;

    const rent = n(values.rent);
    const beds = n(values.beds);
    const baths = n(values.baths);
    if (rent != null) body.rent = rent;
    if (beds != null) body.beds = beds;
    if (baths != null) body.baths = baths;
    const sqft = n(values.sqft);
    if (sqft != null) body.sqft = sqft;
    const swm = n(values.subway_walk_minutes);
    if (swm != null) body.subway_walk_minutes = swm;
    const mcm = n(values.manhattan_commute_minutes);
    if (mcm != null) body.manhattan_commute_minutes = mcm;
    const fn = n(values.floor_number);
    if (fn != null) body.floor_number = fn;

    body.dishwasher = values.dishwasher;
    body.outdoor_space = values.outdoor_space;
    body.elevator = values.elevator;
    if (values.amenities.length > 0) body.amenities = values.amenities;
    if (previewImageUrls.length > 0) body.image_urls = previewImageUrls;

    try {
      const res = await fetch("/api/listings/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const data = (await res.json()) as { error?: string };
        setSaveError(data.error ?? "unknown error");
        setSaveStatus("error");
      }
    } catch {
      setSaveError("network error");
      setSaveStatus("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8 anim-fade-in"
      style={{ background: "rgba(28, 25, 23, 0.5)" }}
      onClick={onClose}
    >
      <div
        className="relative bg-white w-full max-w-2xl my-4"
        style={{ animation: "fadeInUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) both" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import listing"
      >
        {/* corner ticks */}
        <div className="absolute -top-5 -left-5 w-6 h-6 border-t border-l border-stone-300 pointer-events-none" aria-hidden />
        <div className="absolute -bottom-5 -right-5 w-6 h-6 border-b border-r border-stone-300 pointer-events-none" aria-hidden />

        <div className="p-6">
          {/* header */}
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-lg text-stone-900 leading-none"
              style={{ fontFamily: "var(--font-chonburi, serif)", fontWeight: 400 }}
            >
              import listing
            </h2>
            <button
              onClick={onClose}
              className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400 hover:text-stone-700 transition-colors duration-150"
            >
              ✕ close
            </button>
          </div>

          {/* url import */}
          <div className="mb-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-stone-400 mb-2">
              Paste a listing URL to autofill
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://streeteasy.com/..."
                className="border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:outline-none focus:border-stone-600 transition-colors duration-150 flex-1 min-w-0"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleFetch("direct"); } }}
              />
              <button
                type="button"
                onClick={() => handleFetch("direct")}
                disabled={!importUrl || fetchStatus === "fetching"}
                className="font-mono text-[11px] uppercase tracking-[0.07em] bg-stone-900 text-white px-4 py-2 hover:bg-stone-800 disabled:opacity-40 transition-colors duration-150 shrink-0"
              >
                {fetchStatus === "fetching" && activeFetchMode === "direct" ? "..." : "Fetch"}
              </button>
              <button
                type="button"
                onClick={() => handleFetch("scraperapi")}
                disabled={!importUrl || fetchStatus === "fetching"}
                className="font-mono text-[11px] uppercase tracking-[0.07em] border border-stone-300 text-stone-600 px-4 py-2 hover:bg-stone-100 disabled:opacity-40 transition-colors duration-150 shrink-0"
              >
                {fetchStatus === "fetching" && activeFetchMode === "scraperapi" ? "..." : "ScraperAPI"}
              </button>
            </div>

            {fetchStatus === "error" && (
              <div className="mt-2 border-l-2 border-red-400 bg-red-50/50 pl-3 pr-3 py-2">
                <p className="font-mono text-[9px] uppercase tracking-[0.07em] text-red-500">{fetchError}</p>
              </div>
            )}

            {preview && (
              <div className="mt-3 border-l-2 border-stone-200 pl-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${preview.confidence === "high" ? "bg-emerald-300" : preview.confidence === "medium" ? "bg-amber-300" : "bg-stone-300"}`} />
                    <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-400">
                      {preview.source} · {preview.confidence} confidence
                    </span>
                  </div>
                  {preview.fetchMode === "scraperapi" && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-[var(--color-sage-text)]">scraperapi</span>
                  )}
                </div>
                {preview.warnings.length > 0 && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-amber-500">{preview.warnings.join(" · ")}</span>
                )}
                {preview.debug && (
                  <span className="font-mono text-[9px] text-stone-300">
                    http {preview.debug.httpStatus} · {preview.debug.htmlCharsParsed?.toLocaleString()} chars
                    {preview.debug.imageCandidatesFound != null ? ` · ${preview.debug.imageUrlsReturned ?? 0} images` : ""}
                  </span>
                )}
                {previewImageUrls.length > 0 && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <img
                      src={previewImageUrls[0]}
                      alt=""
                      className="w-14 h-14 object-cover shrink-0 border border-stone-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      referrerPolicy="no-referrer"
                    />
                    <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-400">
                      {previewImageUrls.length} image{previewImageUrls.length !== 1 ? "s" : ""} found
                    </span>
                  </div>
                )}
                {preview.fields.amenities && preview.fields.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {preview.fields.amenities.slice(0, 8).map((a) => (
                      <span key={a} className="font-mono text-[9px] uppercase tracking-[0.07em] text-stone-400 border border-stone-200 px-1.5 py-0.5">
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* form */}
          <form onSubmit={handleSubmit}>
            <SectionRule label="listing details" />

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">URL *</span>
                <input type="url" value={values.canonical_url} onChange={setField("canonical_url")} required className={inputCls} />
              </label>

              <div className="flex gap-3">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Source</span>
                  <input type="text" value={values.source} onChange={setField("source")} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Source ID</span>
                  <input type="text" value={values.source_listing_id} onChange={setField("source_listing_id")} className={inputCls} />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Title</span>
                <input type="text" value={values.title} onChange={setField("title")} className={inputCls} />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Description</span>
                <textarea value={values.description} onChange={setField("description")} rows={3} className={inputCls + " resize-y"} />
              </label>
            </div>

            <SectionRule label="location" />

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Address</span>
                <input type="text" value={values.address_text} onChange={setField("address_text")} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Neighborhood</span>
                <input type="text" value={values.neighborhood} onChange={setField("neighborhood")} className={inputCls} />
              </label>
            </div>

            <SectionRule label="pricing" />

            <div className="flex gap-3">
              <label className="flex flex-col gap-1 flex-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Rent ($/mo) *</span>
                <input type="number" value={values.rent} onChange={setField("rent")} required min={1} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Beds *</span>
                <input type="number" value={values.beds} onChange={setField("beds")} required step="0.5" min={0.5} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Baths *</span>
                <input type="number" value={values.baths} onChange={setField("baths")} required step="0.5" min={0.5} className={inputCls} />
              </label>
            </div>
            <div className="flex gap-3 mt-3">
              <label className="flex flex-col gap-1 flex-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Sqft</span>
                <input type="number" value={values.sqft} onChange={setField("sqft")} min={1} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Available</span>
                <input type="date" value={values.available_date} onChange={setField("available_date")} className={inputCls} />
              </label>
            </div>

            <SectionRule label="transit" />

            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Nearest station</span>
                  <input type="text" value={values.nearest_subway_station} onChange={setField("nearest_subway_station")} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 w-32">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Lines</span>
                  <input type="text" value={values.nearest_subway_lines} onChange={setField("nearest_subway_lines")} placeholder="L, M" className={inputCls} />
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Walk (min)</span>
                  <input type="number" value={values.subway_walk_minutes} onChange={setField("subway_walk_minutes")} min={0} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Commute to Manhattan (min)</span>
                  <input type="number" value={values.manhattan_commute_minutes} onChange={setField("manhattan_commute_minutes")} min={0} className={inputCls} />
                </label>
              </div>
            </div>

            <SectionRule label="details" />

            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Fee status</span>
                  <input type="text" value={values.fee_status} onChange={setField("fee_status")} placeholder="no fee, broker fee…" className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Laundry</span>
                  <input type="text" value={values.laundry} onChange={setField("laundry")} placeholder="in-unit, in building…" className={inputCls} />
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Pets</span>
                  <input type="text" value={values.pets} onChange={setField("pets")} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 w-24">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">Floor #</span>
                  <input type="number" value={values.floor_number} onChange={setField("floor_number")} className={inputCls} />
                </label>
              </div>
              <div className="flex gap-6 pt-1">
                {(["dishwasher", "outdoor_space", "elevator"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={values[k] as boolean}
                      onChange={setCheck(k)}
                      className="border border-stone-300 w-4 h-4 accent-stone-900"
                    />
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-500">
                      {k === "outdoor_space" ? "Outdoor" : k.charAt(0).toUpperCase() + k.slice(1)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* save */}
            <div className="mt-8 pt-5 border-t border-stone-200">
              {saveStatus === "error" && (
                <div className="mb-3 border-l-2 border-red-400 bg-red-50/50 pl-3 pr-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.07em] text-red-500">{saveError}</p>
                </div>
              )}
              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={saveStatus === "saving"}
                  className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.07em] bg-stone-900 text-white px-6 py-2.5 hover:bg-stone-800 disabled:opacity-40 transition-colors duration-150"
                >
                  {saveStatus === "saving" ? "Saving..." : "Save listing"}
                  {saveStatus !== "saving" && <span className="opacity-60">→</span>}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="font-mono text-[11px] uppercase tracking-[0.07em] border border-stone-300 text-stone-600 px-5 py-2.5 hover:bg-stone-100 transition-colors duration-150"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
