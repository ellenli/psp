import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sample from "@/data/sample-neighbourhoods.json";
import { enrichFeatures } from "@/lib/mockScores";
import type { NeighbourhoodCollection, NeighbourhoodFeature } from "@/lib/types";

// Real City of Toronto neighbourhoods (158 areas, EPSG:4326). Reachable from
// the browser/Vercel; may be blocked in some build environments — we cache the
// success and fall back to the committed sample on any failure.
const TORONTO_GEOJSON_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/fc443770-ef0a-4025-9c2c-2cb558bfab00/resource/0719053b-28b7-48ea-b863-068823a93aaa/download/neighbourhoods-4326.geojson";

// City of Toronto Neighbourhood Profiles (census-derived) via CKAN.
const NEIGHBOURHOOD_PROFILES_PACKAGE =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=neighbourhood-profiles";

// Cache the upstream fetch on the server for a day.
export const revalidate = 86400;

interface RawFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: NeighbourhoodFeature["geometry"];
}

/** Partial real census values keyed by lowercased neighbourhood name. */
type CensusPatch = Partial<
  NonNullable<NeighbourhoodFeature["properties"]["census"]>
>;

/** Normalize City of Toronto feature properties to our schema, then enrich. */
function normalize(
  collection: { features: RawFeature[] },
  source: string,
): NeighbourhoodCollection & { source: string } {
  const features: NeighbourhoodFeature[] = collection.features.map((f) => {
    const props = f.properties ?? {};
    const name =
      (props.AREA_NAME as string) ??
      (props.AREA_NA7 as string) ??
      (props.AREA_DESC as string) ??
      "Unknown";
    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        AREA_NAME: name,
        AREA_SHORT_CODE: props.AREA_SHORT_CODE as string | number | undefined,
      },
    };
  });
  return {
    type: "FeatureCollection",
    features: enrichFeatures(features),
    source,
  };
}

/** Minimal RFC-4180-ish CSV parser handling quoted fields and embedded commas. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
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

function toNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,$%\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch & parse the Toronto Neighbourhood Profiles CSV and build a map of
 * lowercased neighbourhood name -> real census patch. The profiles CSV is a
 * "wide" table: column 0 holds the characteristic label and the remaining
 * columns are one-per-neighbourhood (header row 0 = neighbourhood names).
 *
 * NOTE: characteristic row labels vary by release, so this is best-effort —
 * we match by case-insensitive substring and keep modeled values otherwise.
 * Everything is wrapped so any failure returns an empty map.
 */
async function fetchRealCensus(): Promise<Map<string, CensusPatch>> {
  const out = new Map<string, CensusPatch>();
  try {
    const pkgRes = await fetch(NEIGHBOURHOOD_PROFILES_PACKAGE, {
      next: { revalidate },
    });
    if (!pkgRes.ok) return out;
    const pkg = (await pkgRes.json()) as {
      result?: {
        resources?: {
          format?: string;
          url?: string;
          download_url?: string;
        }[];
      };
    };
    const resources = pkg.result?.resources ?? [];
    const csvResource = resources.find(
      (r) => (r.format ?? "").toUpperCase() === "CSV",
    );
    const csvUrl = csvResource?.download_url ?? csvResource?.url;
    if (!csvUrl) return out;

    const csvRes = await fetch(csvUrl, { next: { revalidate } });
    if (!csvRes.ok) return out;
    const text = await csvRes.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return out;

    // Header row: neighbourhood names live in columns 1..N.
    const header = rows[0];
    const nameCols: { col: number; name: string }[] = [];
    for (let c = 1; c < header.length; c++) {
      const nm = (header[c] ?? "").trim();
      if (nm) nameCols.push({ col: c, name: nm });
    }
    if (nameCols.length === 0) return out;

    // Locate the first matching row per characteristic (case-insensitive
    // substring on the row label in column 0).
    function findRow(...needles: string[]): string[] | null {
      for (const r of rows) {
        const label = (r[0] ?? "").toLowerCase();
        if (needles.some((nd) => label.includes(nd))) return r;
      }
      return null;
    }

    const popRow = findRow("population, 2021", "population, 2016", "population");
    const childRow = findRow("0 to 14 years", "children");
    const lowIncomeRow = findRow(
      "prevalence of low income",
      "low income",
    );
    const densityRow = findRow(
      "population density per square",
      "persons per square",
      "population density",
    );

    for (const { col, name } of nameCols) {
      const patch: CensusPatch = {};
      const population = popRow ? toNumber(popRow[col] ?? "") : null;
      if (population !== null) patch.population = population;

      const density = densityRow ? toNumber(densityRow[col] ?? "") : null;
      if (density !== null) patch.pop_density = density;

      const low = lowIncomeRow ? toNumber(lowIncomeRow[col] ?? "") : null;
      if (low !== null) patch.low_income_prop = low;

      const children = childRow ? toNumber(childRow[col] ?? "") : null;
      if (children !== null && population && population > 0) {
        // Children count -> proportion (%). If the value already looks like a
        // percentage (<= 100 and much smaller than population) keep as-is.
        if (children <= 100 && children < population) {
          patch.children_under15_prop =
            Math.round((children / population) * 1000) / 10;
        } else {
          patch.children_under15_prop = children;
        }
      }

      if (Object.keys(patch).length > 0) {
        out.set(name.toLowerCase(), patch);
      }
    }
  } catch {
    // Silent fallback: empty map -> modeled census retained.
  }
  return out;
}

/**
 * Join real census patches onto normalized features, keeping modeled values
 * for anything not found. Match by lowercased AREA_NAME.
 */
function applyRealCensus(
  collection: NeighbourhoodCollection & { source: string },
  patches: Map<string, CensusPatch>,
): NeighbourhoodCollection & { source: string } {
  if (patches.size === 0) return collection;
  let joined = 0;
  const features = collection.features.map((f) => {
    const name = (f.properties.AREA_NAME ?? "").toLowerCase();
    const patch = patches.get(name);
    if (!patch || !f.properties.census) return f;
    joined++;
    return {
      ...f,
      properties: {
        ...f.properties,
        census: { ...f.properties.census, ...patch },
      },
    };
  });
  return {
    ...collection,
    features,
    source:
      joined > 0 ? `${collection.source}+real-census` : collection.source,
  };
}

/**
 * Try to read a committed real dataset produced by scripts/fetch-data.mjs.
 * Returns null (never throws) when the file is missing or unparseable, so the
 * route falls through to live-fetch → sample-fallback.
 */
async function readLocalRealData(): Promise<
  (NeighbourhoodCollection & { source: string }) | null
> {
  try {
    const filePath = path.join(
      process.cwd(),
      "public/data/neighbourhoods.json",
    );
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as { features?: RawFeature[] };
    if (!parsed?.features?.length) return null;
    return normalize({ features: parsed.features }, "local-real-data");
  } catch {
    return null;
  }
}

export async function GET() {
  // Best-effort real census join; empty map on any failure (modeled retained).
  const censusPatches = await fetchRealCensus();

  // 1. Prefer a committed real dataset if present.
  const local = await readLocalRealData();
  if (local) return NextResponse.json(applyRealCensus(local, censusPatches));

  try {
    const res = await fetch(TORONTO_GEOJSON_URL, {
      next: { revalidate },
    });
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = (await res.json()) as { features: RawFeature[] };
    if (!data?.features?.length) throw new Error("Empty upstream response");
    return NextResponse.json(
      applyRealCensus(normalize(data, "toronto-open-data"), censusPatches),
    );
  } catch {
    // Fallback: committed sample dataset (works fully offline).
    return NextResponse.json(
      applyRealCensus(
        normalize(
          sample as unknown as { features: RawFeature[] },
          "sample-fallback",
        ),
        censusPatches,
      ),
    );
  }
}
