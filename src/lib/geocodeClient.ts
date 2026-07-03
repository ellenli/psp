// ---------------------------------------------------------------------------
// Geocoding client. The real lookup runs SERVER-SIDE via the same-origin
// `/api/geocode` route (Google Geocoding when a key is set, else Nominatim
// query-variants, else Photon). This module keeps a module-level cache for
// successful lookups; misses are NOT cached so a transient failure can retry.
// ---------------------------------------------------------------------------

export interface GeocodeResult {
  coord: [number, number];
  /** Resolved display label (e.g. formatted address), when available. */
  label: string | null;
}

/** Module-level cache: normalized query -> result (successes only). */
const cache = new Map<string, GeocodeResult>();

/**
 * Geocode a free-text query to a full result, or `null` if it can't be
 * resolved. Any network or parse error returns `null`.
 */
export async function geocodeDetail(
  query: string,
): Promise<GeocodeResult | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hit = cache.get(q);
  if (hit) return hit;

  try {
    const res = await fetch(
      "/api/geocode?q=" + encodeURIComponent(query.trim()),
      // Client-side ceiling so the UI always resolves (server budget is 16s).
      { signal: AbortSignal.timeout(20000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      coord?: [number, number] | null;
      label?: string | null;
    };
    if (!json.coord) return null;
    const result: GeocodeResult = {
      coord: json.coord,
      label: json.label ?? null,
    };
    cache.set(q, result);
    return result;
  } catch {
    return null;
  }
}

/** Geocode a free-text query to `[lon, lat]`, or `null`. */
export async function geocode(query: string): Promise<[number, number] | null> {
  const result = await geocodeDetail(query);
  return result?.coord ?? null;
}
