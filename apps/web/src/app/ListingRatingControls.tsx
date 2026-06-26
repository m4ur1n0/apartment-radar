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
    return <p className="text-xs text-zinc-500 pt-2">Rating saved.</p>;
  }

  return (
    <div className="pt-3 border-t border-zinc-800 flex flex-wrap items-center gap-3 text-xs">
      <select
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        className="bg-zinc-800 border border-zinc-700 px-2 py-1 rounded text-zinc-300"
      >
        <option value="Theo">Theo</option>
        <option value="Sam">Sam</option>
      </select>

      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setRating(n)}
            className={`w-6 h-6 rounded border text-xs font-medium transition-colors ${
              rating === n
                ? "bg-blue-500 border-blue-500 text-white"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="bg-zinc-800 border border-zinc-700 px-2 py-1 rounded text-zinc-300 placeholder:text-zinc-600 flex-1 min-w-0"
      />

      <button
        onClick={submit}
        disabled={!rating || status === "loading"}
        className="border border-zinc-600 px-3 py-1 rounded text-zinc-300 disabled:opacity-40 hover:border-zinc-400 transition-colors"
      >
        {status === "loading" ? "..." : "Rate"}
      </button>

      {status === "error" && <span className="text-red-500">failed</span>}
    </div>
  );
}
