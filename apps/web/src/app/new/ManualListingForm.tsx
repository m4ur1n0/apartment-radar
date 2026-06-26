"use client";

import { useState } from "react";
import Link from "next/link";

type FetchStatus = "idle" | "fetching" | "done" | "error";
type SaveStatus = "idle" | "saving" | "success" | "error";
type FetchMode = "direct" | "scraperapi";

type ExtractedFields = {
  canonical_url?: string;
  source?: string;
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
  pets?: string;
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
  };
};

type FormValues = {
  canonical_url: string;
  source: string;
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
};

const EMPTY: FormValues = {
  canonical_url: "",
  source: "manual",
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
};

function applyPreview(prev: FormValues, fields: ExtractedFields, importUrl: string): FormValues {
  return {
    ...prev,
    canonical_url: fields.canonical_url ?? importUrl,
    source: fields.source ?? prev.source,
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
  };
}

export default function ManualListingForm() {
  const [importUrl, setImportUrl] = useState("");
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [activeFetchMode, setActiveFetchMode] = useState<FetchMode>("direct");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fetchError, setFetchError] = useState("");

  const [values, setValues] = useState<FormValues>(EMPTY);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");

  function set(k: keyof FormValues) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues((prev) => ({ ...prev, [k]: e.target.value }));
    };
  }

  function setCheck(k: keyof FormValues) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setValues((prev) => ({ ...prev, [k]: e.target.checked }));
    };
  }

  async function handleFetch(fetchMode: FetchMode) {
    if (!importUrl) return;
    setActiveFetchMode(fetchMode);
    setFetchStatus("fetching");
    setFetchError("");
    setPreview(null);
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

    try {
      const res = await fetch("/api/listings/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaveStatus("success");
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

  if (saveStatus === "success") {
    return (
      <div className="p-4">
        <p className="mb-2">Listing created.</p>
        <Link href="/" className="text-blue-600 underline">Back to listings</Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl p-4">
      <h1 className="text-lg font-semibold mb-4">Add listing</h1>

      {/* url fetch section */}
      <div className="mb-4 flex flex-col gap-2">
        <label className="text-sm font-medium">Paste listing URL to autofill</label>
        <div className="flex gap-2 flex-wrap">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://streeteasy.com/..."
            className="border px-2 py-1 text-sm flex-1"
          />
          <button
            type="button"
            onClick={() => handleFetch("direct")}
            disabled={!importUrl || fetchStatus === "fetching"}
            className="border px-3 py-1 text-sm disabled:opacity-50"
          >
            {fetchStatus === "fetching" && activeFetchMode === "direct" ? "Fetching..." : "Fetch details"}
          </button>
          <button
            type="button"
            onClick={() => handleFetch("scraperapi")}
            disabled={!importUrl || fetchStatus === "fetching"}
            className="border px-3 py-1 text-sm disabled:opacity-50"
          >
            {fetchStatus === "fetching" && activeFetchMode === "scraperapi" ? "Fetching..." : "Try ScraperAPI test"}
          </button>
        </div>

        {fetchStatus === "error" && (
          <p className="text-red-600 text-xs">{fetchError}</p>
        )}

        {preview && (
          <div className="text-xs text-zinc-500 border-l-2 border-zinc-300 pl-2 flex flex-col gap-0.5">
            <span>
              Source: {preview.source} &middot; Confidence: {preview.confidence}
              {preview.fetchMode === "scraperapi" && (
                <span className="ml-2 text-blue-600">[temporary scraperapi preview used]</span>
              )}
            </span>
            {preview.warnings.length > 0 && (
              <span className="text-amber-600">{preview.warnings.join(", ")}</span>
            )}
            {preview.debug && (
              <span className="text-zinc-400">
                http {preview.debug.httpStatus} &middot; {preview.debug.htmlCharsParsed?.toLocaleString()} chars &middot; {preview.debug.extractorsUsed?.join(", ")}
              </span>
            )}
          </div>
        )}
      </div>

      <hr className="mb-4" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {saveStatus === "error" && (
          <p className="text-red-600 text-sm">{saveError}</p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          URL *
          <input
            type="url"
            value={values.canonical_url}
            onChange={set("canonical_url")}
            required
            className="border px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Source
          <input
            type="text"
            value={values.source}
            onChange={set("source")}
            className="border px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Title
          <input type="text" value={values.title} onChange={set("title")} className="border px-2 py-1" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea
            value={values.description}
            onChange={set("description")}
            rows={3}
            className="border px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Address
          <input type="text" value={values.address_text} onChange={set("address_text")} className="border px-2 py-1" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Neighborhood
          <input type="text" value={values.neighborhood} onChange={set("neighborhood")} className="border px-2 py-1" />
        </label>

        <div className="flex gap-3">
          <label className="flex flex-col gap-1 text-sm flex-1">
            Rent ($/mo) *
            <input
              type="number"
              value={values.rent}
              onChange={set("rent")}
              required
              min={1}
              className="border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            Beds *
            <input
              type="number"
              value={values.beds}
              onChange={set("beds")}
              required
              step="0.5"
              min={0.5}
              className="border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            Baths *
            <input
              type="number"
              value={values.baths}
              onChange={set("baths")}
              required
              step="0.5"
              min={0.5}
              className="border px-2 py-1"
            />
          </label>
        </div>

        <div className="flex gap-3">
          <label className="flex flex-col gap-1 text-sm flex-1">
            Sqft
            <input type="number" value={values.sqft} onChange={set("sqft")} min={1} className="border px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            Available date
            <input type="date" value={values.available_date} onChange={set("available_date")} className="border px-2 py-1" />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Nearest subway station
          <input type="text" value={values.nearest_subway_station} onChange={set("nearest_subway_station")} className="border px-2 py-1" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Subway lines (e.g. L, M)
          <input type="text" value={values.nearest_subway_lines} onChange={set("nearest_subway_lines")} className="border px-2 py-1" />
        </label>

        <div className="flex gap-3">
          <label className="flex flex-col gap-1 text-sm flex-1">
            Walk to subway (min)
            <input type="number" value={values.subway_walk_minutes} onChange={set("subway_walk_minutes")} min={0} className="border px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            Commute to Manhattan (min)
            <input type="number" value={values.manhattan_commute_minutes} onChange={set("manhattan_commute_minutes")} min={0} className="border px-2 py-1" />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Fee status (e.g. no fee, broker fee)
          <input type="text" value={values.fee_status} onChange={set("fee_status")} className="border px-2 py-1" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Laundry (e.g. in-unit, in building)
          <input type="text" value={values.laundry} onChange={set("laundry")} className="border px-2 py-1" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Pets
          <input type="text" value={values.pets} onChange={set("pets")} className="border px-2 py-1" />
        </label>

        <label className="flex flex-col gap-1 text-sm w-32">
          Floor #
          <input type="number" value={values.floor_number} onChange={set("floor_number")} className="border px-2 py-1" />
        </label>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={values.dishwasher} onChange={setCheck("dishwasher")} />
            Dishwasher
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={values.outdoor_space} onChange={setCheck("outdoor_space")} />
            Outdoor space
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={values.elevator} onChange={setCheck("elevator")} />
            Elevator
          </label>
        </div>

        <button
          type="submit"
          disabled={saveStatus === "saving"}
          className="self-start border px-4 py-1.5 text-sm disabled:opacity-50"
        >
          {saveStatus === "saving" ? "Saving..." : "Add listing"}
        </button>
      </form>
    </div>
  );
}
