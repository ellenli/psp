"use client";

import * as React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Bike,
  Bus,
  Car,
  ChevronDown,
  ChevronRight,
  Footprints,
  Loader2,
  X,
} from "lucide-react";
import { ALL_LEAF_KEYS, METRIC_TREE, leavesOf } from "@/lib/metrics";
import type { LeafMetricKey, MetricNode } from "@/lib/metrics";
import type { NeighbourhoodFeature, PlaceRow, TravelMode } from "@/lib/types";
import { compositeScore } from "@/lib/score";
import { routeDetail, estimateMinutes } from "@/lib/routing";
import type { RouteDetail } from "@/lib/routing";
import { geocodeDetail } from "@/lib/geocodeClient";
import { emojiForTag } from "@/lib/emoji";
import { EXPANDABLE_METRICS } from "@/lib/metricExamples";

/** Tiny animated loading spinner. */
function Spinner() {
  return (
    <Loader2 className="inline h-3 w-3 animate-spin align-[-2px] text-muted-foreground" />
  );
}

/** A resolved nearby place (REAL data from /api/places) for the panel. */
interface NearbyItem {
  name: string;
  address: string | null;
  rating: number | null;
  reviews: number | null;
  mapsUrl: string;
  minutes: number;
  lat: number;
  lon: number;
}

interface NearbyState {
  status: "loading" | "done";
  items: NearbyItem[];
}

/** A resolved commute anchor. */
interface AnchorState {
  row: PlaceRow;
  status: "loading" | "done";
  /** null when the target can't be geocoded. */
  route: RouteDetail | null;
}

/** A real metric example (from /api/metric-examples). */
interface MetricExample {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  mapsUrl: string;
  rating: number | null;
  reviews: number | null;
}

interface MetricExamplesState {
  /** Chunked fetches completed / total — drives the REAL progress %. */
  chunksDone: number;
  chunksTotal: number;
  results: Record<string, { count: number; examples: MetricExample[] }>;
}

/** Split the expandable metrics into chunks so progress is real + granular. */
const METRIC_CHUNKS: LeafMetricKey[][] = (() => {
  const chunks: LeafMetricKey[][] = [[], [], []];
  EXPANDABLE_METRICS.forEach((m, i) => chunks[i % 3].push(m));
  return chunks.filter((c) => c.length > 0);
})();

/** Inline SVG icon for a travel mode (lucide). */
function ModeIcon({ mode }: { mode: TravelMode }) {
  const cls = "inline h-3.5 w-3.5 align-[-2px] text-muted-foreground";
  const title =
    mode === "any" || mode === "drive"
      ? "drive"
      : mode === "walk"
        ? "walk"
        : mode === "bike"
          ? "bike"
          : "transit";
  if (mode === "walk") return <Footprints className={cls} aria-label={title} />;
  if (mode === "bike") return <Bike className={cls} aria-label={title} />;
  if (mode === "transit") return <Bus className={cls} aria-label={title} />;
  return <Car className={cls} aria-label={title} />;
}

function sourceNote(source: string): string | null {
  if (source === "google-traffic") return "typical weekday traffic";
  if (source === "osrm-typical-traffic") return "est. typical traffic";
  if (source === "estimate") return "straight-line estimate";
  return null;
}

/** First line of an address ("101 Main St, Toronto, ON M4S 2A4" -> "101 Main St"). */
function shortAddress(address: string | null): string | null {
  if (!address) return null;
  const first = address.split(",")[0]?.trim();
  return first || null;
}

/** Adaptive text color (dark/light) for a hex background, for readability. */
function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "inherit";
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? "#1f2937" : "#ffffff";
}

const LEAF_LABELS: Record<LeafMetricKey, string> = (function () {
  const out = {} as Record<LeafMetricKey, string>;
  function walk(nodes: typeof METRIC_TREE) {
    for (const n of nodes) {
      if (n.leaf) out[n.leaf] = n.label;
      if (n.children) walk(n.children);
    }
  }
  walk(METRIC_TREE);
  return out;
})();

const EXPANDABLE_SET = new Set<LeafMetricKey>(EXPANDABLE_METRICS);

/** Emoji for each top-level metric group header. */
const GROUP_EMOJI: Record<string, string> = {
  playability: "🛝",
  education: "📚",
  walk: "🚶‍♀️‍➡️",
  transit: "🚃",
  biking: "🚲",
};

/** One commute row: routed time range + mode icon. */
function CommuteRow({ anchor }: { anchor: AnchorState }) {
  const { row, status, route } = anchor;
  const name = row.label ? row.label : row.target;

  if (status === "loading") {
    return (
      <li className="text-muted-foreground">
        <Spinner /> Calculating route to{" "}
        <span className="font-medium">{name}</span>…
      </li>
    );
  }
  if (!route) {
    return (
      <li>
        <span className="text-muted-foreground">— address not found</span> for{" "}
        <span className="font-medium">{name}</span>
      </li>
    );
  }
  const note = sourceNote(route.source);
  const range =
    route.minutesLow === route.minutesHigh
      ? `${route.minutesLow} min`
      : `${route.minutesLow}–${route.minutesHigh} min`;
  return (
    <li>
      <span className="font-semibold">{range}</span>{" "}
      <ModeIcon mode={row.mode} /> to{" "}
      <span className="font-medium">{name}</span>
      {(route.distanceKm !== null || note) && (
        <span className="block text-[11px] text-muted-foreground">
          {route.distanceKm !== null ? `${route.distanceKm} km` : ""}
          {route.distanceKm !== null && note ? " · " : ""}
          {note ?? ""}
        </span>
      )}
    </li>
  );
}

/** One metric row: score + optional expandable list of real nearby examples. */
function MetricRow({
  metric,
  score,
  examples,
  centroid,
  onHoverPlace,
}: {
  metric: LeafMetricKey;
  score: number | undefined;
  examples: MetricExamplesState;
  centroid: [number, number] | null;
  onHoverPlace?: (p: { lat: number; lon: number } | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const expandable = EXPANDABLE_SET.has(metric);
  const result = examples.results[metric];
  // This row is loading until ITS chunk has landed.
  const loading =
    expandable &&
    result === undefined &&
    examples.chunksDone < examples.chunksTotal;
  const pct =
    examples.chunksTotal > 0
      ? Math.round((examples.chunksDone / examples.chunksTotal) * 100)
      : 0;
  const count = result?.count;

  return (
    <div>
      <button
        type="button"
        disabled={!expandable}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
        className="flex w-full items-center gap-1 py-0.5 text-left"
      >
        {expandable ? (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {LEAF_LABELS[metric]}
          {expandable && (
            <span className="text-muted-foreground/60">
              {" "}
              {loading ? (
                <>
                  <Spinner /> {pct}%
                </>
              ) : (
                `(${count ?? "–"})`
              )}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs font-medium tabular-nums">
          {score ?? "NA"}
        </span>
      </button>
      {open && expandable && (
        <div className="mb-1 ml-4 border-l pl-3">
          {loading ? (
            <p className="py-1 text-[11px] text-muted-foreground">
              <Spinner /> Finding real examples nearby…
            </p>
          ) : !result || result.examples.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">
              None found within ~1.5 km.
            </p>
          ) : (
            <ul className="space-y-1 py-1">
              {result.examples.map((ex, i) => (
                <li
                  key={`${ex.name}:${i}`}
                  className="flex items-start justify-between gap-2 rounded-sm text-[11px] hover:bg-muted/60"
                  onMouseEnter={() =>
                    onHoverPlace?.({ lat: ex.lat, lon: ex.lon })
                  }
                  onMouseLeave={() => onHoverPlace?.(null)}
                >
                  <span className="min-w-0">
                    <a
                      href={ex.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {ex.name}
                    </a>
                    {ex.rating !== null && (
                      <span className="ml-1 text-muted-foreground">
                        ⭐ {ex.rating.toFixed(1)}
                        {ex.reviews !== null ? ` (${ex.reviews})` : ""}
                      </span>
                    )}
                    {shortAddress(ex.address) && (
                      <span className="block text-muted-foreground">
                        {shortAddress(ex.address)}
                      </span>
                    )}
                  </span>
                  {centroid && (
                    <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                      {estimateMinutes(centroid, [ex.lon, ex.lat], "walk")} min{" "}
                      <ModeIcon mode="walk" />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline area-detail panel. Renders as a plain Card (NO Sheet/overlay/backdrop)
 * so it can sit next to the map. `onClose` restores the full filter panel.
 */
export function AreaDetailPanel({
  feature,
  onClose,
  selectedLeaves,
  places,
  tagEmoji = {},
  scoreHex = null,
  onHoverPlace,
}: {
  feature: NeighbourhoodFeature | null;
  onClose: () => void;
  selectedLeaves: LeafMetricKey[];
  places: PlaceRow[];
  /** User emoji overrides per nearby tag. */
  tagEmoji?: Record<string, string>;
  /** Decile color for the composite score (from the map legend), or null/NA. */
  scoreHex?: string | null;
  /** Hovering a POI row highlights its location on the map. */
  onHoverPlace?: (p: { lat: number; lon: number } | null) => void;
}) {
  const centroid = feature?.properties.centroid ?? null;
  const composite = feature ? compositeScore(feature, selectedLeaves) : null;

  const anchors = places.filter((p) => p.behavior === "rank" && p.target.trim());
  const amenities = places.filter(
    (p) => p.behavior === "click" && p.target.trim(),
  );

  const [anchorStates, setAnchorStates] = React.useState<AnchorState[]>([]);
  const [nearby, setNearby] = React.useState<Record<string, NearbyState>>({});
  const [metricExamples, setMetricExamples] =
    React.useState<MetricExamplesState>({
      chunksDone: 0,
      chunksTotal: METRIC_CHUNKS.length,
      results: {},
    });

  // Breakdown rows grouped by top-level metric-tree node (playability,
  // education, walk, transit, biking). Shows the selected leaves, or all
  // leaves when nothing is selected.
  const shownLeaves = React.useMemo(
    () =>
      new Set<LeafMetricKey>(
        selectedLeaves.length ? selectedLeaves : ALL_LEAF_KEYS,
      ),
    [selectedLeaves],
  );
  const groups = React.useMemo(
    () =>
      METRIC_TREE.map((node: MetricNode) => ({
        key: node.key,
        label: node.label,
        rows: leavesOf(node).filter((k) => shownLeaves.has(k)),
      })).filter((g) => g.rows.length > 0),
    [shownLeaves],
  );

  React.useEffect(() => {
    let active = true;
    if (!centroid) {
      queueMicrotask(() => {
        if (!active) return;
        setAnchorStates([]);
        setNearby({});
        setMetricExamples({
          chunksDone: 0,
          chunksTotal: METRIC_CHUNKS.length,
          results: {},
        });
      });
      return () => {
        active = false;
      };
    }
    const [lon, lat] = centroid;

    // Commutes: render rows immediately in "loading" state, then resolve each
    // one INDEPENDENTLY (geocode -> real routed range) so a slow row never
    // hides the others.
    queueMicrotask(() => {
      if (!active) return;
      setAnchorStates(
        anchors.map((row) => ({ row, status: "loading", route: null })),
      );
      setNearby(() => {
        const init: Record<string, NearbyState> = {};
        for (const row of amenities) {
          init[row.id] = { status: "loading", items: [] };
        }
        return init;
      });
      setMetricExamples({
        chunksDone: 0,
        chunksTotal: METRIC_CHUNKS.length,
        results: {},
      });
    });
    anchors.forEach((row, idx) => {
      (async () => {
        let route: RouteDetail | null = null;
        try {
          const geo = await geocodeDetail(row.target);
          if (geo) {
            route = await routeDetail(centroid, geo.coord, row.mode);
            if (!route) {
              // Routed servers unavailable — degrade to the instant local
              // estimate instead of showing nothing/"address not found".
              const est = estimateMinutes(centroid, geo.coord, row.mode);
              const spread = row.mode !== "walk" && row.mode !== "bike";
              route = {
                minutes: est,
                minutesLow: spread ? Math.max(1, Math.round(est * 0.85)) : est,
                minutesHigh: spread ? Math.round(est * 1.3) : est,
                source: "estimate",
                distanceKm: null,
                steps: [],
              };
            }
          }
        } catch {
          // leave route null -> "address not found"
        }
        if (!active) return;
        setAnchorStates((prev) => {
          const next = [...prev];
          if (next[idx]?.row.id === row.id) {
            next[idx] = { row, status: "done", route };
          }
          return next;
        });
      })();
    });

    // Nearby: REAL places per tag via /api/places (Google Places with ratings
    // + listing links when configured; OSM otherwise). Each tag fetches
    // independently. Travel minutes use the instant sync estimate.
    for (const row of amenities) {
      (async () => {
        let items: NearbyItem[] = [];
        try {
          const url =
            `/api/places?q=${encodeURIComponent(row.target)}` +
            `&lat=${lat}&lon=${lon}&radius=2000`;
          const res = await fetch(url, {
            signal: AbortSignal.timeout(30000),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              places?: Array<{
                name: string;
                address: string | null;
                rating: number | null;
                reviews: number | null;
                mapsUrl: string;
                lat: number;
                lon: number;
              }>;
            };
            items = (json.places ?? [])
              .map((p) => ({
                name: p.name,
                address: p.address,
                rating: p.rating,
                reviews: p.reviews,
                mapsUrl: p.mapsUrl,
                minutes: estimateMinutes(centroid, [p.lon, p.lat], row.mode),
                lat: p.lat,
                lon: p.lon,
              }))
              .sort((a, b) => a.minutes - b.minutes)
              .slice(0, 8);
          }
        } catch {
          // items stays []
        }
        if (active) {
          setNearby((prev) => ({
            ...prev,
            [row.id]: { status: "done", items },
          }));
        }
      })();
    }

    // Metric examples: fetched in CHUNKS so rows resolve incrementally and
    // the loading indicator shows real, live-updating progress.
    {
      const dLat = 0.0135; // ~1.5 km
      const dLon = dLat / Math.cos((lat * Math.PI) / 180);
      const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
      for (const chunk of METRIC_CHUNKS) {
        (async () => {
          let results: MetricExamplesState["results"] = {};
          try {
            const res = await fetch("/api/metric-examples", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                bbox,
                metrics: chunk,
                area: feature?.properties.AREA_NAME,
              }),
              signal: AbortSignal.timeout(35000),
            });
            if (res.ok) {
              const json = (await res.json()) as {
                results?: MetricExamplesState["results"];
              };
              results = json.results ?? {};
            }
          } catch {
            // results stays {}
          }
          if (active) {
            setMetricExamples((prev) => ({
              chunksTotal: prev.chunksTotal,
              chunksDone: prev.chunksDone + 1,
              results: { ...prev.results, ...results },
            }));
          }
        })();
      }
    }

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, places]);

  if (!feature) return null;

  return (
    <Card className="h-fit max-h-full overflow-y-auto">
      <CardContent className="space-y-5 pt-6 text-sm">
        {/* Header + close */}
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold leading-none">
            {feature.properties.AREA_NAME}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 border border-border/60"
            title="Close"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        {/* Composite + grouped breakdown */}
        <section>
          <div className="flex items-center justify-between">
            <span className="font-medium">Composite fit score</span>
            <Badge
              variant="secondary"
              style={
                scoreHex
                  ? {
                      backgroundColor: scoreHex,
                      color: readableTextColor(scoreHex),
                    }
                  : undefined
              }
            >
              {composite === null ? "NA" : composite.toFixed(2)}
            </Badge>
          </div>
          <div className="mt-1">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="mb-0.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {GROUP_EMOJI[g.key] ? `${GROUP_EMOJI[g.key]} ` : ""}
                  {g.label}
                </div>
                {g.rows.map((k) => (
                  <MetricRow
                    key={k}
                    metric={k}
                    score={feature.properties.scores?.[k]}
                    examples={metricExamples}
                    centroid={centroid}
                    onHoverPlace={onHoverPlace}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* Commutes */}
        <section>
          <h3 className="mb-1 font-medium">Commute</h3>
          {anchorStates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No commute places set.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {anchorStates.map((a) => (
                <CommuteRow key={a.row.id} anchor={a} />
              ))}
            </ul>
          )}
        </section>

        {/* Nearby amenities — collapsed by default; headings carry the tag's
            emoji and the count of real places found. */}
        <section>
          <h3 className="mb-1 font-medium">Nearby</h3>
          {amenities.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No amenity keywords.
            </p>
          ) : (
            <Accordion
              key={feature.properties.AREA_NAME}
              type="multiple"
              className="w-full"
            >
              {amenities.map((row) => {
                const state = nearby[row.id];
                const items = state?.items ?? [];
                const loading = !state || state.status === "loading";
                return (
                  <AccordionItem key={row.id} value={row.id}>
                    <AccordionTrigger className="py-2">
                      {/* Matches the metric group-header typography above. */}
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {emojiForTag(row.target, tagEmoji)}{" "}
                        {row.target}{" "}
                        {loading ? <Spinner /> : `(${items.length})`}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {loading ? (
                        <p className="text-xs text-muted-foreground">
                          Finding real places nearby…
                        </p>
                      ) : items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No matches found within ~2 km.
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-xs">
                          {items.map((p, i) => (
                            <li
                              key={`${p.name}:${i}`}
                              className="flex items-start justify-between gap-2 rounded-sm hover:bg-muted/60"
                              onMouseEnter={() =>
                                onHoverPlace?.({ lat: p.lat, lon: p.lon })
                              }
                              onMouseLeave={() => onHoverPlace?.(null)}
                            >
                              <span className="min-w-0">
                                <a
                                  href={p.mapsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium underline-offset-2 hover:underline"
                                >
                                  {p.name}
                                </a>
                                {p.rating !== null && (
                                  <span className="ml-1 text-muted-foreground">
                                    ⭐ {p.rating.toFixed(1)}
                                    {p.reviews !== null
                                      ? ` (${p.reviews})`
                                      : ""}
                                  </span>
                                )}
                                {shortAddress(p.address) && (
                                  <span className="block text-[11px] text-muted-foreground">
                                    {shortAddress(p.address)}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                                {p.minutes} min <ModeIcon mode={row.mode} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
