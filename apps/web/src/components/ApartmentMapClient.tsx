"use client";

import React, { useEffect, useRef, useCallback } from "react";
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

export type DrawnPolygon = [number, number][]; // [lat, lng] pairs

export type ApartmentMapProps = {
  listings: ListingMapPoint[];
  subwayStations: SubwayStationPoint[];
  focusedListingId?: string;
  mode: "listing-detail" | "all-listings";
  onListingClick?: (listingId: string) => void;
  className?: string;
  drawMode?: boolean;
  drawnPolygon?: DrawnPolygon | null;
  onDrawComplete?: (polygon: DrawnPolygon) => void;
  highlightedIds?: Set<string>;
};

type SelectionState = null | "inside" | "outside";

function listingIcon(focused: boolean, selection: SelectionState) {
  const size = selection === "outside" ? 10 : 14;
  const bg =
    focused ? "#5c6e52"
    : selection === "inside" ? "#2d6a4f"
    : selection === "outside" ? "rgba(80,80,80,0.25)"
    : "#1c1917";
  const border = selection === "outside" ? "rgba(120,120,120,0.3)" : "white";
  const shadow = selection === "outside" ? "none" : "0 1px 3px rgba(0,0,0,0.4)";
  const anchor = size / 2;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${bg};border:2px solid ${border};border-radius:50%;box-shadow:${shadow};"></div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
    tooltipAnchor: [anchor, 0],
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
  drawMode = false,
  drawnPolygon,
  onDrawComplete,
  highlightedIds,
}: ApartmentMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const selectionPolygonRef = useRef<L.Polygon | null>(null);

  // Drawing refs — avoid re-renders during rapid pointer moves
  const isDrawingRef = useRef(false);
  const pixelPointsRef = useRef<{ x: number; y: number }[]>([]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
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

  // Keep canvas sized to its CSS box
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Disable/enable map interaction while drawing
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawMode) {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.doubleClickZoom.disable();
      map.touchZoom.disable();
    } else {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoom.enable();
    }
  }, [drawMode]);

  // Clear canvas + reset drawing state when draw mode exits
  useEffect(() => {
    if (!drawMode) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      pixelPointsRef.current = [];
      isDrawingRef.current = false;
    }
  }, [drawMode]);

  // Add/remove the committed selection polygon on the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectionPolygonRef.current) {
      selectionPolygonRef.current.remove();
      selectionPolygonRef.current = null;
    }

    if (drawnPolygon && drawnPolygon.length >= 3) {
      selectionPolygonRef.current = L.polygon(drawnPolygon, {
        color: "#5c6e52",
        fillColor: "#5c6e52",
        fillOpacity: 0.08,
        weight: 2,
        dashArray: "7, 5",
        interactive: false,
      }).addTo(map);
    }
  }, [drawnPolygon]);

  // Re-render markers when data, focus, or highlight set changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.eachLayer((layer: L.Layer) => {
      if (!(layer instanceof L.TileLayer) && layer !== selectionPolygonRef.current) {
        map.removeLayer(layer);
      }
    });

    const hasSelection = !!highlightedIds;

    for (const l of listings) {
      const focused = l.id === focusedListingId;
      let selection: SelectionState = null;
      if (hasSelection) {
        selection = highlightedIds!.has(l.id) ? "inside" : "outside";
      }

      const marker = L.marker([l.latitude, l.longitude], {
        icon: listingIcon(focused, selection),
        zIndexOffset: focused ? 1000 : selection === "inside" ? 500 : 0,
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
        marker.on("add", () => {
          const el = marker.getElement();
          if (el) el.style.cursor = "pointer";
        });
      }

      marker.addTo(map);
    }

    for (const s of subwayStations) {
      const marker = L.marker([s.latitude, s.longitude], { icon: stationIcon() });
      const linesLabel = s.lines && s.lines.length > 0 ? s.lines.join(" / ") : "";
      const tip = linesLabel
        ? `${s.name}<br><span style="color:#888">${linesLabel}</span>`
        : s.name;
      marker.bindTooltip(tip, { direction: "top", offset: [0, -2], className: "apt-map-tooltip" });
      marker.addTo(map);
    }

    if (listings.length === 1) {
      map.setView([listings[0].latitude, listings[0].longitude], mode === "listing-detail" ? 15 : 14);
    } else if (listings.length > 1) {
      const bounds = L.latLngBounds(listings.map((l) => [l.latitude, l.longitude]));
      map.fitBounds(bounds, { padding: [32, 32] });
    } else if (subwayStations.length > 0) {
      const bounds = L.latLngBounds(subwayStations.map((s) => [s.latitude, s.longitude]));
      map.fitBounds(bounds, { padding: [32, 32] });
    }
  }, [listings, subwayStations, focusedListingId, mode, onListingClick, highlightedIds]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pts = pixelPointsRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    ctx.fillStyle = "rgba(92, 110, 82, 0.14)";
    ctx.fill();
    ctx.strokeStyle = "rgba(92, 110, 82, 0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawMode) return;
      isDrawingRef.current = true;
      pixelPointsRef.current = [{ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }];
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [drawMode]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      const newPt = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      const pts = pixelPointsRef.current;
      const last = pts[pts.length - 1];
      const dx = newPt.x - last.x;
      const dy = newPt.y - last.y;
      if (dx * dx + dy * dy > 25) {
        pts.push(newPt);
        renderCanvas();
      }
    },
    [renderCanvas]
  );

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const pts = pixelPointsRef.current;

    // Clear canvas regardless — L.Polygon will take over
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    pixelPointsRef.current = [];

    if (pts.length < 8 || !mapRef.current || !onDrawComplete) return;

    const map = mapRef.current;
    const latLngPoints: DrawnPolygon = pts.map((p: { x: number; y: number }) => {
      const ll = map.containerPointToLatLng(L.point(p.x, p.y));
      return [ll.lat, ll.lng];
    });

    onDrawComplete(latLngPoints);
  }, [onDrawComplete]);

  return (
    <div className={`${className} relative`} style={{ background: "#e8e0d8" }}>
      <div ref={mapContainerRef} className="absolute inset-0" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{
          display: drawMode ? "block" : "none",
          zIndex: 500,
          cursor: "crosshair",
          pointerEvents: "auto",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
