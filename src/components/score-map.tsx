"use client";

import * as React from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  useMap,
  Marker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { GeoJsonObject } from "geojson";
import type { Layer, LeafletMouseEvent, PathOptions } from "leaflet";
import type { NeighbourhoodFeature } from "@/lib/types";
import { decileLabel } from "@/lib/score";
import { emojiForTag } from "@/lib/emoji";

// ---------------------------------------------------------------------------
// REAL places only. Markers come from the server-side /api/places route:
// Google Places (name, address, star rating, review count, real Google Maps
// listing link) when a key is configured, else OpenStreetMap (name, address,
// Maps search link — no rating, because ratings don't exist in free data).
// There is NO synthetic fallback: if nothing real is available, nothing is
// shown.
// ---------------------------------------------------------------------------

/** A real nearby place from /api/places. */
interface LivePlace {
  id: string;
  lat: number;
  lon: number;
  tag: string;
  emoji: string;
  name: string;
  popularity: number;
  rating: number | null;
  reviews: number | null;
  address: string | null;
  mapsUrl: string;
}

interface PlacesResponse {
  places?: {
    id: string;
    name: string;
    rating: number | null;
    reviews: number | null;
    address: string | null;
    lat: number;
    lon: number;
    mapsUrl: string;
  }[];
  source?: string;
}

/** Fetch real places for each tag within the viewport bbox [s,w,n,e]. */
async function fetchNearbyPlaces(
  bbox: [number, number, number, number],
  tags: string[],
  tagEmoji: Record<string, string>,
): Promise<LivePlace[]> {
  const cleanTags = tags.map((t) => t.trim()).filter(Boolean);
  if (cleanTags.length === 0) return [];
  const [s, w, n, e] = bbox;
  const perTag = await Promise.all(
    cleanTags.map(async (tag) => {
      try {
        const url =
          `/api/places?q=${encodeURIComponent(tag)}` +
          `&s=${s}&w=${w}&n=${n}&e=${e}`;
        const res = await fetch(url);
        if (!res.ok) return [] as LivePlace[];
        const json = (await res.json()) as PlacesResponse;
        return (json.places ?? []).map<LivePlace>((pl) => ({
          id: `${tag}:${pl.id}`,
          lat: pl.lat,
          lon: pl.lon,
          tag,
          emoji: emojiForTag(tag, tagEmoji),
          name: pl.name,
          popularity: pl.reviews ?? 1,
          rating: pl.rating,
          reviews: pl.reviews,
          address: pl.address,
          mapsUrl: pl.mapsUrl,
        }));
      } catch {
        return [] as LivePlace[];
      }
    }),
  );
  return perTag.flat();
}

export interface MapFeatureDatum {
  /** decile bin 0..9 or null (NA) */
  decile: number | null;
  /** display value already formatted */
  valueLabel: string;
  color: string;
}

interface ScoreMapProps {
  features: NeighbourhoodFeature[];
  /** Per-feature (indexed parallel to `features`) styling + popup data. */
  data: MapFeatureDatum[];
  palette: string[];
  naColor: string;
  legendTitle: string;
  /** Bounds to fit: [[south, west],[north, east]] or null for default. */
  bounds: [[number, number], [number, number]] | null;
  onFeatureClick: (index: number) => void;
  /** Minimum zoom at which place markers appear. */
  markersMinZoom?: number;
  /** Free-text nearby tags to fetch REAL places for. */
  nearbyTags?: string[];
  /** Optional user emoji overrides per tag. */
  tagEmoji?: Record<string, string>;
  /** When true, hide the bottom-right score legend (e.g. detail panel open). */
  hideLegend?: boolean;
  /** Location to pan to + highlight (hovered POI in the results panel). */
  highlight?: { lat: number; lon: number } | null;
  /** Bounds of the clicked neighbourhood — the minimum context to keep in
   * view when navigating to a highlighted POI. */
  highlightContext?: [[number, number], [number, number]] | null;
  /**
   * When false, render regions with no fill (outline only), hide the legend,
   * and show a centered hint overlay. Defaults to true.
   */
  scored?: boolean;
}

/**
 * Fetches REAL nearby places for the current viewport (at/above `minZoom`),
 * debounced, and renders them as emoji markers with pixel-distance thinning.
 * Empty results are NOT cached, so a flaky upstream moment retries on the next
 * pan/zoom instead of leaving the viewport permanently empty.
 */
function LiveNearbyLayer({
  tags,
  tagEmoji,
  minZoom,
}: {
  tags: string[];
  tagEmoji: Record<string, string>;
  minZoom: number;
}) {
  const map = useMap();
  const [, setTick] = React.useState(0);
  const [live, setLive] = React.useState<LivePlace[]>([]);
  const [loading, setLoading] = React.useState(false);
  const cacheRef = React.useRef<Map<string, LivePlace[]>>(new Map());
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = React.useRef(0);
  const tagsKey = tags.join(",");

  useMapEvents({
    zoomend: () => setTick((t) => t + 1),
    moveend: () => setTick((t) => t + 1),
  });

  const zoom = map.getZoom();

  React.useEffect(() => {
    if (zoom < minZoom) return;
    const cleanTags = tags.map((t) => t.trim()).filter(Boolean);
    if (cleanTags.length === 0) {
      queueMicrotask(() => setLive([]));
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const b = map.getBounds();
      const s = b.getSouth();
      const w = b.getWest();
      const n = b.getNorth();
      const e = b.getEast();
      const r = (v: number) => Math.round(v * 100) / 100;
      const key = `${r(s)},${r(w)},${r(n)},${r(e)}|${tagsKey}`;
      const cached = cacheRef.current.get(key);
      if (cached) {
        setLive(cached);
        return;
      }
      const seq = ++requestSeq.current;
      setLoading(true);
      fetchNearbyPlaces([s, w, n, e], cleanTags, tagEmoji)
        .then((places) => {
          if (seq !== requestSeq.current) return;
          // Only cache non-empty results; empty may be a transient failure.
          if (places.length > 0) cacheRef.current.set(key, places);
          setLive(places);
          setLoading(false);
        })
        .catch(() => {
          if (seq !== requestSeq.current) return;
          setLive([]);
          setLoading(false);
        });
    }, 700);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, tagsKey, minZoom]);

  if (zoom < minZoom) return null;

  const minPx = Math.max(12, 56 - (zoom - minZoom) * 10);
  const sorted = [...live].sort((a, b) => b.popularity - a.popularity);
  const kept: { p: LivePlace; x: number; y: number }[] = [];
  for (const p of sorted) {
    if (kept.length >= 300) break;
    const pt = map.latLngToLayerPoint([p.lat, p.lon]);
    let ok = true;
    for (const k of kept) {
      const dx = pt.x - k.x;
      const dy = pt.y - k.y;
      if (dx * dx + dy * dy < minPx * minPx) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push({ p, x: pt.x, y: pt.y });
  }

  return (
    <>
      {loading && kept.length === 0 && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-[500] -translate-x-1/2 rounded-md border bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow">
          Finding real places…
        </div>
      )}
      {kept.map(({ p }) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lon]}
          icon={L.divIcon({
            html:
              '<div style="width:24px;height:24px;border-radius:9999px;background:#fff;border:1px solid rgba(0,0,0,0.18);box-shadow:0 1px 2px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;cursor:pointer">' +
              p.emoji +
              "</div>",
            className: "",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          })}
        >
          <Popup>
            <div style={{ minWidth: 160 }}>
              <div style={{ fontWeight: 600 }}>
                {p.emoji} {p.name}
              </div>
              {typeof p.rating === "number" && (
                <div style={{ marginTop: 2 }}>
                  ⭐ {p.rating.toFixed(1)}
                  {typeof p.reviews === "number" ? ` (${p.reviews})` : ""}
                </div>
              )}
              {p.address && (
                <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>
                  {p.address}
                </div>
              )}
              <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>
                {p.tag}
              </div>
              <a
                href={p.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: 6 }}
              >
                Open in Google Maps →
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

/**
 * Highlights a hovered POI with a pulsing ring and navigates sensibly:
 * - Baseline zoom keeps the WHOLE neighbourhood (plus the POI) in view.
 * - If the user has zoomed in further and the POI is already visible, the
 *   view is left alone.
 * - If they've zoomed in and the POI is out of view, the map flies to it
 *   while zooming out a notch so the move is less jarring.
 */
function HighlightLayer({
  point,
  context,
}: {
  point: { lat: number; lon: number } | null;
  context: [[number, number], [number, number]] | null;
}) {
  const map = useMap();
  React.useEffect(() => {
    if (!point) return;
    const target = L.latLng(point.lat, point.lon);
    const zoom = map.getZoom();
    // Zoom at which the neighbourhood + POI fully fit.
    const ctxBounds = context
      ? L.latLngBounds(context).extend(target)
      : L.latLngBounds([target, target]);
    const fitZoom = context
      ? map.getBoundsZoom(ctxBounds, false, L.point(32, 32))
      : zoom;

    // Keep the highlight front and center: the POI must land inside a
    // 200x200px box centered in the map viewport. Movement is MINIMAL — the
    // map pans just enough for the POI to enter the box (no jumping to dead
    // center), and only zooms when needed.
    const size = map.getSize();
    const boxHalfX = Math.min(200, size.x * 0.8) / 2;
    const boxHalfY = Math.min(200, size.y * 0.8) / 2;

    // 1. Pick the zoom: zoom IN to neighbourhood level when zoomed way out;
    //    otherwise keep the user's zoom.
    const targetZoom = zoom < fitZoom ? fitZoom : zoom;

    // 2. Where would the POI sit relative to the center at that zoom?
    const centerPt = map.project(map.getCenter(), targetZoom);
    const targetPt = map.project(target, targetZoom);
    const dx = targetPt.x - centerPt.x;
    const dy = targetPt.y - centerPt.y;

    // 3. Minimal shift that brings the POI inside the center box.
    let shiftX = 0;
    let shiftY = 0;
    if (dx > boxHalfX) shiftX = dx - boxHalfX;
    else if (dx < -boxHalfX) shiftX = dx + boxHalfX;
    if (dy > boxHalfY) shiftY = dy - boxHalfY;
    else if (dy < -boxHalfY) shiftY = dy + boxHalfY;

    if (targetZoom === zoom && shiftX === 0 && shiftY === 0) return;

    // Long hop while zoomed in close: drop a notch and center the POI so the
    // move reads smoothly instead of streaking across tiles.
    if (
      targetZoom > fitZoom &&
      (Math.abs(shiftX) > size.x || Math.abs(shiftY) > size.y)
    ) {
      map.flyTo(target, Math.max(fitZoom, targetZoom - 1), { duration: 0.6 });
      return;
    }

    const newCenter = map.unproject(
      centerPt.add(L.point(shiftX, shiftY)),
      targetZoom,
    );
    map.flyTo(newCenter, targetZoom, { duration: 0.5 });
  }, [point, context, map]);
  if (!point) return null;
  return (
    <Marker
      position={[point.lat, point.lon]}
      interactive={false}
      zIndexOffset={1000}
      icon={L.divIcon({
        html:
          '<div style="position:relative;width:36px;height:36px;pointer-events:none">' +
          '<span class="animate-ping" style="position:absolute;inset:0;border-radius:9999px;background:rgba(255,255,255,0.75)"></span>' +
          '<span style="position:absolute;inset:6px;border-radius:9999px;border:3px solid #ffffff;background:rgba(255,255,255,0.25);box-shadow:0 0 0 1.5px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.35)"></span>' +
          "</div>",
        className: "",
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      })}
    />
  );
}

function FitBounds({
  bounds,
}: {
  bounds: [[number, number], [number, number]] | null;
}) {
  const map = useMap();
  React.useEffect(() => {
    if (bounds) {
      // Always frame the provided data bounds tightly. For "All of the GTA"
      // this is the bbox over the loaded neighbourhoods; for a single selection
      // it's that feature.
      map.fitBounds(bounds, { padding: [16, 16] });
    } else {
      // Fallback (no features loaded yet): frame the full Greater Toronto Area,
      // a bbox spanning Oakville/Milton (SW) to Uxbridge/Clarington (NE).
      map.fitBounds(
        [
          [43.35, -79.95],
          [44.35, -78.65],
        ],
        { padding: [16, 16] },
      );
    }
  }, [bounds, map]);
  return null;
}

function Legend({
  title,
  palette,
  naColor,
}: {
  title: string;
  palette: string[];
  naColor: string;
}) {
  return (
    <div className="absolute bottom-2 right-2 z-[400] rounded-md border bg-background/95 p-2 text-[10px] shadow">
      <div className="mb-1 font-medium">{title}</div>
      <div className="flex flex-col gap-0.5">
        {palette.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: c }}
            />
            <span>{decileLabel(i)}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: naColor }}
          />
          <span>NA</span>
        </div>
      </div>
    </div>
  );
}

export default function ScoreMap({
  features,
  data,
  palette,
  naColor,
  legendTitle,
  bounds,
  onFeatureClick,
  markersMinZoom = 14,
  nearbyTags,
  tagEmoji,
  hideLegend = false,
  highlight = null,
  highlightContext = null,
  scored = true,
}: ScoreMapProps) {
  // Index features so styling/click can look up their datum.
  const collection = React.useMemo<GeoJsonObject>(() => {
    return {
      type: "FeatureCollection",
      features: features.map((f, i) => ({
        ...f,
        properties: { ...f.properties, __idx: i },
      })),
    } as GeoJsonObject;
  }, [features]);

  // Force GeoJSON re-render when styling data changes (Leaflet caches layers).
  const dataKey = React.useMemo(
    () => `${scored ? "s" : "u"}:` + data.map((d) => d.color).join("|"),
    [data, scored],
  );

  function style(feature?: { properties?: { __idx?: number } }): PathOptions {
    const idx = feature?.properties?.__idx ?? -1;
    const datum = data[idx];
    return {
      fillColor: datum?.color ?? naColor,
      fillOpacity: scored ? 0.7 : 0,
      color: "#555",
      weight: 1,
    };
  }

  function onEachFeature(
    feature: { properties?: NeighbourhoodFeature["properties"] & { __idx?: number } },
    layer: Layer,
  ) {
    const idx = feature.properties?.__idx ?? -1;
    const datum = data[idx];
    const name = feature.properties?.AREA_NAME ?? "Unknown";
    layer.bindPopup(`<strong>${name}</strong><br/>${datum?.valueLabel ?? "NA"}`);
    layer.on("click", (e: LeafletMouseEvent) => {
      e.target.openPopup?.();
      onFeatureClick(idx);
    });
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[43.85, -79.3]}
        zoom={9}
        scrollWheelZoom
        className="h-full w-full rounded-md"
        style={{ background: "#e5e7eb" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON
          key={dataKey}
          data={collection}
          style={style}
          onEachFeature={onEachFeature}
        />
        <FitBounds bounds={bounds} />
        {nearbyTags && nearbyTags.filter((t) => t.trim()).length > 0 && (
          <LiveNearbyLayer
            tags={nearbyTags}
            tagEmoji={tagEmoji ?? {}}
            minZoom={markersMinZoom}
          />
        )}
        <HighlightLayer point={highlight} context={highlightContext} />
      </MapContainer>
      {scored && !hideLegend && (
        <Legend title={legendTitle} palette={palette} naColor={naColor} />
      )}
      {!scored && (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center">
          <div className="rounded-md border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow">
            Select one or more metrics to score neighbourhoods.
          </div>
        </div>
      )}
    </div>
  );
}
