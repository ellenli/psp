// ---------------------------------------------------------------------------
// Deterministic seeded sub-score + census generation.
//
// TODO: replace with real Can-ALE (walk), GTFS (transit), Can-BICS (bike),
// 2021 Census (characteristics) — see scripts/fetch-data.mjs.
//
// Every value below is a *placeholder* with plausible spatial structure so the
// app is fully interactive offline. Generation is seeded off the neighbourhood
// name so values are stable across reloads and across the sample/real datasets.
// ---------------------------------------------------------------------------

import type { LeafMetricKey } from "./metrics";
import { ALL_LEAF_KEYS } from "./metrics";
import type { NeighbourhoodFeature } from "./types";

/** Small deterministic string hash (FNV-1a-ish). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 seeded PRNG -> [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Generate deterministic 0–100 sub-scores for one neighbourhood by name. */
export function scoresFor(name: string): Record<LeafMetricKey, number> {
  const rng = mulberry32(hashString(name));
  // A latent "central-ness" factor gives correlated spatial structure: places
  // that score well on transit tend to score well on walk, etc.
  const latent = rng();
  const out = {} as Record<LeafMetricKey, number>;
  for (const key of ALL_LEAF_KEYS) {
    // blend latent factor (70%) with per-metric noise (30%)
    const noise = rng();
    const v = latent * 0.7 + noise * 0.3;
    out[key] = Math.round(clamp(v * 100, 0, 100));
  }
  return out;
}

/** Generate deterministic census characteristics for one neighbourhood. */
export function censusFor(name: string): NonNullable<
  NeighbourhoodFeature["properties"]["census"]
> {
  const rng = mulberry32(hashString(name + "::census"));
  const population = Math.round(6000 + rng() * 34000); // 6k–40k
  const pop_density = Math.round(1500 + rng() * 13500); // persons/km²
  const low_income_prop = Math.round((4 + rng() * 26) * 10) / 10; // 4–30 %
  const children_under15_prop = Math.round((8 + rng() * 14) * 10) / 10; // 8–22 %
  return { population, pop_density, low_income_prop, children_under15_prop };
}

/**
 * Enrich a neighbourhood FeatureCollection (real or sample) in place-by-copy:
 * attaches `scores`, `census`, and a rough `centroid` derived from geometry to
 * every feature that lacks them. Idempotent.
 */
export function enrichFeatures(
  features: NeighbourhoodFeature[],
): NeighbourhoodFeature[] {
  return features.map((f) => {
    const name = f.properties.AREA_NAME ?? "Unknown";
    const centroid = f.properties.centroid ?? computeCentroid(f);
    // Real ETL data compat: older datasets carry separate edu_k6/edu_6_8
    // sub-scores; the UI now uses a single merged edu_k8 (K–grade 8).
    let scores = f.properties.scores;
    if (scores) {
      const raw = scores as unknown as Record<string, number>;
      if (typeof raw.edu_k8 !== "number") {
        const parts = [raw.edu_k6, raw.edu_6_8].filter(
          (v): v is number => typeof v === "number",
        );
        if (parts.length > 0) {
          scores = {
            ...scores,
            edu_k8: Math.round(
              parts.reduce((a, b) => a + b, 0) / parts.length,
            ),
          };
        }
      }
    }
    return {
      ...f,
      properties: {
        ...f.properties,
        AREA_NAME: name,
        scores: scores ?? scoresFor(name),
        census: f.properties.census ?? censusFor(name),
        centroid,
      },
    };
  });
}

/** Rough centroid [lon, lat] from the first ring of a polygon/multipolygon. */
export function computeCentroid(f: NeighbourhoodFeature): [number, number] {
  let ring: number[][] = [];
  if (f.geometry.type === "Polygon") {
    ring = (f.geometry.coordinates as number[][][])[0] ?? [];
  } else {
    ring = ((f.geometry.coordinates as number[][][][])[0] ?? [])[0] ?? [];
  }
  if (ring.length === 0) return [-79.38, 43.65];
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return [lon / ring.length, lat / ring.length];
}
