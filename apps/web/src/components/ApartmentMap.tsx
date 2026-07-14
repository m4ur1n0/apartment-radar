import dynamic from "next/dynamic";
export type { ApartmentMapProps, ListingMapPoint, SubwayStationPoint } from "./ApartmentMapClient";

const ApartmentMap = dynamic(() => import("./ApartmentMapClient"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full h-full flex items-center justify-center relative z-40"
      style={{ background: "#f0f0f0" }}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">
        loading map
      </span>
    </div>
  ),
});

export default ApartmentMap;
