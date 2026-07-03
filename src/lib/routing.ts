// ---------------------------------------------------------------------------
// Client-side routing helpers.
//
// Real routing runs SERVER-SIDE via `/api/route` (Google Directions with
// average weekday-morning traffic when GOOGLE_MAPS_API_KEY is set, else OSRM
// turn-by-turn). This module exposes:
//   - estimateMinutes: instant straight-line estimate (used only for the map's
//     commute-cutoff filter and as a last-resort fallback)
//   - routeDetail:     full routed result (minutes, distance, turn-by-turn)
//   - travelTime:      minutes-only convenience wrapper
// ---------------------------------------------------------------------------

import type { TravelMode } from "./types";

/** Rough travel speeds (km/h) by mode for the straight-line estimate. */
const MODE_SPEED_KMH: Record<TravelMode, number> = {
  walk: 4.8,
  bike: 15,
  drive: 32, // urban driving incl. lights/congestion
  transit: 20,
  any: 22, // generic "any mode" blend
};

/** Haversine distance in kilometres between two [lon, lat] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(a[0] - b[0]) * -1; // keep sign explicit
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * SYNC estimate of travel time in minutes from `origin` to `dest` by `mode`,
 * using haversine distance / mode speed plus a small fixed overhead. Used for
 * the optional commute-time cutoff filter on the score map (hundreds of
 * evaluations — must not hit the network).
 */
export function estimateMinutes(
  origin: [number, number],
  dest: [number, number],
  mode: TravelMode,
): number {
  const km = haversineKm(origin, dest);
  const overhead = mode === "transit" ? 6 : mode === "drive" ? 2 : 1;
  const minutes = (km / MODE_SPEED_KMH[mode]) * 60 + overhead;
  return Math.max(1, Math.round(minutes));
}

export interface RouteStep {
  text: string;
  /** Step length in metres (null when unknown). */
  distanceM: number | null;
}

export interface RouteDetail {
  minutes: number;
  /** Optimistic..pessimistic range (equal when the mode has low variability). */
  minutesLow: number;
  minutesHigh: number;
  /** "google-traffic" | "google" | "osrm-typical-traffic" | "osrm" | "estimate" */
  source: string;
  distanceKm: number | null;
  steps: RouteStep[];
}

/**
 * Full routed result from the same-origin `/api/route` server route: minutes,
 * distance, source, and turn-by-turn steps. Returns null on network failure.
 */
export async function routeDetail(
  origin: [number, number],
  dest: [number, number],
  mode: TravelMode,
): Promise<RouteDetail | null> {
  try {
    const res = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, dest, mode }),
      // Client-side ceiling so the UI always resolves.
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<RouteDetail>;
    if (typeof json.minutes !== "number" || json.minutes <= 0) return null;
    return {
      minutes: json.minutes,
      minutesLow:
        typeof json.minutesLow === "number" ? json.minutesLow : json.minutes,
      minutesHigh:
        typeof json.minutesHigh === "number" ? json.minutesHigh : json.minutes,
      source: json.source ?? "unknown",
      distanceKm: typeof json.distanceKm === "number" ? json.distanceKm : null,
      steps: Array.isArray(json.steps) ? json.steps : [],
    };
  } catch {
    return null;
  }
}

/**
 * ASYNC travel time in minutes. Falls back to the local sync estimate when the
 * server route fails.
 */
export async function travelTime(
  origin: [number, number],
  dest: [number, number],
  mode: TravelMode,
): Promise<number> {
  const detail = await routeDetail(origin, dest, mode);
  if (detail) return detail.minutes;
  return estimateMinutes(origin, dest, mode);
}
