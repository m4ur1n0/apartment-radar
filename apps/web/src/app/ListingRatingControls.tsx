"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "success" | "error";

export default function ListingRatingControls({ listingId }: { listingId: string }) {
  const [userName, setUserName] = useState("Theo");
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function submit() {
    if (!rating) return;
    setStatus("loading");
    try {
      const res = await fetch(`/api/listings/${listingId}/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: userName, rating, notes: notes || undefined }),
      });
      setStatus(res.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="flex items-center gap-2.5 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shrink-0" />
        <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-400">Rating saved</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        className="border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 focus:outline-none focus:border-stone-600 transition-colors duration-150"
      >
        <option value="Theo">Theo</option>
        <option value="Sam">Sam</option>
      </select>

      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setRating(n)}
            className={`w-7 h-7 font-mono text-[11px] border transition-colors duration-150 ${
              rating === n
                ? "bg-stone-900 border-stone-900 text-white"
                : "border-stone-300 text-stone-500 hover:border-stone-600 hover:text-stone-800"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-300 flex-1 min-w-28 focus:outline-none focus:border-stone-600 transition-colors duration-150"
      />

      <button
        onClick={submit}
        disabled={!rating || status === "loading"}
        className="font-mono text-[11px] uppercase tracking-[0.07em] bg-stone-900 text-white px-4 py-1.5 hover:bg-stone-800 disabled:opacity-40 transition-colors duration-150"
      >
        {status === "loading" ? "..." : "Rate"}
      </button>

      {status === "error" && (
        <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-red-400">Failed</span>
      )}
    </div>
  );
}
