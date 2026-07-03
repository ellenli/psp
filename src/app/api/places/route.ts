import { NextResponse } from "next/server";
import { fetchOverpassTag } from "@/lib/overpassServer";
import {
  googleLooksDead,
  markGoogleAlive,
  markGoogleDead,
} from "@/lib/googleKeyHealth";

// Real nearby place data. Priority:
//   1. Google Places API "Text Search (New)" (GOOGLE_MAPS_API_KEY) — real
//      names, addresses, star ratings, review counts, and the REAL Google Maps
//      listing link (googleMapsUri).
//   2. OpenStreetMap (Overpass) — real names/addresses/coords; no ratings
//      (ratings simply don't exist in free data), Maps link is a search URL.
// NEVER returns synthetic places. On total failure returns { places: [] }.
//
// Query params:
//   q                      - free-text tag/keyword (required)
//   Either a viewport box:   s, w, n, e
//   or a point + radius:     lat, lon, radius (metres, default 2000)
export const revalidate = 0;

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
}

export interface MappedPlace {
  id: string;
  name: string;
  rating: number | null;
  reviews: number | null;
  address: string | null;
  lat: number;
  lon: number;
  /** Real Google Maps listing link (Google) or a Maps search link (OSM). */
  mapsUrl: string;
}

/** In-memory cache (10 min TTL). Empty results are NOT cached, so transient
 * upstream failures don't poison a viewport until restart. */
const cache = new Map<string, { ts: number; places: MappedPlace[]; source: string }>();
// POI data changes rarely — long TTL makes revisits instant.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function searchLink(name: string, address: string | null, lat: number, lon: number): string {
  const q = address ? `${name}, ${address}` : `${name} ${lat.toFixed(5)},${lon.toFixed(5)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

async function tryGoogle(
  q: string,
  box: { s: number; w: number; n: number; e: number } | null,
  point: { lat: number; lon: number; radius: number } | null,
): Promise<MappedPlace[] | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || googleLooksDead()) return null;

  const body: Record<string, unknown> = { textQuery: q, maxResultCount: 20 };
  if (box) {
    body.locationRestriction = {
      rectangle: {
        low: { latitude: box.s, longitude: box.w },
        high: { latitude: box.n, longitude: box.e },
      },
    };
  } else if (point) {
    body.locationBias = {
      circle: {
        center: { latitude: point.lat, longitude: point.lon },
        radius: Math.min(50000, Math.max(100, point.radius)),
      },
    };
  }

  try {
    const res = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.rating,places.userRatingCount," +
          "places.formattedAddress,places.location,places.googleMapsUri",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) {
      // Key rejected (auth/billing) — skip Google for a cooldown window so
      // every request isn't taxed by a doomed attempt.
      markGoogleDead();
      return null;
    }
    if (!res.ok) return null; // quota/transient -> fallback for this request
    markGoogleAlive();
    const json = (await res.json()) as { places?: GooglePlace[] };
    const raw = json.places ?? [];
    const places: MappedPlace[] = [];
    for (const p of raw) {
      const plat = p.location?.latitude;
      const plon = p.location?.longitude;
      if (typeof plat !== "number" || typeof plon !== "number") continue;
      const id = p.id ?? `${plat},${plon}`;
      const name = p.displayName?.text ?? q;
      const address = p.formattedAddress ?? null;
      places.push({
        id,
        name,
        rating: typeof p.rating === "number" ? p.rating : null,
        reviews:
          typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        address,
        lat: plat,
        lon: plon,
        mapsUrl: p.googleMapsUri ?? searchLink(name, address, plat, plon),
      });
    }
    return places;
  } catch {
    return null;
  }
}

async function tryOverpass(
  q: string,
  box: { s: number; w: number; n: number; e: number },
): Promise<MappedPlace[]> {
  const pois = await fetchOverpassTag(q, box.s, box.w, box.n, box.e);
  return pois.map((poi) => ({
    id: poi.id,
    name: poi.name,
    rating: null, // real ratings don't exist in OSM — never fabricate one
    reviews: null,
    address: poi.address ?? null,
    lat: poi.lat,
    lon: poi.lon,
    mapsUrl: searchLink(poi.name, poi.address ?? null, poi.lat, poi.lon),
  }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ places: [], source: "invalid" });

  const num = (k: string) => {
    const v = searchParams.get(k);
    return v === null || v === "" ? null : Number(v);
  };

  const s = num("s"), w = num("w"), n = num("n"), e = num("e");
  const lat = num("lat"), lon = num("lon");
  const radius = num("radius") ?? 2000;

  let box: { s: number; w: number; n: number; e: number } | null = null;
  let point: { lat: number; lon: number; radius: number } | null = null;
  if ([s, w, n, e].every((v) => typeof v === "number" && !Number.isNaN(v))) {
    box = { s: s as number, w: w as number, n: n as number, e: e as number };
  } else if (
    typeof lat === "number" && !Number.isNaN(lat) &&
    typeof lon === "number" && !Number.isNaN(lon)
  ) {
    point = { lat, lon, radius };
    // Derive a bbox for the Overpass fallback (~1 deg lat = 111 km).
    const dLat = radius / 111000;
    const dLon = radius / (111000 * Math.cos((lat * Math.PI) / 180));
    box = { s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon };
  } else {
    return NextResponse.json({ places: [], source: "invalid" });
  }

  const cacheKey =
    `${q.toLowerCase()}|` +
    (box ? `${box.s.toFixed(3)},${box.w.toFixed(3)},${box.n.toFixed(3)},${box.e.toFixed(3)}` : "") +
    (point ? `|${point.lat.toFixed(3)},${point.lon.toFixed(3)},${point.radius}` : "");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json({ places: hit.places, source: hit.source });
  }

  // 1. Google Places (real ratings + real listing links).
  const google = await tryGoogle(q, point ? null : box, point);
  if (google && google.length > 0) {
    cache.set(cacheKey, { ts: Date.now(), places: google, source: "google" });
    return NextResponse.json({ places: google, source: "google" });
  }

  // 2. OpenStreetMap fallback (real places, no ratings).
  try {
    const osm = await tryOverpass(q, box);
    if (osm.length > 0) {
      cache.set(cacheKey, { ts: Date.now(), places: osm, source: "osm" });
    }
    return NextResponse.json({ places: osm, source: "osm" });
  } catch {
    return NextResponse.json({ places: [], source: "error" });
  }
}
