// ---------------------------------------------------------------------------
// Nearby-POI fetching. The actual Overpass calls now run SERVER-SIDE via the
// same-origin `/api/overpass` route (browsers can't set a User-Agent and are
// blocked/CORS-rejected by the public mirrors). This module keeps the shared
// `overpassSelectorsForTag` (used by the server route) and the `OverpassPOI`
// type; `fetchPOIs` is now a thin client that POSTs to `/api/overpass`.
// ---------------------------------------------------------------------------

/**
 * Map a free-text tag to one or more Overpass `[k=v]`-style selector bodies
 * (no bbox/brackets appended yet). Known amenities map exactly; otherwise a set
 * of keyword heuristics; final fallback is a case-insensitive name match.
 */
export function overpassSelectorsForTag(tag: string): string[] {
  const key = tag.trim().toLowerCase();

  // Known exact tags.
  if (key === "cafes") return ['["amenity"="cafe"]'];
  if (key === "gluten-free") return ['["diet:gluten_free"="yes"]'];
  if (key === "martial arts") return ['["sport"="martial_arts"]'];

  const has = (s: string) => key.includes(s);
  if (has("coffee") || has("cafe")) return ['["amenity"="cafe"]'];
  if (has("park")) return ['["leisure"="park"]'];
  if (has("gym") || has("fitness")) return ['["leisure"="fitness_centre"]'];
  if (has("school")) return ['["amenity"="school"]'];
  if (has("library")) return ['["amenity"="library"]'];
  if (has("grocery") || has("supermarket")) return ['["shop"="supermarket"]'];
  if (has("bakery")) return ['["shop"="bakery"]'];
  if (has("pizza")) return ['["cuisine"~"pizza"]'];
  if (has("restaurant")) return ['["amenity"="restaurant"]'];
  if (has("bar") || has("pub")) return ['["amenity"="bar"]'];
  if (has("playground")) return ['["leisure"="playground"]'];
  if (has("pharmacy")) return ['["amenity"="pharmacy"]'];
  if (has("beach") || has("water") || has("lake")) return ['["natural"="water"]'];

  // Fallback: fuzzy, case-insensitive name match.
  const safe = tag.trim().replace(/["\\]/g, "");
  return [`["name"~"${safe}",i]`];
}

export interface OverpassPOI {
  id: string;
  tag: string;
  lat: number;
  lon: number;
  name: string;
  /** Human-readable street address when derivable from OSM addr:* tags. */
  address?: string;
}

/**
 * Fetch POIs for each tag within `bbox` = [south, west, north, east]. Delegates
 * to the same-origin `/api/overpass` server route (which does the real Overpass
 * work with a proper User-Agent). Any error yields `[]`; never throws.
 */
export async function fetchPOIs(
  bbox: [number, number, number, number],
  tags: string[],
): Promise<OverpassPOI[]> {
  const cleanTags = tags.map((t) => t.trim()).filter(Boolean);
  if (cleanTags.length === 0) return [];
  try {
    const res = await fetch("/api/overpass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bbox, tags: cleanTags }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { pois?: OverpassPOI[] };
    return json.pois ?? [];
  } catch {
    return [];
  }
}
