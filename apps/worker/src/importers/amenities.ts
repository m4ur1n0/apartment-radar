import type { ExtractedFields } from "./types";

// ordered specific → general
export const AMENITY_PHRASES = [
  "in-unit laundry",
  "washer/dryer in unit",
  "w/d in unit",
  "laundry in building",
  "laundry in basement",
  "common laundry",
  "coin-operated laundry",
  "laundry",
  "dishwasher",
  "microwave",
  "stainless steel appliances",
  "hardwood floors",
  "high ceilings",
  "exposed brick",
  "pre-war",
  "renovated",
  "central a/c",
  "central air",
  "air conditioning",
  "elevator",
  "doorman",
  "virtual doorman",
  "video intercom",
  "live-in super",
  "concierge",
  "gym",
  "fitness center",
  "roof deck",
  "roof access",
  "rooftop",
  "balcony",
  "patio",
  "backyard",
  "outdoor space",
  "bike storage",
  "storage",
  "package room",
  "pets allowed",
  "cats allowed",
  "dogs allowed",
  "cat friendly",
  "dog friendly",
  "cats ok",
  "dogs ok",
  "no pets",
  "guarantors accepted",
  "no fee",
  "broker fee",
];

export function normalizeAmenity(phrase: string): string {
  const aliases: Record<string, string> = {
    "washer/dryer in unit": "in-unit laundry",
    "w/d in unit": "in-unit laundry",
    "laundry in basement": "laundry in building",
    "common laundry": "laundry in building",
    "coin-operated laundry": "laundry in building",
    "central a/c": "central air",
    "fitness center": "gym",
    "roof access": "roof deck",
    "rooftop": "roof deck",
    "cats allowed": "cat friendly",
    "dogs allowed": "dog friendly",
    "cats ok": "cat friendly",
    "dogs ok": "dog friendly",
    "stainless steel appliances": "stainless appliances",
  };
  return aliases[phrase] ?? phrase;
}

export function matchAmenityPhrases(raw: string[]): string[] {
  const out = new Set<string>();
  for (const a of raw) {
    for (const phrase of AMENITY_PHRASES) {
      if (a.includes(phrase) || phrase === a) {
        out.add(normalizeAmenity(phrase));
        break;
      }
    }
  }
  return [...out];
}

const DEFAULT_END_TERMS = [
  "lease details",
  "pet policy",
  "utilities included",
  "move-in costs",
  "location /",
  "the neighborhood",
  "nearby listings",
  "similar listings",
  "similar homes",
  "building details",
  "transit",
  "transportation",
];

export function amenitiesFromSection(text: string, endTerms: string[] = DEFAULT_END_TERMS): string[] {
  const lower = text.toLowerCase();
  const startIdx = lower.search(
    /\bamenities\b|\bapartment\s+amenities\b|\bbuilding\s+amenities\b|\bbuilding\s+features\b|\blisting\s+amenities\b/
  );
  if (startIdx === -1) return [];

  let endIdx = Math.min(lower.length, startIdx + 2000);
  for (const term of endTerms) {
    const idx = lower.indexOf(term, startIdx + 9);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }

  const section = lower.slice(startIdx, endIdx);
  const found: string[] = [];
  for (const phrase of AMENITY_PHRASES) {
    if (section.includes(phrase)) {
      const canonical = normalizeAmenity(phrase);
      if (!found.includes(canonical)) found.push(canonical);
    }
  }
  return found;
}

export function deriveAmenityFields(amenities: string[], fields: ExtractedFields): void {
  if (!fields.laundry) {
    if (amenities.includes("in-unit laundry")) fields.laundry = "in-unit";
    else if (amenities.includes("laundry in building") || amenities.includes("laundry")) fields.laundry = "in building";
  }
  if (!fields.dishwasher && amenities.includes("dishwasher")) fields.dishwasher = true;
  if (!fields.outdoor_space) {
    const outdoorTerms = ["balcony", "patio", "backyard", "roof deck", "outdoor space"];
    if (outdoorTerms.some((t) => amenities.includes(t))) fields.outdoor_space = true;
  }
  if (!fields.pets) {
    if (amenities.includes("pets allowed") || amenities.includes("cat friendly") || amenities.includes("dog friendly")) {
      fields.pets = "allowed";
    } else if (amenities.includes("no pets")) {
      fields.pets = "no pets";
    }
  }
  if (!fields.fee_status && amenities.includes("no fee")) fields.fee_status = "no fee";
  if (amenities.includes("elevator")) fields.elevator = true;
}
