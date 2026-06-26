"use client";

import { useState } from "react";
import Link from "next/link";

type Status = "idle" | "loading" | "success" | "error";

function num(v: string) {
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

export default function ManualListingForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      canonical_url: fd.get("canonical_url"),
      source: fd.get("source") || "manual",
    };

    const optStr = (k: string) => { const v = fd.get(k); if (v) body[k] = v; };
    const optNum = (k: string) => { const v = num(fd.get(k) as string); if (v !== undefined) body[k] = v; };
    const optBool = (k: string) => { body[k] = fd.get(k) === "on"; };

    optStr("title");
    optStr("description");
    optStr("address_text");
    optStr("neighborhood");
    optStr("available_date");
    optStr("nearest_subway_station");
    optStr("nearest_subway_lines");
    optStr("fee_status");
    optStr("laundry");
    optStr("pets");

    optNum("rent");
    optNum("beds");
    optNum("baths");
    optNum("sqft");
    optNum("subway_walk_minutes");
    optNum("manhattan_commute_minutes");
    optNum("floor_number");

    optBool("dishwasher");
    optBool("outdoor_space");
    optBool("elevator");

    try {
      const res = await fetch("/api/listings/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setStatus("success");
      } else {
        const data = await res.json() as { error?: string };
        setErrorMsg(data.error ?? "unknown error");
        setStatus("error");
      }
    } catch {
      setErrorMsg("network error");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="p-4">
        <p className="mb-2">Listing created.</p>
        <Link href="/" className="text-blue-600 underline">Back to listings</Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-xl p-4">
      <h1 className="text-lg font-semibold">Add listing</h1>

      {status === "error" && (
        <p className="text-red-600 text-sm">{errorMsg}</p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        URL *
        <input name="canonical_url" type="url" required className="border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Source
        <input name="source" type="text" defaultValue="manual" className="border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Title
        <input name="title" type="text" className="border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea name="description" rows={3} className="border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Address
        <input name="address_text" type="text" className="border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Neighborhood
        <input name="neighborhood" type="text" className="border px-2 py-1" />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-col gap-1 text-sm flex-1">
          Rent ($/mo) *
          <input name="rent" type="number" required min={1} className="border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm flex-1">
          Beds *
          <input name="beds" type="number" required step="0.5" min={0.5} className="border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm flex-1">
          Baths *
          <input name="baths" type="number" required step="0.5" min={0.5} className="border px-2 py-1" />
        </label>
      </div>

      <div className="flex gap-3">
        <label className="flex flex-col gap-1 text-sm flex-1">
          Sqft
          <input name="sqft" type="number" min={1} className="border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm flex-1">
          Available date
          <input name="available_date" type="date" className="border px-2 py-1" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Nearest subway station
        <input name="nearest_subway_station" type="text" className="border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Subway lines (e.g. L, M)
        <input name="nearest_subway_lines" type="text" className="border px-2 py-1" />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-col gap-1 text-sm flex-1">
          Walk to subway (min)
          <input name="subway_walk_minutes" type="number" min={0} className="border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm flex-1">
          Commute to Manhattan (min)
          <input name="manhattan_commute_minutes" type="number" min={0} className="border px-2 py-1" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Fee status (e.g. no fee, broker fee)
        <input name="fee_status" type="text" className="border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Laundry (e.g. in unit, in building)
        <input name="laundry" type="text" className="border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Pets
        <input name="pets" type="text" className="border px-2 py-1" />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-col gap-1 text-sm flex-1">
          Floor #
          <input name="floor_number" type="number" className="border px-2 py-1" />
        </label>
      </div>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input name="dishwasher" type="checkbox" />
          Dishwasher
        </label>
        <label className="flex items-center gap-2">
          <input name="outdoor_space" type="checkbox" />
          Outdoor space
        </label>
        <label className="flex items-center gap-2">
          <input name="elevator" type="checkbox" />
          Elevator
        </label>
      </div>

      <button
        type="submit"
        disabled={status === "loading"}
        className="self-start border px-4 py-1.5 text-sm disabled:opacity-50"
      >
        {status === "loading" ? "Saving..." : "Add listing"}
      </button>
    </form>
  );
}
