import type { LeafMetricKey } from "./metrics";
import type { NeighbourhoodFeature } from "./types";

/**
 * Composite score for a single feature = unweighted mean of the selected leaf
 * metric sub-scores (each 0–100). Returns null when nothing is selected or the
 * feature has no scores (rendered as NA / grey).
 */
export function compositeScore(
  feature: NeighbourhoodFeature,
  selected: LeafMetricKey[],
): number | null {
  const scores = feature.properties.scores;
  if (!scores || selected.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const key of selected) {
    const v = scores[key];
    if (typeof v === "number" && !Number.isNaN(v)) {
      sum += v;
      n += 1;
    }
  }
  if (n === 0) return null;
  return sum / n;
}

/**
 * ntile-equivalent: assign each value to one of `bins` quantile buckets (0..bins-1)
 * computed over the non-null values supplied. Mirrors SQL `ntile()` / dplyr ntile().
 * Returns a Map keyed by array index. Null values map to null (NA).
 */
export function ntile(
  values: (number | null)[],
  bins = 10,
): (number | null)[] {
  const indexed = values
    .map((v, i) => ({ v, i }))
    .filter((d): d is { v: number; i: number } => d.v !== null);

  const result: (number | null)[] = values.map(() => null);
  const n = indexed.length;
  if (n === 0) return result;

  indexed.sort((a, b) => a.v - b.v);
  // ntile spec: first (n mod bins) groups get one extra element.
  const base = Math.floor(n / bins);
  const remainder = n % bins;
  let pos = 0;
  for (let bucket = 0; bucket < bins; bucket++) {
    const size = base + (bucket < remainder ? 1 : 0);
    for (let k = 0; k < size && pos < n; k++, pos++) {
      result[indexed[pos].i] = bucket;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Palette helpers
// ---------------------------------------------------------------------------

/**
 * Reversed RdYlBu, 10 discrete bins. Index 0 (lowest decile) = dark red,
 * index 9 (highest decile) = dark blue. Used for the score choropleth.
 */
export const RDYLBU_REVERSED_10: string[] = [
  "#a50026", // 0 lowest
  "#d73027",
  "#f46d43",
  "#fdae61",
  "#fee090",
  "#e0f3f8",
  "#abd9e9",
  "#74add1",
  "#4575b4",
  "#313695", // 9 highest
];

/** Sequential Reds, 10 bins, for the census choropleth (light -> dark). */
export const REDS_10: string[] = [
  "#fff5f0",
  "#fee0d2",
  "#fcbba1",
  "#fc9272",
  "#fb6a4a",
  "#ef3b2c",
  "#cb181d",
  "#a50f15",
  "#67000d",
  "#400007",
];

export const NA_COLOR = "#cccccc";

/** Color for a score decile bin (0..9) or null (NA). */
export function scoreColor(decile: number | null): string {
  if (decile === null || decile < 0) return NA_COLOR;
  return RDYLBU_REVERSED_10[Math.min(9, decile)];
}

/** Color for a census decile bin (0..9) or null (NA). */
export function censusColor(decile: number | null): string {
  if (decile === null || decile < 0) return NA_COLOR;
  return REDS_10[Math.min(9, decile)];
}

/** Human label for a decile bin, e.g. "0–1". */
export function decileLabel(bin: number): string {
  return `${bin}–${bin + 1}`;
}
