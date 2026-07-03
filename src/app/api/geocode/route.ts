import { NextResponse } from "next/server";

// Server-side geocoding. Priority:
//   1. Google Geocoding API (GOOGLE_MAPS_API_KEY) — handles business names,
//      postal codes, and messy "Name, address" strings reliably.
//   2. Nominatim (OSM) with query VARIANTS: full string, postal code stripped,
//      leading business-name segment dropped — Nominatim chokes on
//      "MDA Space, 7500 Financial Dr, Brampton, ON L6Y 6K7" but resolves
//      "7500 Financial Dr, Brampton, ON".
//   3. Photon (komoot) as a last free fallback.
// Accepts ?q=<query>, returns { coord: [lon, lat] | null, label, source }.
// Successes are cached in-memory; FAILURES ARE NOT (a transient timeout must
// not poison a query until the server restarts).
export const revalidate = 0;

const USER_AGENT = "PlayScorePlus/1.0 (contact x.ellen@gmail.com)";

/** Overall wall-clock budget per request so the panel never spins forever. */
const REQUEST_DEADLINE_MS = 16000;
/** Per-attempt timeout. */
const ATTEMPT_TIMEOUT_MS = 6000;

function remainingMs(deadline: number): number {
  return deadline - Date.now();
}

interface GeoHit {
  coord: [number, number];
  label: string | null;
  source: string;
}

const cache = new Map<string, GeoHit>();

const POSTAL_RE = /[A-Za-z]\d[A-Za-z]\s*\d[A-Za-z]\d/g;

/** Build fallback query variants for free geocoders. */
function variants(q: string): string[] {
  const out: string[] = [q];
  const push = (v: string) => {
    const t = v.replace(/\s{2,}/g, " ").replace(/\s*,\s*/g, ", ").replace(/^,|,$/g, "").trim();
    if (t && !out.includes(t)) out.push(t);
  };

  // Strip the postal code (Nominatim often fails on "street, ON L6Y 6K7").
  push(q.replace(POSTAL_RE, ""));

  // Drop a leading business-name segment ("MDA Space, 7500 Financial Dr, ...").
  const parts = q.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && !/\d/.test(parts[0]) && /\d/.test(parts.slice(1).join(","))) {
    const rest = parts.slice(1).join(", ");
    push(rest);
    push(rest.replace(POSTAL_RE, ""));
  }
  return out;
}

async function tryGoogle(q: string, deadline: number): Promise<GeoHit | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || remainingMs(deadline) < 1000) return null;
  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?region=ca&address=" +
      encodeURIComponent(q) +
      "&key=" + key;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(
        Math.min(ATTEMPT_TIMEOUT_MS, remainingMs(deadline)),
      ),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    if (json.status !== "OK") return null;
    const loc = json.results?.[0]?.geometry?.location;
    if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
    return {
      coord: [loc.lng, loc.lat],
      label: json.results?.[0]?.formatted_address ?? null,
      source: "google",
    };
  } catch {
    return null;
  }
}

async function tryNominatim(q: string, deadline: number): Promise<GeoHit | null> {
  for (const v of variants(q)) {
    if (remainingMs(deadline) < 1000) return null;
    try {
      const url =
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=" +
        encodeURIComponent(v);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(
          Math.min(ATTEMPT_TIMEOUT_MS, remainingMs(deadline)),
        ),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as Array<{
        lon?: string;
        lat?: string;
        display_name?: string;
      }>;
      const first = Array.isArray(json) ? json[0] : undefined;
      if (!first?.lon || !first?.lat) continue;
      const lon = parseFloat(first.lon);
      const lat = parseFloat(first.lat);
      if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
      return { coord: [lon, lat], label: first.display_name ?? null, source: "nominatim" };
    } catch {
      // try next variant
    }
  }
  return null;
}

async function tryPhoton(q: string, deadline: number): Promise<GeoHit | null> {
  for (const v of variants(q)) {
    if (remainingMs(deadline) < 1000) return null;
    try {
      const url =
        "https://photon.komoot.io/api/?limit=1&lang=en&q=" + encodeURIComponent(v);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(
          Math.min(ATTEMPT_TIMEOUT_MS, remainingMs(deadline)),
        ),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: { country?: string; name?: string; street?: string; city?: string };
        }>;
      };
      const f = json.features?.[0];
      const coords = f?.geometry?.coordinates;
      if (!coords || coords.length !== 2) continue;
      // Keep results in Canada only.
      if (f?.properties?.country && f.properties.country !== "Canada") continue;
      const label =
        [f?.properties?.name, f?.properties?.street, f?.properties?.city]
          .filter(Boolean)
          .join(", ") || null;
      return { coord: [coords[0], coords[1]], label, source: "photon" };
    } catch {
      // try next variant
    }
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ coord: null });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit) {
    return NextResponse.json({ coord: hit.coord, label: hit.label, source: hit.source });
  }

  const deadline = Date.now() + REQUEST_DEADLINE_MS;
  const result =
    (await tryGoogle(q, deadline)) ??
    (await tryNominatim(q, deadline)) ??
    (await tryPhoton(q, deadline));

  if (result) {
    cache.set(key, result);
    return NextResponse.json({
      coord: result.coord,
      label: result.label,
      source: result.source,
    });
  }
  return NextResponse.json({ coord: null });
}
