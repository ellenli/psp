#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Precompute per-neighbourhood metric examples (real OSM places) at ETL time.
//
// For every neighbourhood in public/data/neighbourhoods.json this fetches ONE
// combined Overpass query (~1.5 km around the centroid), classifies the
// results per leaf metric, and writes counts + top-8 nearest examples to
// public/data/metric-examples.json. The /api/metric-examples route serves
// from that file instantly, so the detail panel no longer waits on the slow
// public Overpass servers at click time.
//
// Run on a machine with open network access:
//   node scripts/precompute-examples.mjs            # all areas (resumes)
//   node scripts/precompute-examples.mjs --limit 5  # first 5 (smoke test)
//   node scripts/precompute-examples.mjs --force    # recompute everything
//
// Sequential + politely paced (one Overpass request in flight, short delay
// between areas). A full run takes roughly 10–25 minutes. Re-running resumes:
// areas already present in the output file are skipped unless --force.
//
// NOTE: the metric definitions below MUST stay in sync with
// src/lib/metricExamples.ts (the runtime fallback uses the same logic).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const IN_FILE = path.join(ROOT, "public", "data", "neighbourhoods.json");
const OUT_FILE = path.join(ROOT, "public", "data", "metric-examples.json");

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const USER_AGENT = "PlayScorePlus/1.0 (contact x.ellen@gmail.com)";

const RADIUS_DEG_LAT = 0.0135; // ~1.5 km
const EXAMPLES_CAP = 8;

// --- metric definitions (keep in sync with src/lib/metricExamples.ts) ------

const ENRICHED_EDU_RE =
  /montessori|waldorf|steiner|international baccalaureate|\bib\b|gifted|alternative|\btops\b|\bmast\b|university of toronto schools|\buts\b/i;
const SECONDARY_NAME_RE = /secondary|high school|collegiate/i;

const METRIC_DEFS = {
  space_for_play: {
    selectors: [
      'nwr["leisure"="park"]',
      'nwr["leisure"="playground"]',
      'nwr["leisure"="pitch"]',
    ],
    match: (t) => ["park", "playground", "pitch"].includes(t.leisure ?? ""),
    kindLabel: (t) =>
      t.leisure === "playground"
        ? "Playground"
        : t.leisure === "pitch"
          ? "Sports field"
          : "Park",
  },
  natural_env: {
    selectors: [
      'nwr["natural"="water"]',
      'nwr["natural"="wood"]',
      'nwr["leisure"="nature_reserve"]',
    ],
    match: (t) =>
      t.natural === "water" ||
      t.natural === "wood" ||
      t.leisure === "nature_reserve",
    kindLabel: (t) =>
      t.natural === "water"
        ? "Water"
        : t.leisure === "nature_reserve"
          ? "Nature reserve"
          : "Woods",
  },
  destinations: {
    selectors: [
      'nwr["amenity"="library"]',
      'nwr["amenity"="community_centre"]',
      'nwr["amenity"="school"]',
      'nwr["amenity"="kindergarten"]',
    ],
    match: (t) =>
      ["library", "community_centre", "school", "kindergarten"].includes(
        t.amenity ?? "",
      ),
    namedOnly: true,
    kindLabel: () => "Destination",
  },
  transit_bus: {
    selectors: ['node["highway"="bus_stop"]'],
    match: (t) => t.highway === "bus_stop",
    dedupeByName: true,
    kindLabel: () => "Bus stop",
  },
  transit_subway: {
    selectors: ['nwr["station"="subway"]'],
    match: (t) => t.station === "subway",
    dedupeByName: true,
    kindLabel: () => "Subway station",
  },
  transit_streetcar: {
    selectors: ['node["railway"="tram_stop"]'],
    match: (t) => t.railway === "tram_stop",
    dedupeByName: true,
    kindLabel: () => "Streetcar stop",
  },
  transit_go: {
    selectors: ['nwr["railway"="station"]'],
    match: (t) =>
      t.railway === "station" && t.station !== "subway" && t.subway !== "yes",
    dedupeByName: true,
    kindLabel: () => "Rail station",
  },
  bike_lanes: {
    selectors: [
      'way["highway"="cycleway"]["name"]',
      'way["cycleway"~"track|separate"]["name"]',
      'way["cycleway:both"~"track|separate"]["name"]',
    ],
    match: (t) =>
      t.highway === "cycleway" ||
      /track|separate/.test(t.cycleway ?? "") ||
      /track|separate/.test(t["cycleway:both"] ?? ""),
    namedOnly: true,
    dedupeByName: true,
    kindLabel: () => "Bike route",
  },
  bike_share: {
    selectors: ['nwr["amenity"="bicycle_rental"]'],
    match: (t) => t.amenity === "bicycle_rental",
    dedupeByName: true,
    kindLabel: () => "Bike share station",
  },
  edu_montessori: {
    selectors: ['nwr["amenity"~"^(school|kindergarten|childcare)$"]'],
    match: (t) =>
      ["school", "kindergarten", "childcare"].includes(t.amenity ?? "") &&
      ENRICHED_EDU_RE.test(t.name ?? ""),
    namedOnly: true,
    kindLabel: () => "Enriched program",
  },
  edu_daycare: {
    selectors: ['nwr["amenity"="childcare"]', 'nwr["amenity"="kindergarten"]'],
    match: (t) => ["childcare", "kindergarten"].includes(t.amenity ?? ""),
    kindLabel: () => "Daycare",
  },
  edu_afterschool: {
    selectors: [
      'nwr["amenity"="childcare"]',
      'nwr["amenity"="community_centre"]',
    ],
    match: (t) => ["childcare", "community_centre"].includes(t.amenity ?? ""),
    namedOnly: true,
    kindLabel: () => "Program",
  },
  edu_k8: {
    selectors: ['nwr["amenity"="school"]'],
    match: (t) => {
      if (t.amenity !== "school") return false;
      if (SECONDARY_NAME_RE.test(t.name ?? "")) return false;
      const isced = t["isced:level"] ?? "";
      if (isced && !/0|1|2/.test(isced)) return false;
      return true;
    },
    namedOnly: true,
    kindLabel: () => "School",
  },
  edu_9_12: {
    selectors: ['nwr["amenity"="school"]'],
    match: (t) => {
      if (t.amenity !== "school") return false;
      const isced = t["isced:level"] ?? "";
      return (
        /secondary|high school|collegiate|institute/i.test(t.name ?? "") ||
        /3/.test(isced)
      );
    },
    namedOnly: true,
    kindLabel: () => "Secondary school",
  },
  edu_private: {
    selectors: ['nwr["amenity"="school"]'],
    match: (t) => {
      if (t.amenity !== "school") return false;
      return (
        t["operator:type"] === "private" ||
        t.fee === "yes" ||
        /private|academy|independent/i.test(t.name ?? "")
      );
    },
    namedOnly: true,
    kindLabel: () => "Private school",
  },
};

// --- helpers ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function centroidOf(feature) {
  let ring = [];
  if (feature.geometry.type === "Polygon") {
    ring = feature.geometry.coordinates[0] ?? [];
  } else {
    ring = (feature.geometry.coordinates[0] ?? [])[0] ?? [];
  }
  if (ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return [lon / ring.length, lat / ring.length];
}

function addressFrom(tags) {
  if (tags["addr:full"]) return tags["addr:full"];
  const num = tags["addr:housenumber"];
  const street = tags["addr:street"];
  const city = tags["addr:city"];
  if (num && street) return `${num} ${street}${city ? ", " + city : ""}`;
  if (street) return `${street}${city ? ", " + city : ""}`;
  return undefined;
}

function searchLink(name, address, lat, lon) {
  const q = address
    ? `${name}, ${address}`
    : `${name} ${lat.toFixed(5)},${lon.toFixed(5)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

let mirrorCursor = 0;
async function overpassQuery(query) {
  const start = mirrorCursor++ % OVERPASS_URLS.length;
  for (let pass = 0; pass < 3; pass++) {
    if (pass > 0) await sleep(3000 * pass);
    for (let i = 0; i < OVERPASS_URLS.length; i++) {
      const endpoint = OVERPASS_URLS[(start + i) % OVERPASS_URLS.length];
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) continue;
        const json = await res.json();
        return json.elements ?? [];
      } catch {
        // next mirror
      }
    }
  }
  return null;
}

// Union of all selectors across metrics (built once).
const ALL_SELECTORS = [
  ...new Set(Object.values(METRIC_DEFS).flatMap((d) => d.selectors)),
];

function classify(elements, cLat, cLon) {
  const out = {};
  for (const [key, def] of Object.entries(METRIC_DEFS)) {
    const seen = new Set();
    const matched = [];
    for (const el of elements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      const t = el.tags ?? {};
      if (!def.match(t)) continue;
      if (def.namedOnly && !t.name) continue;
      const name = t.name ?? def.kindLabel(t);
      if (def.dedupeByName) {
        const k = name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
      }
      const address = addressFrom(t) ?? null;
      matched.push({
        name,
        address,
        lat,
        lon,
        mapsUrl: searchLink(name, address, lat, lon),
        rating: null,
        reviews: null,
        km: haversineKm(cLat, cLon, lat, lon),
      });
    }
    matched.sort((a, b) => a.km - b.km);
    out[key] = {
      count: matched.length,
      examples: matched.slice(0, EXAMPLES_CAP).map(({ km, ...rest }) => rest),
    };
  }
  return out;
}

// --- main --------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const limitIdx = args.indexOf("--limit");
  const limit =
    limitIdx !== -1 ? Number(args[limitIdx + 1]) || Infinity : Infinity;

  if (!fs.existsSync(IN_FILE)) {
    console.error(
      `Missing ${IN_FILE} — run \`node scripts/fetch-data.mjs\` first.`,
    );
    process.exit(1);
  }
  const collection = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
  const features = collection.features ?? [];

  let existing = { generatedAt: null, radiusKm: 1.5, areas: {} };
  if (!force && fs.existsSync(OUT_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
      existing.areas ??= {};
    } catch {
      // corrupt file — start fresh
      existing = { generatedAt: null, radiusKm: 1.5, areas: {} };
    }
  }

  const todo = features.filter(
    (f) => force || !existing.areas[f.properties?.AREA_NAME],
  );
  console.log(
    `${features.length} neighbourhoods; ${todo.length} to compute` +
      (Number.isFinite(limit) ? ` (limit ${limit})` : "") +
      (force ? " [force]" : " [resume]"),
  );

  let done = 0;
  let failed = 0;
  for (const f of todo.slice(0, limit)) {
    const name = f.properties?.AREA_NAME ?? "Unknown";
    const centroid = centroidOf(f);
    if (!centroid) {
      console.warn(`  skip (no geometry): ${name}`);
      continue;
    }
    const [lon, lat] = centroid;
    const dLat = RADIUS_DEG_LAT;
    const dLon = dLat / Math.cos((lat * Math.PI) / 180);
    const bbox = `(${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon})`;
    const query =
      `[out:json][timeout:25];(` +
      ALL_SELECTORS.map((sel) => `${sel}${bbox};`).join("") +
      `);out center 2000;`;

    const t0 = Date.now();
    const elements = await overpassQuery(query);
    if (elements === null) {
      failed++;
      console.warn(`  FAILED: ${name} (all mirrors) — will retry on re-run`);
    } else {
      existing.areas[name] = classify(elements, lat, lon);
      done++;
      const counts = Object.values(existing.areas[name])
        .map((r) => r.count)
        .reduce((a, b) => a + b, 0);
      console.log(
        `  [${done}/${Math.min(todo.length, limit)}] ${name}: ${elements.length} elements -> ${counts} classified (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
      );
      // Save incrementally so an interrupted run loses nothing.
      existing.generatedAt = new Date().toISOString();
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing));
    }
    await sleep(500); // stay polite to the public mirrors
  }

  console.log(
    `\nDone: ${done} computed, ${failed} failed, ` +
      `${Object.keys(existing.areas).length} total in ${path.relative(ROOT, OUT_FILE)}`,
  );
  if (failed > 0) {
    console.log("Re-run the script to retry the failed areas (it resumes).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
