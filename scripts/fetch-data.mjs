#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fetch-data.mjs — build the committed REAL neighbourhood dataset from FREE
// open sources (OpenStreetMap via Overpass + City of Toronto Neighbourhood
// Profiles / 2021 Census).
//
// Run locally (with open network, takes a few minutes):
//     node scripts/fetch-data.mjs
//
// What it does:
//   1. Fetches the City of Toronto "Neighbourhoods" boundaries (158 areas,
//      EPSG:4326), then ALSO fetches surrounding Greater Toronto Area
//      municipality boundaries (Oakville → Milton → Uxbridge → Whitby/Oshawa)
//      and MERGES them into the same FeatureCollection (each municipality = one
//      area). The full merged set is scored over a GTA-wide bbox.
//   2. For each OSM feature CATEGORY, issues ONE Overpass query over the whole
//      GTA bbox (NOT one query per area), then assigns each returned element to
//      an area by point-in-polygon (ray casting).
//   3. Normalizes per-neighbourhood counts to a 0–100 score using within-city
//      rank/percentile (ntile-style), reversing where noted (traffic_env).
//   4. Fetches the City of Toronto "Neighbourhood Profiles" (2021 Census) CSV
//      via CKAN and joins population / density / low-income % / children % and
//      derives a simple social_env proxy.
//   5. Writes the merged FeatureCollection to public/data/neighbourhoods.json,
//      which /api/neighbourhoods prefers (source: "local-real-data").
//
// Where a category yields no data, that leaf is left OUT so the app's
// enrichFeatures() fills a modeled value instead. edu_fraser is deliberately
// left OUT: Fraser Institute school ratings are PROPRIETARY and are not sourced
// here — the app fills a modeled value for it.
//
// Uses Node built-ins only (global fetch, Node 20+). Overpass calls are
// sequential with a ~1s delay to be polite; each category is wrapped in
// try/catch so one failure never aborts the run.
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../public/data/neighbourhoods.json");

const TORONTO_GEOJSON_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/fc443770-ef0a-4025-9c2c-2cb558bfab00/resource/0719053b-28b7-48ea-b863-068823a93aaa/download/neighbourhoods-4326.geojson";

// GTA municipality boundaries (option 1): Toronto's 158 neighbourhoods PLUS the
// surrounding Greater Toronto Area municipalities, merged into ONE
// FeatureCollection so the OSM/census scoring runs over the full extent.
//
// Source: Statistics Canada 2021 Census Subdivision (CSD) cartographic
// boundaries, served as GeoJSON. Exact endpoint URLs vary between releases and
// mirrors, so this is implemented DEFENSIVELY: we try each URL below in order,
// wrap the whole fetch in try/catch, and if none succeed (or the response has
// an unexpected shape) we LOG a warning and continue with Toronto neighbourhoods
// only — the run never aborts. Whatever endpoint is used must return a GeoJSON
// FeatureCollection of polygon boundaries with a municipality-name property
// (we probe several common name keys below).
const GTA_MUNICIPALITIES_SOURCE = [
  // Ontario GeoHub / LIO "Municipal Boundary - Lower and Single Tier" (verified
  // working ArcGIS MapServer layer 14). Returns GeoJSON directly with f=geojson;
  // geometry generalized (maxAllowableOffset) to keep the payload small. Name
  // field is MUNICIPAL_NAME; we fetch all and filter locally to the GTA set.
  "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open03/MapServer/14/query?where=1%3D1&outFields=MUNICIPAL_NAME%2CMUNICIPAL_NAME_SHORTFORM%2CUPPER_TIER_MUNICIPALITY&outSR=4326&maxAllowableOffset=0.0005&geometryPrecision=5&resultRecordCount=5000&f=geojson",
];

// GTA municipalities to KEEP from the CSD/municipal boundary source. Toronto
// itself is already covered by the 158 neighbourhoods, so a whole-Toronto CSD is
// deliberately EXCLUDED here (see GTA_EXCLUDE_NAMES) to avoid overlap.
const GTA_MUNICIPALITY_NAMES = [
  "Mississauga",
  "Brampton",
  "Caledon",
  "Oakville",
  "Burlington",
  "Milton",
  "Halton Hills",
  "Vaughan",
  "Markham",
  "Richmond Hill",
  "Aurora",
  "Newmarket",
  "King",
  "East Gwillimbury",
  "Georgina",
  "Whitchurch-Stouffville",
  "Pickering",
  "Ajax",
  "Whitby",
  "Oshawa",
  "Clarington",
  "Uxbridge",
  "Scugog",
  "Brock",
];

// Names that must NEVER be added (already covered by Toronto neighbourhoods).
const GTA_EXCLUDE_NAMES = ["toronto"];

// Common property keys that hold a municipality/CSD name across sources.
const MUNI_NAME_KEYS = [
  "MUNICIPAL_NAME",
  "MUNICIPAL_NAME_SHORTFORM",
  "CSDNAME",
  "CSD_NAME",
  "csdname",
  "NAME",
  "Name",
  "name",
  "MUNICIPAL",
  "MUNICIPALITY",
  "AREA_NAME",
  "CDNAME",
];

// CKAN base + the Neighbourhood Profiles package (2021 Census).
const CKAN_BASE =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action";
const PROFILES_PACKAGE_ID = "neighbourhood-profiles";

// Multiple Overpass mirrors — the main endpoint frequently drops connections
// under load (surfaces as a low-level "fetch failed"), so we try each in turn.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Full Greater Toronto Area bounding box: south, west, north, east. Widened
// from the old City-of-Toronto-only box so the Overpass category queries also
// cover the added GTA municipalities (Oakville/Milton in the SW to
// Uxbridge/Clarington in the NE).
const BBOX = { south: 43.3, west: -80.05, north: 44.4, east: -78.6 };
const BBOX_STR = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -----------------------------------------------------------------------------
// Minimal CSV parser (handles quoted fields and embedded commas/newlines).
// -----------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore; handled by \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toNumber(v) {
  if (v === undefined || v === null) return null;
  const n = Number(String(v).replace(/[,%\s$]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// -----------------------------------------------------------------------------
// Geometry: ray-casting point-in-polygon, handling Polygon + MultiPolygon and
// exterior rings (holes are ignored — good enough for point assignment).
// -----------------------------------------------------------------------------
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFeature(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates;
    if (!rings || !rings.length) return false;
    // exterior ring is rings[0]; ignore holes for assignment
    return pointInRing(lon, lat, rings[0]);
  }
  if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) {
      if (poly && poly.length && pointInRing(lon, lat, poly[0])) return true;
    }
    return false;
  }
  return false;
}

/** Precompute a bbox per feature to short-circuit point-in-polygon tests. */
function featureBBox(geometry) {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  const polys =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0] || [];
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

// -----------------------------------------------------------------------------
// Normalization: within-city rank/percentile (ntile-style) -> 0..100.
// Neighbourhoods with 0 count still get a (low) percentile rank. `reverse`
// flips the ranking (used for traffic_env, where FEWER big roads = higher).
// -----------------------------------------------------------------------------
function rankNormalize(counts, reverse = false) {
  const n = counts.length;
  if (n === 0) return [];
  // sort indices by count ascending
  const idx = counts.map((_, i) => i);
  idx.sort((a, b) => counts[a] - counts[b]);
  const out = new Array(n);
  for (let r = 0; r < n; r++) {
    const i = idx[r];
    // percentile in [0,100]; ties get their position (stable enough for coloring)
    let pct = n === 1 ? 100 : Math.round((r / (n - 1)) * 100);
    if (reverse) pct = 100 - pct;
    out[i] = pct;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Overpass helpers.
// -----------------------------------------------------------------------------
async function overpass(query) {
  const ql = `[out:json][timeout:120];(${query});out center;`;
  // Overpass servers expect the query as form field `data`, and a descriptive
  // User-Agent (some mirrors reject empty UAs — a likely cause of "fetch
  // failed"). Try each mirror; on a mirror failure, wait briefly and try next.
  let lastErr;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180_000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent":
              "PlayScorePlus-ETL/1.0 (https://github.com/; contact x.ellen@gmail.com)",
            Accept: "application/json",
          },
          body: "data=" + encodeURIComponent(ql),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status === 504) {
          lastErr = new Error(`Overpass ${url} busy (HTTP ${res.status})`);
          await sleep(3000);
          continue;
        }
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status} (${url})`);
        const json = await res.json();
        return json.elements ?? [];
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        await sleep(1500);
      }
    }
  }
  throw lastErr ?? new Error("Overpass: all mirrors failed");
}

/** Extract [lon, lat] from an Overpass element (node lat/lon or way/rel center). */
function elementLonLat(el) {
  if (typeof el.lon === "number" && typeof el.lat === "number") {
    return [el.lon, el.lat];
  }
  if (el.center) return [el.center.lon, el.center.lat];
  return null;
}

// Each category is: { key: leafKey, reverse?: bool, filters: [overpass selectors] }.
// The selectors are combined into ONE query (union) per category and appended
// with (bbox). A category may also carry a `match(el)` predicate to further
// filter returned elements client-side (e.g. name /montessori/i).
const CATEGORIES = [
  {
    key: "space_for_play",
    filters: [
      'nwr["leisure"="park"]',
      'nwr["leisure"="playground"]',
      'nwr["leisure"="pitch"]',
    ],
  },
  {
    key: "destinations",
    filters: [
      'nwr["amenity"="school"]',
      'nwr["amenity"="library"]',
      'nwr["amenity"="community_centre"]',
      'nwr["amenity"="kindergarten"]',
    ],
  },
  {
    key: "natural_env",
    filters: [
      'nwr["leisure"="park"]',
      'nwr["natural"="water"]',
      'nwr["natural"="wood"]',
    ],
  },
  {
    // REVERSE: fewer big roads = calmer traffic environment = higher score.
    key: "traffic_env",
    reverse: true,
    filters: [
      'way["highway"="primary"]',
      'way["highway"="secondary"]',
      'way["highway"="trunk"]',
    ],
  },
  {
    // Walkability proxy: everyday POI density + pedestrian ways.
    key: "walk",
    filters: [
      'nwr["shop"]',
      'nwr["amenity"~"^(cafe|restaurant|pharmacy|bank|marketplace|fast_food|bakery)$"]',
      'way["highway"="footway"]',
      'way["highway"="pedestrian"]',
    ],
  },
  {
    key: "transit_bus",
    filters: [
      'node["highway"="bus_stop"]',
      'node["public_transport"="platform"]["bus"="yes"]',
    ],
  },
  {
    key: "transit_subway",
    filters: [
      'node["station"="subway"]',
      'nwr["railway"="station"]["station"="subway"]',
    ],
  },
  {
    key: "transit_streetcar",
    filters: ['node["railway"="tram_stop"]'],
  },
  {
    // Regional rail stations (GO Transit approximation). Exclude subway stations.
    key: "transit_go",
    filters: ['nwr["railway"="station"]'],
    match: (el) =>
      (el.tags?.station ?? "") !== "subway" &&
      (el.tags?.subway ?? "") !== "yes",
  },
  {
    key: "bike_lanes",
    filters: ['way["highway"="cycleway"]', 'way["cycleway"]', 'way["bicycle"="designated"]'],
  },
  {
    // Cycling-safety proxy: presence of protected/dedicated cycling infra.
    key: "bike_safety",
    filters: [
      'way["highway"="cycleway"]',
      'way["cycleway"~"track|lane|separate"]',
    ],
  },
  {
    key: "bike_share",
    filters: [
      'nwr["amenity"="bicycle_rental"]',
      'nwr["network"="Bike Share Toronto"]',
    ],
  },
  {
    // Alternative & enriched education: Montessori/Waldorf method schools plus
    // enriched programs (IB, gifted, TOPS, MaST, UTS, alternative schools).
    key: "edu_montessori",
    filters: [
      'nwr["amenity"~"^(school|kindergarten|childcare)$"]',
    ],
    match: (el) =>
      /montessori|waldorf|steiner|international baccalaureate|\bib\b|gifted|alternative|\btops\b|\bmast\b|university of toronto schools|\buts\b/i.test(
        el.tags?.name ?? "",
      ),
  },
  {
    key: "edu_daycare",
    filters: [
      'nwr["amenity"="childcare"]',
      'nwr["amenity"="kindergarten"]',
    ],
  },
  {
    // After-school programs: approximate with childcare + community centres.
    key: "edu_afterschool",
    filters: [
      'nwr["amenity"="childcare"]',
      'nwr["amenity"="community_centre"]',
    ],
  },
  {
    // Kindergarten – Grade 8 (elementary + middle schools combined).
    // Secondary schools are excluded where a name/ISCED signal exists.
    key: "edu_k8",
    filters: ['nwr["amenity"="school"]'],
    match: (el) => {
      const t = el.tags ?? {};
      const isced = String(t["isced:level"] ?? "");
      const name = (t.name ?? "").toLowerCase();
      if (/secondary|high school|collegiate/.test(name)) return false;
      if (isced && !/0|1|2/.test(isced)) return false;
      return true;
    },
  },
  {
    // Secondary (9–12).
    key: "edu_9_12",
    filters: ['nwr["amenity"="school"]'],
    match: (el) => {
      const t = el.tags ?? {};
      const name = (t.name ?? "").toLowerCase();
      const isced = String(t["isced:level"] ?? "");
      if (/secondary|high school|collegiate|institute/.test(name)) return true;
      if (isced && /3/.test(isced)) return true;
      // if no signal, count all schools (documented approximation)
      return !isced && !/element|junior public|montessori/.test(name);
    },
  },
  {
    key: "edu_private",
    filters: ['nwr["amenity"="school"]'],
    match: (el) => {
      const t = el.tags ?? {};
      const name = (t.name ?? "").toLowerCase();
      return (
        t["operator:type"] === "private" ||
        t.fee === "yes" ||
        /private|academy|independent/.test(name)
      );
    },
  },
  // NOTE: edu_fraser is intentionally NOT sourced. Fraser Institute school
  // report-card ratings are proprietary; the app fills a modeled value.
];

// Normalize a name for fuzzy joining (strip area-code suffixes, punctuation).
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(\d+\)/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// -----------------------------------------------------------------------------
// Fetch surrounding GTA municipality boundaries and return them as an array of
// GeoJSON Features whose properties.AREA_NAME is the municipality name. Only the
// municipalities in GTA_MUNICIPALITY_NAMES are kept; a whole-Toronto CSD is
// excluded (Toronto is already covered by the 158 neighbourhoods).
//
// FULLY DEFENSIVE: tries each URL in GTA_MUNICIPALITIES_SOURCE in order, wraps
// everything in try/catch, and on any failure / unexpected shape logs a warning
// and returns [] so the caller continues with Toronto neighbourhoods only.
async function fetchGtaMunicipalities() {
  // Precompute normalized keep/exclude sets for robust name matching.
  const keepByNorm = new Map();
  for (const nm of GTA_MUNICIPALITY_NAMES) keepByNorm.set(normName(nm), nm);
  const excludeNorm = new Set(GTA_EXCLUDE_NAMES.map((n) => normName(n)));

  // Pull a municipality name out of a feature's properties, probing known keys.
  function readMuniName(props) {
    if (!props || typeof props !== "object") return null;
    for (const k of MUNI_NAME_KEYS) {
      const v = props[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  }

  for (const url of GTA_MUNICIPALITIES_SOURCE) {
    try {
      console.log(`Fetching GTA municipality boundaries: ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  municipality source HTTP ${res.status}; trying next.`);
        continue;
      }
      const json = await res.json();
      const feats = Array.isArray(json?.features) ? json.features : null;
      if (!feats || feats.length === 0) {
        console.warn("  unexpected shape (no features array); trying next.");
        continue;
      }

      const kept = [];
      const seen = new Set();
      for (const f of feats) {
        const geom = f?.geometry;
        if (
          !geom ||
          (geom.type !== "Polygon" && geom.type !== "MultiPolygon")
        ) {
          continue;
        }
        const rawName = readMuniName(f.properties);
        if (!rawName) continue;
        const norm = normName(rawName);
        if (excludeNorm.has(norm)) continue; // skip whole-Toronto CSD
        const canonical = keepByNorm.get(norm);
        if (!canonical) continue; // not in the GTA keep-list
        if (seen.has(norm)) continue; // dedupe repeated CSDs
        seen.add(norm);
        kept.push({
          type: "Feature",
          geometry: geom,
          // Each municipality becomes ONE area, named by AREA_NAME so it flows
          // through the same normalization/scoring as Toronto neighbourhoods.
          properties: { AREA_NAME: canonical },
        });
      }

      if (kept.length === 0) {
        console.warn(
          "  no GTA municipalities matched the keep-list; trying next source.",
        );
        continue;
      }
      console.log(
        `  merged ${kept.length} GTA municipalities: ${kept
          .map((k) => k.properties.AREA_NAME)
          .join(", ")}`,
      );
      return kept;
    } catch (err) {
      console.warn(
        `  municipality source failed (${err.message}); trying next.`,
      );
    }
  }

  console.warn(
    "Could not fetch any GTA municipality boundaries; continuing with " +
      "Toronto neighbourhoods only.",
  );
  return [];
}

// -----------------------------------------------------------------------------
// Fetch + parse the Neighbourhood Profiles CSV via CKAN (same shape/approach as
// the API route). Returns a map keyed by neighbourhood NAME.
// -----------------------------------------------------------------------------
async function fetchNeighbourhoodProfiles() {
  console.log("Looking up Neighbourhood Profiles package via CKAN…");
  const pkgRes = await fetch(
    `${CKAN_BASE}/package_show?id=${PROFILES_PACKAGE_ID}`,
  );
  if (!pkgRes.ok) throw new Error(`CKAN package_show HTTP ${pkgRes.status}`);
  const pkg = await pkgRes.json();
  const resources = pkg?.result?.resources ?? [];
  const csv = resources.find(
    (r) => (r.format || "").toLowerCase() === "csv" && (r.url || r.download_url),
  );
  if (!csv) {
    console.warn("No CSV resource found in Neighbourhood Profiles; skipping census join.");
    return {};
  }
  const csvUrl = csv.download_url || csv.url;
  console.log(`Fetching profiles CSV: ${csvUrl}`);
  const csvRes = await fetch(csvUrl);
  if (!csvRes.ok) throw new Error(`Profiles CSV HTTP ${csvRes.status}`);
  const text = await csvRes.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return {};

  const header = rows[0].map((h) => (h || "").trim());
  const metaHeaderRe =
    /^(_id|id|category|topic|data\s*source|characteristic|attribute)$/i;
  let firstNbhdCol = 0;
  for (let c = 0; c < header.length; c++) {
    if (metaHeaderRe.test(header[c])) firstNbhdCol = c + 1;
  }
  if (firstNbhdCol === 0) firstNbhdCol = 1;

  const nbhdNames = header.slice(firstNbhdCol);

  function findRow(pred) {
    return rows.find((r) => {
      const label = (r[firstNbhdCol - 1] || r[0] || "").trim();
      return pred(label.toLowerCase());
    });
  }

  const popRow = findRow(
    (l) => l.includes("population, 2021") || l === "population",
  );
  const densityRow = findRow((l) => l.includes("population density"));
  const under15Row = findRow(
    (l) => l.includes("0 to 14 years") || l.includes("under 15"),
  );
  const lowIncomeRow = findRow(
    (l) =>
      l.includes("low-income") &&
      (l.includes("prevalence") || l.includes("lim-at")),
  );

  const byName = {};
  nbhdNames.forEach((rawName, idx) => {
    const name = (rawName || "").trim();
    if (!name) return;
    const col = firstNbhdCol + idx;
    const record = {};
    const population = popRow ? toNumber(popRow[col]) : null;
    const pop_density = densityRow ? toNumber(densityRow[col]) : null;
    const under15 = under15Row ? toNumber(under15Row[col]) : null;
    const low_income_prop = lowIncomeRow ? toNumber(lowIncomeRow[col]) : null;

    if (population != null) record.population = population;
    if (pop_density != null) record.pop_density = pop_density;
    if (under15 != null && population) {
      record.children_under15_prop =
        Math.round((under15 / population) * 1000) / 10;
    }
    if (low_income_prop != null) record.low_income_prop = low_income_prop;
    byName[name] = record;
  });

  console.log(
    `Parsed census profiles for ${Object.keys(byName).length} neighbourhoods.`,
  );
  return byName;
}

// -----------------------------------------------------------------------------
// Main.
// -----------------------------------------------------------------------------
async function main() {
  console.log("Fetching Toronto neighbourhood boundaries…");
  const res = await fetch(TORONTO_GEOJSON_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} from Toronto Open Data`);
  const raw = await res.json();
  const boundary = raw.features;
  console.log(`Got ${boundary.length} Toronto neighbourhood boundaries.`);

  // ALSO fetch surrounding GTA municipality boundaries and MERGE them into the
  // same feature set (each municipality = one area). Fully defensive: on any
  // failure this returns [] and we proceed with Toronto neighbourhoods only.
  try {
    const munis = await fetchGtaMunicipalities();
    if (munis.length > 0) {
      boundary.push(...munis);
      console.log(
        `Merged ${munis.length} GTA municipalities; ${boundary.length} total areas.`,
      );
    }
  } catch (err) {
    console.warn(
      `GTA municipality merge failed (${err.message}); Toronto only.`,
    );
  }

  // Precompute bboxes for fast point-in-polygon over the FULL merged set.
  const bboxes = boundary.map((f) => featureBBox(f.geometry));

  // Per-neighbourhood accumulated scores.
  const scores = boundary.map(() => ({}));

  // Assign a set of Overpass elements to neighbourhoods -> count array.
  function countByNeighbourhood(elements, match) {
    const counts = new Array(boundary.length).fill(0);
    for (const el of elements) {
      if (match && !match(el)) continue;
      const ll = elementLonLat(el);
      if (!ll) continue;
      const [lon, lat] = ll;
      for (let i = 0; i < boundary.length; i++) {
        const bb = bboxes[i];
        if (lon < bb.minLon || lon > bb.maxLon || lat < bb.minLat || lat > bb.maxLat)
          continue;
        if (pointInFeature(lon, lat, boundary[i].geometry)) {
          counts[i]++;
          break;
        }
      }
    }
    return counts;
  }

  // Run ONE Overpass query per category (sequential, polite delay, try/catch).
  for (const cat of CATEGORIES) {
    try {
      const query = cat.filters.map((f) => `${f}(${BBOX_STR});`).join("");
      console.log(`Overpass: category ${cat.key} (${cat.filters.length} selectors)…`);
      const elements = await overpass(query);
      console.log(`  ${elements.length} elements returned; assigning…`);
      const counts = countByNeighbourhood(elements, cat.match);
      const total = counts.reduce((a, b) => a + b, 0);
      if (total === 0) {
        console.warn(`  no data for ${cat.key}; leaving leaf OUT (app models it).`);
      } else {
        const normalized = rankNormalize(counts, cat.reverse);
        for (let i = 0; i < boundary.length; i++) {
          scores[i][cat.key] = normalized[i];
        }
        console.log(`  scored ${cat.key} (${total} assigned points).`);
      }
    } catch (err) {
      console.warn(`  category ${cat.key} failed (${err.message}); skipping.`);
    }
    await sleep(1000); // be polite to the public Overpass endpoint
  }

  // Census join (best-effort). NOTE: the Toronto Neighbourhood Profiles CSV
  // only covers Toronto's 158 neighbourhoods, so the added GTA municipalities
  // will NOT match here — that's intentional. Their census (population/density/
  // low-income/children and the social_env proxy) is left to the app's modeled
  // fallback in src/lib/mockScores.ts. Toronto neighbourhoods still get real
  // census.
  let census = {};
  try {
    census = await fetchNeighbourhoodProfiles();
  } catch (err) {
    console.warn(`Census join failed (${err.message}); proceeding without it.`);
  }
  const censusByNorm = {};
  for (const [name, rec] of Object.entries(census)) {
    censusByNorm[normName(name)] = rec;
  }

  // social_env proxy: normalized proportion of children under 15 across the
  // city (rank/percentile), computed from census children %.
  const childProps = boundary.map((f) => {
    const p = f.properties ?? {};
    const name = p.AREA_NAME ?? p.AREA_DESC ?? "Unknown";
    const rec =
      census[name] ??
      censusByNorm[normName(name)] ??
      censusByNorm[normName(p.AREA_SHORT_CODE)] ??
      null;
    return rec && typeof rec.children_under15_prop === "number"
      ? rec.children_under15_prop
      : null;
  });
  if (childProps.some((v) => v != null)) {
    // rank only the ones we have; leave others out
    const present = childProps.map((v, i) => ({ v, i })).filter((o) => o.v != null);
    const vals = present.map((o) => o.v);
    const normed = rankNormalize(vals, false);
    present.forEach((o, k) => {
      scores[o.i].social_env = normed[k];
    });
    console.log(`Derived social_env proxy for ${present.length} neighbourhoods.`);
  }

  let joined = 0;
  const features = boundary.map((f, i) => {
    const p = f.properties ?? {};
    const name = p.AREA_NAME ?? p.AREA_DESC ?? "Unknown";
    const matched =
      census[name] ??
      censusByNorm[normName(name)] ??
      censusByNorm[normName(p.AREA_SHORT_CODE)] ??
      null;
    if (matched) joined++;

    const properties = {
      AREA_NAME: name,
      AREA_SHORT_CODE: p.AREA_SHORT_CODE,
      // Real OSM/census-derived 0–100 leaf sub-scores. Any leaf not present here
      // (e.g. edu_fraser — proprietary) is filled with a modeled value by
      // src/lib/mockScores.ts enrichFeatures() at runtime.
      scores: scores[i],
    };
    if (matched && Object.keys(matched).length > 0) {
      properties.census = matched;
    }

    return {
      type: "Feature",
      geometry: f.geometry, // already EPSG:4326
      properties,
    };
  });

  console.log(
    `Joined real census onto ${joined}/${features.length} neighbourhoods.`,
  );

  const fc = { type: "FeatureCollection", features };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(fc) + "\n");
  console.log(`Wrote ${features.length} features to ${OUT}`);
  console.log(
    "Note: edu_fraser and the exact playability domain weighting remain " +
      "modeled/approximate; all other leaves + census are real (OSM/open census).",
  );
}

main().catch((err) => {
  console.error("fetch-data failed:", err.message);
  console.error(
    "If this is a sandbox/CI without external network, run it locally instead.",
  );
  process.exit(1);
});
