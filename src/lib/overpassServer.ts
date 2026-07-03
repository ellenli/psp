// ---------------------------------------------------------------------------
// SERVER-SIDE Overpass (OpenStreetMap) helpers, shared by the /api/overpass,
// /api/places, and /api/metric-examples routes. Real OSM data only — no
// synthetic fallbacks. Tries multiple mirrors with a proper User-Agent and
// hard timeouts so one bad mirror never hangs a request.
// ---------------------------------------------------------------------------

import { overpassSelectorsForTag } from "./overpass";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const USER_AGENT = "PlayScorePlus/1.0 (contact x.ellen@gmail.com)";

/** Cap the number of elements requested/kept per tag. */
const PER_TAG_CAP = 120;

// ---------------------------------------------------------------------------
// Concurrency gate. The public Overpass mirrors allow only ~2 connections per
// IP; a neighbourhood click fires several tag + metric queries at once, and an
// ungated burst gets everything 429-rejected (the "POIs stopped loading"
// failure). All Overpass traffic funnels through this semaphore.
// ---------------------------------------------------------------------------
const MAX_CONCURRENT = 3;

/** Overall wall-clock budget per query (all passes/mirrors), so an API route
 * always responds in bounded time instead of "loading forever". */
const QUERY_DEADLINE_MS = 22000;
/** Per-mirror attempt timeout. */
const ATTEMPT_TIMEOUT_MS = 8000;
let activeCount = 0;
const waitQueue: (() => void)[] = [];

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    if (activeCount < MAX_CONCURRENT) {
      activeCount++;
      resolve();
    } else {
      waitQueue.push(() => {
        activeCount++;
        resolve();
      });
    }
  });
}

function release(): void {
  activeCount--;
  const next = waitQueue.shift();
  if (next) next();
}

/** Round-robin start index so parallel requests spread across mirrors. */
let mirrorCursor = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function capitalize(tag: string): string {
  const t = tag.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface RawOverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Run a full Overpass QL query against the mirror list. Concurrency-gated,
 * round-robins the starting mirror, and makes a second (delayed) pass when the
 * first sweep fails — 429s are transient. Returns the elements, or null when
 * everything failed. Never throws.
 */
export async function overpassQuery(
  query: string,
): Promise<RawOverpassElement[] | null> {
  await acquire();
  const deadline = Date.now() + QUERY_DEADLINE_MS;
  try {
    const start = mirrorCursor++ % OVERPASS_URLS.length;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) {
        if (Date.now() + 1200 > deadline) break;
        await sleep(1200); // brief backoff before the retry sweep
      }
      for (let i = 0; i < OVERPASS_URLS.length; i++) {
        const remaining = deadline - Date.now();
        if (remaining < 1500) return null; // budget exhausted — respond now
        const endpoint = OVERPASS_URLS[(start + i) % OVERPASS_URLS.length];
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": USER_AGENT,
            },
            body: "data=" + encodeURIComponent(query),
            // Hard timeout so a slow/hanging mirror doesn't stall the request.
            signal: AbortSignal.timeout(
              Math.min(ATTEMPT_TIMEOUT_MS, remaining),
            ),
          });
          if (!res.ok) continue; // 429/504 etc -> next mirror
          const json = (await res.json()) as {
            elements?: RawOverpassElement[];
          };
          return json.elements ?? [];
        } catch {
          // network error / timeout -> next mirror
        }
      }
    }
    return null;
  } finally {
    release();
  }
}

/** Human-readable street address from OSM addr:* tags, when derivable. */
export function addressFrom(
  tags: Record<string, string>,
): string | undefined {
  if (tags["addr:full"]) return tags["addr:full"];
  const num = tags["addr:housenumber"];
  const street = tags["addr:street"];
  const city = tags["addr:city"];
  if (num && street) {
    return `${num} ${street}${city ? ", " + city : ""}`;
  }
  if (street) {
    return `${street}${city ? ", " + city : ""}`;
  }
  return undefined;
}

export interface ServerPOI {
  id: string;
  tag: string;
  lat: number;
  lon: number;
  name: string;
  address?: string;
}

/**
 * Fetch real OSM POIs for one tag within bbox (south, west, north, east).
 * Returns [] on total failure; never throws.
 */
export async function fetchOverpassTag(
  tag: string,
  s: number,
  w: number,
  n: number,
  e: number,
): Promise<ServerPOI[]> {
  try {
    const selectors = overpassSelectorsForTag(tag);
    const body = selectors
      .map((sel) => `nwr${sel}(${s},${w},${n},${e});`)
      .join("");
    const query = `[out:json][timeout:15];(${body});out center ${PER_TAG_CAP};`;

    const elements = await overpassQuery(query);
    if (elements === null) return [];

    const out: ServerPOI[] = [];
    for (const el of elements) {
      if (out.length >= PER_TAG_CAP) break;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      const t = el.tags ?? {};
      const address = addressFrom(t);
      const name = t.name ?? t.brand ?? address ?? capitalize(tag);
      out.push({
        id: `${tag}:${el.type}/${el.id}`,
        tag,
        lat,
        lon,
        name,
        address,
      });
    }
    return out;
  } catch {
    return [];
  }
}
