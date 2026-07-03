import { NextResponse } from "next/server";
import type { TravelMode } from "@/lib/types";

// Server-side turn-by-turn routing. Priority:
//   1. Google Directions with average weekday-morning traffic (needs a key):
//      real turn-by-turn steps + duration_in_traffic.
//   2. OSRM (FOSSGIS/project-osrm public servers): real routed turn-by-turn
//      for drive/walk/bike (drive gets a x1.25 typical-congestion adjustment;
//      OSRM has no live traffic).
//   3. Straight-line haversine estimate per mode (no steps).
// Returns { minutes, source, distanceKm?, steps? }; never throws.
export const revalidate = 0;

type Coord = [number, number];

export interface RouteStep {
  text: string;
  /** Step length in metres (null when unknown). */
  distanceM: number | null;
}

/** Rough travel speeds (km/h) by mode for the straight-line fallback. */
const MODE_SPEED_KMH: Record<TravelMode, number> = {
  walk: 4.8,
  bike: 15,
  drive: 32,
  transit: 20,
  any: 24,
};

function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function estimate(origin: Coord, dest: Coord, mode: TravelMode): number {
  const km = haversineKm(origin, dest);
  const overhead = mode === "transit" ? 6 : mode === "drive" ? 2 : 1;
  const minutes = (km / MODE_SPEED_KMH[mode]) * 60 + overhead;
  return Math.max(1, Math.round(minutes));
}

/** Unix seconds for the next weekday at 08:00 America/Toronto. */
function nextWeekdayMorning(): number {
  const now = new Date();
  const tzOffsetMin = torontoOffsetMinutes(now);
  for (let addDays = 0; addDays < 8; addDays++) {
    const d = new Date(now.getTime() + addDays * 86400000);
    const local = new Date(d.getTime() + tzOffsetMin * 60000);
    const dow = local.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const utcMs = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      8,
      0,
      0,
    ) - tzOffsetMin * 60000;
    if (utcMs > now.getTime()) return Math.floor(utcMs / 1000);
  }
  return Math.floor(now.getTime() / 1000) + 3600;
}

/** Toronto UTC offset in minutes (negative), e.g. -240 (EDT) or -300 (EST). */
function torontoOffsetMinutes(at: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = fmt.formatToParts(at);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return -300;
  }
}

/** Strip HTML tags/entities from Google step instructions. */
function stripHtml(s: string): string {
  return s
    .replace(/<div[^>]*>/g, " — ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, " ")
    .trim();
}

interface RouteResult {
  minutes: number;
  /** Optimistic..pessimistic range. Equal for modes with little variability. */
  minutesLow: number;
  minutesHigh: number;
  source: string;
  distanceKm: number | null;
  steps: RouteStep[];
}

/** Widen a driving estimate into a low–high range when the spread is tiny. */
function ensureSpread(low: number, high: number): [number, number] {
  if (high - low >= Math.max(2, Math.round(low * 0.15))) return [low, high];
  return [low, Math.max(low + 2, Math.round(low * 1.2))];
}

async function tryGoogle(
  origin: Coord,
  dest: Coord,
  mode: TravelMode,
): Promise<RouteResult | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const gMode =
    mode === "walk"
      ? "walking"
      : mode === "bike"
        ? "bicycling"
        : mode === "transit"
          ? "transit"
          : "driving"; // drive + any
  const params = new URLSearchParams({
    origin: `${origin[1]},${origin[0]}`,
    destination: `${dest[1]},${dest[0]}`,
    mode: gMode,
    key,
  });
  if (gMode === "driving") {
    params.set("departure_time", String(nextWeekdayMorning()));
    params.set("traffic_model", "best_guess");
  }
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      routes?: Array<{
        legs?: Array<{
          duration?: { value?: number };
          duration_in_traffic?: { value?: number };
          distance?: { value?: number };
          steps?: Array<{
            html_instructions?: string;
            distance?: { value?: number };
          }>;
        }>;
      }>;
    };
    if (json.status && json.status !== "OK") return null;
    const leg = json.routes?.[0]?.legs?.[0];
    const base = leg?.duration?.value;
    const traffic = leg?.duration_in_traffic?.value;
    const secs = traffic ?? base;
    if (typeof secs !== "number") return null;
    const steps: RouteStep[] = (leg?.steps ?? [])
      .map((s) => ({
        text: stripHtml(s.html_instructions ?? ""),
        distanceM: typeof s.distance?.value === "number" ? s.distance.value : null,
      }))
      .filter((s) => s.text);
    const minutes = Math.max(1, Math.round(secs / 60));
    // Range: free-flow duration vs typical-traffic duration for driving;
    // other modes have little variability.
    let minutesLow = minutes;
    let minutesHigh = minutes;
    if (gMode === "driving" && typeof base === "number") {
      const lo = Math.max(1, Math.round(Math.min(base, secs) / 60));
      const hi = Math.max(1, Math.round(Math.max(base, secs) / 60));
      [minutesLow, minutesHigh] = ensureSpread(lo, hi);
    }
    return {
      minutes,
      minutesLow,
      minutesHigh,
      source:
        gMode === "driving" && leg?.duration_in_traffic
          ? "google-traffic"
          : "google",
      distanceKm:
        typeof leg?.distance?.value === "number"
          ? Math.round(leg.distance.value / 100) / 10
          : null,
      steps,
    };
  } catch {
    return null;
  }
}

// --- OSRM ---

interface OsrmStep {
  name?: string;
  destinations?: string;
  distance?: number;
  maneuver?: { type?: string; modifier?: string; exit?: number };
}

function compassFromModifier(modifier?: string): string {
  return modifier ? modifier.replace(/^uturn$/, "U-turn") : "";
}

/** Compose a human instruction from an OSRM step. */
function osrmStepText(step: OsrmStep): string {
  const type = step.maneuver?.type ?? "";
  const mod = compassFromModifier(step.maneuver?.modifier);
  const name = step.name || "";
  const dest = step.destinations || "";
  const onto = name ? ` onto ${name}` : dest ? ` toward ${dest}` : "";
  const on = name ? ` on ${name}` : "";
  switch (type) {
    case "depart":
      return `Head ${mod || "out"}${on}`.trim();
    case "arrive":
      return "Arrive at destination";
    case "turn":
    case "end of road":
      return `Turn ${mod || ""}${onto}`.replace(/\s+/g, " ").trim();
    case "continue":
      return `Continue ${mod && mod !== "straight" ? mod : ""}${on}`.replace(/\s+/g, " ").trim();
    case "new name":
      return `Continue${onto || on}`;
    case "merge":
      return `Merge${onto}`;
    case "on ramp":
      return `Take the ramp${dest ? ` toward ${dest}` : onto}`;
    case "off ramp":
      return `Take the exit${dest ? ` toward ${dest}` : onto}`;
    case "fork":
      return `Keep ${mod || "ahead"}${onto}`;
    case "roundabout":
    case "rotary":
      return `At the roundabout, take exit ${step.maneuver?.exit ?? ""}${onto}`.trim();
    default:
      return `${type ? type.charAt(0).toUpperCase() + type.slice(1) : "Continue"}${onto || on}`.trim();
  }
}

/** OSRM endpoints per mode. FOSSGIS serves real walk/bike/car profiles. */
function osrmBases(mode: TravelMode): { base: string; profile: string }[] {
  if (mode === "walk") {
    return [
      { base: "https://routing.openstreetmap.de/routed-foot", profile: "foot" },
    ];
  }
  if (mode === "bike") {
    return [
      { base: "https://routing.openstreetmap.de/routed-bike", profile: "bike" },
    ];
  }
  // drive + any (+ transit falls through to estimate before reaching here)
  return [
    { base: "https://routing.openstreetmap.de/routed-car", profile: "car" },
    { base: "https://router.project-osrm.org", profile: "driving" },
  ];
}

async function tryOsrm(
  origin: Coord,
  dest: Coord,
  mode: TravelMode,
): Promise<RouteResult | null> {
  if (mode === "transit") return null; // no free transit routing
  const isDrive = mode === "drive" || mode === "any";
  for (const { base, profile } of osrmBases(mode)) {
    try {
      const url =
        `${base}/route/v1/${profile}/` +
        `${origin[0]},${origin[1]};${dest[0]},${dest[1]}` +
        `?overview=false&steps=true`;
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        code?: string;
        routes?: Array<{
          duration?: number;
          distance?: number;
          legs?: Array<{ steps?: OsrmStep[] }>;
        }>;
      };
      if (json.code !== "Ok") continue;
      const route = json.routes?.[0];
      const secs = route?.duration;
      if (typeof secs !== "number") continue;
      // OSRM has no live traffic; scale driving by ~1.25 to approximate a
      // typical weekday commute, and report a free-flow..congested range.
      const factor = isDrive ? 1.25 : 1;
      const steps: RouteStep[] = (route?.legs?.[0]?.steps ?? [])
        .map((s) => ({
          text: osrmStepText(s),
          distanceM: typeof s.distance === "number" ? Math.round(s.distance) : null,
        }))
        .filter((s) => s.text);
      const minutes = Math.max(1, Math.round((secs / 60) * factor));
      const minutesLow = isDrive
        ? Math.max(1, Math.round((secs / 60) * 1.05))
        : minutes;
      const minutesHigh = isDrive
        ? Math.max(minutesLow + 2, Math.round((secs / 60) * 1.45))
        : minutes;
      return {
        minutes,
        minutesLow,
        minutesHigh,
        source: isDrive ? "osrm-typical-traffic" : "osrm",
        distanceKm:
          typeof route?.distance === "number"
            ? Math.round(route.distance / 100) / 10
            : null,
        steps,
      };
    } catch {
      // try the next server
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      origin?: Coord;
      dest?: Coord;
      mode?: TravelMode;
    };
    const origin = body.origin;
    const dest = body.dest;
    const mode: TravelMode = body.mode ?? "any";
    if (
      !origin ||
      !dest ||
      origin.length !== 2 ||
      dest.length !== 2 ||
      origin.some((v) => typeof v !== "number") ||
      dest.some((v) => typeof v !== "number")
    ) {
      return NextResponse.json({ minutes: 0, source: "invalid" });
    }

    const google = await tryGoogle(origin, dest, mode);
    if (google) return NextResponse.json(google);

    const osrm = await tryOsrm(origin, dest, mode);
    if (osrm) return NextResponse.json(osrm);

    const est = estimate(origin, dest, mode);
    const spread = mode === "drive" || mode === "any" || mode === "transit";
    return NextResponse.json({
      minutes: est,
      minutesLow: spread ? Math.max(1, Math.round(est * 0.85)) : est,
      minutesHigh: spread ? Math.round(est * 1.3) : est,
      source: "estimate",
      distanceKm: Math.round(haversineKm(origin, dest) * 10) / 10,
      steps: [],
    });
  } catch {
    return NextResponse.json({ minutes: 0, source: "error" });
  }
}
