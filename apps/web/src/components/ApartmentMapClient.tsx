"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

export type ListingMapPoint = {
  id: string;
  title?: string;
  address?: string;
  price?: number;
  latitude: number;
  longitude: number;
  neighborhood?: string;
};

export type SubwayStationPoint = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines?: string[];
};

export type ApartmentMapProps = {
  listings: ListingMapPoint[];
  subwayStations: SubwayStationPoint[];
  focusedListingId?: string;
  mode: "listing-detail" | "all-listings";
  onListingClick?: (listingId: string) => void;
  className?: string;
};

function listingIcon(focused: boolean) {
  return L.divIcon({
    html: `<div style="
      width: 14px; height: 14px;
      background: ${focused ? "#5c6e52" : "#1c1917"};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
    "></div>`,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    tooltipAnchor: [7, 0],
  });
}

function stationIcon() {
  return L.divIcon({
    html: `<div style="
      width: 20px; height: 20px;
      background: #e04686;
      border: 1.5px solid rgba(255,255,255,0.8);
      border-radius: 50%;
      opacity: 0.85;
    "></div>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    tooltipAnchor: [10, 0],
  });
}

export default function ApartmentMapClient({
  listings,
  subwayStations,
  focusedListingId,
  mode,
  onListingClick,
  className = "",
}: ApartmentMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // update markers whenever data or focus changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // clear existing layers except tile
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
    });

    for (const l of listings) {
      const focused = l.id === focusedListingId;
      const marker = L.marker([l.latitude, l.longitude], {
        icon: listingIcon(focused),
        zIndexOffset: focused ? 1000 : 0,
      });

      const priceLabel = l.price ? `$${l.price.toLocaleString()}/mo` : "";
      const tooltipParts = [priceLabel, l.address ?? l.title, l.neighborhood]
        .filter(Boolean)
        .join("<br>");

      marker.bindTooltip(tooltipParts || "listing", {
        direction: "top",
        offset: [0, -4],
        className: "apt-map-tooltip",
      });

      if (onListingClick) {
        marker.on("click", () => onListingClick(l.id));
      }

      marker.addTo(map);

      if (onListingClick) {
        const el = marker.getElement();
        if (el) el.style.cursor = "pointer";
      }

    }

    for (const s of subwayStations) {
      const marker = L.marker([s.latitude, s.longitude], {
        icon: stationIcon(),
      });

      const linesLabel = s.lines && s.lines.length > 0 ? s.lines.join(" / ") : "";
      const tip = linesLabel ? `${s.name}<br><span style="color:#888">${linesLabel}</span>` : s.name;

      marker.bindTooltip(tip, {
        direction: "top",
        offset: [0, -2],
        className: "apt-map-tooltip",
      });

      marker.addTo(map);
    }

    // fit bounds
    if (listings.length === 1) {
      map.setView([listings[0].latitude, listings[0].longitude], mode === "listing-detail" ? 15 : 14);
    } else if (listings.length > 1) {
      const bounds = L.latLngBounds(listings.map((l) => [l.latitude, l.longitude]));
      map.fitBounds(bounds, { padding: [32, 32] });
    } else if (subwayStations.length > 0) {
      // no listings but stations exist
      const bounds = L.latLngBounds(subwayStations.map((s) => [s.latitude, s.longitude]));
      map.fitBounds(bounds, { padding: [32, 32] });
    }
  }, [listings, subwayStations, focusedListingId, mode, onListingClick]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ background: "#e8e0d8" }}
    />
  );
}
