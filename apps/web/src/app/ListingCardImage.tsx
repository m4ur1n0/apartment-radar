"use client";

import { useState } from "react";

export default function ListingCardImage({ url, alt }: { url: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={url}
      alt={alt ?? "listing photo"}
      onError={() => setFailed(true)}
      className="w-20 h-20 object-cover rounded shrink-0"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
