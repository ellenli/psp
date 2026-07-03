"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NeighbourhoodCombobox,
  ALL_GTA,
} from "@/components/neighbourhood-combobox";
import { MetricTree } from "@/components/metric-tree";
import { PlacesTwoSections } from "@/components/places/PlacesTwoSections";
import { AreaDetailPanel } from "@/components/detail-sheet";
import type { MapFeatureDatum } from "@/components/score-map";

import {
  CENSUS_CHARACTERISTICS,
  DEFAULT_CHECKED_LEAVES,
  type CensusCharacteristicKey,
  type LeafMetricKey,
} from "@/lib/metrics";
import {
  censusColor,
  compositeScore,
  ntile,
  RDYLBU_REVERSED_10,
  REDS_10,
  NA_COLOR,
  scoreColor,
} from "@/lib/score";
import { enrichFeatures } from "@/lib/mockScores";
import { EMOJI_DATA } from "@/lib/emojiData";
import { geocode } from "@/lib/geocodeClient";
import { estimateMinutes } from "@/lib/routing";
import type {
  NeighbourhoodCollection,
  NeighbourhoodFeature,
  PlaceRow,
} from "@/lib/types";

import sampleData from "@/data/sample-neighbourhoods.json";

// Leaflet must only render client-side.
const ScoreMap = dynamic(() => import("@/components/score-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-md border bg-muted text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

const DEFAULT_COMMUTES: PlaceRow[] = [
  {
    id: "commute-zach",
    label: "Zach's Work",
    target: "MDA Space, 7500 Financial Dr, Brampton, ON L6Y 6K7",
    mode: "drive",
  },
  {
    id: "commute-parents",
    label: "Ellen's Parents",
    target: "22 Chester Ave, Toronto, ON M4K 2Z9",
    mode: "any",
  },
];

const DEFAULT_NEARBY: PlaceRow[] = [
  { id: "nearby-cafes", target: "cafes", mode: "walk" },
  { id: "nearby-gf", target: "gluten-free", mode: "walk" },
  { id: "nearby-ma", target: "martial arts", mode: "walk" },
];

/** Bounds [[s,w],[n,e]] for a single feature's geometry. */
function featureBounds(
  f: NeighbourhoodFeature,
): [[number, number], [number, number]] {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  const rings =
    f.geometry.type === "Polygon"
      ? (f.geometry.coordinates as number[][][])
      : (f.geometry.coordinates as number[][][][]).flat();
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

/** Bounds [[s,w],[n,e]] over an array of features, or null if empty/degenerate. */
function featuresBounds(
  features: NeighbourhoodFeature[],
): [[number, number], [number, number]] | null {
  let minLat = Infinity,
    minLon = Infinity,
    maxLat = -Infinity,
    maxLon = -Infinity;
  for (const f of features) {
    const [[s, w], [n, e]] = featureBounds(f);
    minLat = Math.min(minLat, s);
    minLon = Math.min(minLon, w);
    maxLat = Math.max(maxLat, n);
    maxLon = Math.max(maxLon, e);
  }
  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(minLon) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(maxLon)
  ) {
    return null;
  }
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

export function Explore() {
  // --- data ---
  const [features, setFeatures] = React.useState<NeighbourhoodFeature[]>(() =>
    enrichFeatures(
      (sampleData as unknown as NeighbourhoodCollection).features,
    ),
  );
  React.useEffect(() => {
    let active = true;
    fetch("/api/neighbourhoods")
      .then((r) => r.json())
      .then((data: NeighbourhoodCollection & { source?: string }) => {
        if (!active || !data?.features?.length) return;
        setFeatures(enrichFeatures(data.features));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // --- controls state ---
  const [neighbourhood, setNeighbourhood] = React.useState(ALL_GTA);
  const [selected, setSelected] = React.useState<Set<LeafMetricKey>>(
    new Set(DEFAULT_CHECKED_LEAVES),
  );
  // Fraser Institute minimum rating (0–10). Applied as a map filter (like the
  // commute cutoff), NOT as part of the averaged checkbox composite.
  const [fraserMin, setFraserMin] = React.useState(0);
  const [commutes, setCommutes] =
    React.useState<PlaceRow[]>(DEFAULT_COMMUTES);
  const [nearby, setNearby] = React.useState<PlaceRow[]>(DEFAULT_NEARBY);
  const [tagEmoji, setTagEmoji] = React.useState<Record<string, string>>({});
  // Resolved [lon, lat] for commute targets that have a max-minutes cutoff set.
  const [commuteCoords, setCommuteCoords] = React.useState<
    Record<string, [number, number]>
  >({});
  const [emojiEditTag, setEmojiEditTag] = React.useState<string | null>(null);
  const [emojiSearch, setEmojiSearch] = React.useState("");
  // Hovered POI (from the results panel) to spotlight on the map.
  const [hoverPlace, setHoverPlace] = React.useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [census, setCensus] =
    React.useState<CensusCharacteristicKey>("population");
  const [showCensus, setShowCensus] = React.useState(false);

  // Geocode commute targets that have a cutoff, storing resolved coords by row
  // id. Network failures are swallowed (geocode returns null); unresolved rows
  // simply never filter the map.
  React.useEffect(() => {
    let active = true;
    const rows = commutes.filter(
      (r) => r.target.trim() && r.underMinutes !== undefined,
    );
    rows.forEach((row) => {
      geocode(row.target)
        .then((coords) => {
          if (!active || !coords) return;
          setCommuteCoords((prev) => {
            const existing = prev[row.id];
            if (
              existing &&
              existing[0] === coords[0] &&
              existing[1] === coords[1]
            ) {
              return prev;
            }
            return { ...prev, [row.id]: coords };
          });
        })
        .catch(() => {});
    });
    return () => {
      active = false;
    };
  }, [commutes]);

  const names = React.useMemo(
    () => features.map((f) => f.properties.AREA_NAME).sort(),
    [features],
  );

  // Filter to selected neighbourhood (or all).
  const filtered = React.useMemo(() => {
    if (neighbourhood === ALL_GTA) return features;
    return features.filter((f) => f.properties.AREA_NAME === neighbourhood);
  }, [features, neighbourhood]);

  const selectedLeaves = React.useMemo(
    () => Array.from(selected),
    [selected],
  );

  // No metrics selected -> the score map renders outlines only (no fill).
  const scored = selected.size > 0;

  // Combined place list for the informational detail sheet:
  // commutes appear as "rank" anchors (travel times), nearby as "click" amenities.
  const detailPlaces = React.useMemo<PlaceRow[]>(
    () => [
      ...commutes
        .filter((r) => r.target.trim())
        .map((r) => ({ ...r, behavior: "rank" as const })),
      ...nearby
        .filter((r) => r.target.trim())
        .map((r) => ({ ...r, behavior: "click" as const })),
    ],
    [commutes, nearby],
  );

  // Composite raw value per filtered feature — metrics only (commutes never
  // affect map coloring; they are informational in the detail sheet).
  const rawScores = React.useMemo(() => {
    return filtered.map((f) => compositeScore(f, selectedLeaves));
  }, [filtered, selectedLeaves]);

  const scoreDeciles = React.useMemo(
    () => ntile(rawScores, 10),
    [rawScores],
  );

  // Census values + deciles for the bottom map.
  const censusValues = React.useMemo(
    () =>
      filtered.map((f) => {
        const c = f.properties.census;
        return c ? (c[census] as number) : null;
      }),
    [filtered, census],
  );
  const censusDeciles = React.useMemo(
    () => ntile(censusValues, 10),
    [censusValues],
  );

  const censusUnit =
    CENSUS_CHARACTERISTICS.find((c) => c.key === census)?.unit ?? "";

  // Optional commute-time cutoff filter. For each feature, AND across commute
  // rows that (a) have a cutoff and (b) have resolved coords: the feature must
  // be within `underMinutes` of every such target by that row's mode. Rows with
  // unresolved coords are ignored (do not filter). Never throws on missing data.
  const commutePass = React.useMemo(() => {
    const activeRows = commutes.filter(
      (r) =>
        r.target.trim() &&
        r.underMinutes !== undefined &&
        commuteCoords[r.id],
    );
    return filtered.map((f) => {
      const centroid = f.properties.centroid;
      if (!centroid) return true;
      for (const row of activeRows) {
        const coords = commuteCoords[row.id];
        if (!coords) continue;
        const mins = estimateMinutes(centroid, coords, row.mode);
        if (mins > (row.underMinutes as number)) return false;
      }
      return true;
    });
  }, [filtered, commutes, commuteCoords]);

  // Optional Fraser-rating cutoff filter. When fraserMin > 0, a neighbourhood
  // whose modeled edu_fraser sub-score (0–100) is below fraserMin*10 is
  // filtered out (score becomes unscored/NA). Fraser ratings are modeled here
  // pending real Fraser Institute report-card data.
  const fraserPass = React.useMemo(() => {
    return filtered.map((f) => {
      if (fraserMin <= 0) return true;
      const v = f.properties.scores?.edu_fraser;
      if (typeof v !== "number") return true;
      return v >= fraserMin * 10;
    });
  }, [filtered, fraserMin]);

  // Map data arrays.
  const scoreData: MapFeatureDatum[] = filtered.map((f, i) => {
    const pass = commutePass[i] && fraserPass[i];
    const d = pass ? scoreDeciles[i] : null;
    const raw = pass ? rawScores[i] : null;
    return {
      decile: d,
      color: scoreColor(d),
      valueLabel:
        raw === null ? "Score: NA" : `Score: ${raw.toFixed(2)}`,
    };
  });

  const censusData: MapFeatureDatum[] = filtered.map((f, i) => {
    const d = censusDeciles[i];
    const v = censusValues[i];
    return {
      decile: d,
      color: censusColor(d),
      valueLabel:
        v === null
          ? "NA"
          : `${v.toLocaleString()} ${censusUnit}`,
    };
  });

  // NOTE: the synthetic postal-code layer and synthetic nearby-emoji generator
  // were removed — the map shows REAL places only (via /api/places inside
  // ScoreMap). Postal-level scores can return once real study data is
  // available from the UBC authors.
  const nearbyTags = React.useMemo(
    () => nearby.map((r) => r.target),
    [nearby],
  );

  // Emoji picker: filter the full system emoji set by search substring.
  const filteredEmoji = React.useMemo(() => {
    const q = emojiSearch.trim().toLowerCase();
    if (!q) return EMOJI_DATA;
    return EMOJI_DATA.filter((entry) => entry.k.includes(q));
  }, [emojiSearch]);

  // Bounds: zoom to the selected neighbourhood; for "All of the GTA" frame the
  // bbox over ALL loaded/filtered features (tighter than the fixed GTA bbox, and
  // auto-expands as the ETL adds municipalities). Null => map's hardcoded GTA
  // fallback (used only when there are no features yet).
  const bounds = React.useMemo<
    [[number, number], [number, number]] | null
  >(() => {
    if (neighbourhood !== ALL_GTA && filtered.length === 1) {
      return featureBounds(filtered[0]);
    }
    return featuresBounds(filtered);
  }, [neighbourhood, filtered]);

  // Inline click-detail panel. When open, the left filter panel collapses to a
  // thin rail.
  const [detailIndex, setDetailIndex] = React.useState<number | null>(null);
  const detailFeature =
    detailIndex !== null ? filtered[detailIndex] ?? null : null;
  // Decile color for the clicked feature's composite score (map legend match);
  // null when unscored so the badge falls back to its default styling.
  const detailScoreHex =
    detailIndex !== null && scored
      ? scoreData[detailIndex]?.color ?? null
      : null;
  // Clicked neighbourhood's bounds — minimum context kept in view when a
  // hovered POI makes the map navigate.
  const detailBounds = React.useMemo(
    () => (detailFeature ? featureBounds(detailFeature) : null),
    [detailFeature],
  );

  return (
    <div className="flex flex-1 gap-4 p-4">
      {/* Desktop-only tool: on small screens, blur the app and show a notice. */}
      <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-background/50 p-6 backdrop-blur-md md:hidden">
        <div className="max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-lg">
          <p className="text-base font-semibold">
            PlayScore<span className="text-muted-foreground"> Plus</span> is a
            desktop tool
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            This interactive map tool relies on side-by-side panels designed
            for larger displays. Please return on a laptop or desktop browser.
          </p>
        </div>
      </div>
      {/* Left column: controls (always visible on desktop — the map shrinks
          instead when the detail panel opens). Hidden on mobile so the
          blurred backdrop behind the notice is the map itself. */}
      <aside className="hidden w-[380px] shrink-0 md:block">
          <Card className="h-fit max-h-[calc(100vh-2rem)] overflow-y-auto">
            <CardContent className="space-y-6 pt-6">
          {/* App title (moved from the removed top bar) */}
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold leading-none tracking-tight">
              PlayScore<span className="text-muted-foreground"> Plus</span>
            </span>
            <span className="text-muted-foreground/40">|</span>
            <span className="text-xs text-muted-foreground">
              Greater Toronto Area
            </span>
          </div>

          {/* Control 1 */}
          <div className="space-y-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Select a neighbourhood
            </Label>
            <NeighbourhoodCombobox
              names={names}
              value={neighbourhood}
              onChange={setNeighbourhood}
            />
          </div>

          {/* Control 2 */}
          <div className="space-y-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Select metrics to score
            </Label>
            <MetricTree
              selected={selected}
              onChange={setSelected}
              sliderValues={{ edu_fraser: fraserMin }}
              onSliderChange={(key, value) => {
                if (key === "edu_fraser") setFraserMin(value);
              }}
            />
          </div>

          {/* Control 3 */}
          <div className="space-y-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Places you care about
            </Label>

            <PlacesTwoSections
              commutes={commutes}
              nearby={nearby}
              onCommutesChange={setCommutes}
              onNearbyChange={setNearby}
              onEdited={() => {}}
              tagEmoji={tagEmoji}
              onEditEmoji={(tag) => setEmojiEditTag(tag)}
            />
          </div>

          {/* Control 4 */}
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Checkbox
                id="show-census"
                checked={showCensus}
                onCheckedChange={(v) => setShowCensus(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="show-census" className="text-xs leading-tight">
                Show census characteristics layer
              </Label>
            </div>
            {showCensus && (
              <Select
                value={census}
                onValueChange={(v) =>
                  setCensus(v as CensusCharacteristicKey)
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CENSUS_CHARACTERISTICS.map((c) => (
                    <SelectItem
                      key={c.key}
                      value={c.key}
                      className="text-xs"
                    >
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
            </CardContent>
          </Card>
      </aside>

      {/* Middle column: score map (+ optional census map). Stretches to match
          the row height, which is driven by the left panel — so the map spans
          the same height as the left UI panel. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 self-stretch">
        <div
          className={
            showCensus ? "min-h-[300px] flex-1" : "min-h-[420px] flex-1"
          }
        >
          <ScoreMap
            features={filtered}
            data={scoreData}
            palette={RDYLBU_REVERSED_10}
            naColor={NA_COLOR}
            legendTitle="Score decile"
            bounds={bounds}
            onFeatureClick={(i) => setDetailIndex(i)}
            nearbyTags={nearbyTags}
            tagEmoji={tagEmoji}
            hideLegend={detailIndex !== null}
            highlight={hoverPlace}
            highlightContext={detailBounds}
            scored={scored}
          />
        </div>
        {showCensus && (
          <div className="min-h-[300px] flex-1">
            <ScoreMap
              features={filtered}
              data={censusData}
              palette={REDS_10}
              naColor={NA_COLOR}
              legendTitle={
                CENSUS_CHARACTERISTICS.find((c) => c.key === census)?.label ??
                "Census"
              }
              bounds={bounds}
              onFeatureClick={(i) => setDetailIndex(i)}
              hideLegend={detailIndex !== null}
            />
          </div>
        )}
      </div>

      {/* Right column: inline area-detail panel (no overlay/backdrop). The
          attribution text sits below the panel, anchored to the bottom; the
          panel stops right above it with the standard gap. */}
      {detailIndex !== null && (
        <aside className="hidden max-h-[calc(100vh-2rem)] w-[360px] shrink-0 flex-col self-stretch md:flex">
          <div className="min-h-0 flex-1">
            <AreaDetailPanel
              feature={detailFeature}
              onClose={() => setDetailIndex(null)}
              selectedLeaves={selectedLeaves}
              places={detailPlaces}
              tagEmoji={tagEmoji}
              scoreHex={detailScoreHex}
              onHoverPlace={setHoverPlace}
            />
          </div>
          <p className="mt-4 text-left text-[11px] leading-relaxed text-muted-foreground/70">
            PlayScore Plus is based on{" "}
            <a
              href="https://playscore-ca-2-6.shinyapps.io/shiny/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              PlayScore
            </a>{" "}
            and the{" "}
            <a
              href="https://news.ubc.ca/2025/12/is-your-neighbourhood-playable-new-website-breaks-it-down/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Canadian Playability Index
            </a>
            , both published by UBC&apos;s School of Population and Public
            Health in 2026. Tool made by{" "}
            <a
              href="https://github.com/ellenli"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Ellen Li
            </a>{" "}
            in Toronto.
          </p>
        </aside>
      )}

      <Dialog
        open={emojiEditTag !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEmojiEditTag(null);
            setEmojiSearch("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              Choose an emoji for &ldquo;{emojiEditTag}&rdquo;
            </DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Search emojis…"
            value={emojiSearch}
            onChange={(e) => setEmojiSearch(e.target.value)}
            autoFocus
          />
          <div className="grid grid-cols-8 gap-1 max-h-[300px] overflow-y-auto">
            {filteredEmoji.map((entry) => (
              <button
                key={entry.e}
                type="button"
                title={entry.k}
                onClick={() => {
                  if (emojiEditTag) {
                    const key = emojiEditTag.toLowerCase();
                    setTagEmoji((prev) => ({ ...prev, [key]: entry.e }));
                  }
                  setEmojiEditTag(null);
                  setEmojiSearch("");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-muted"
              >
                {entry.e}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (emojiEditTag) {
                const key = emojiEditTag.toLowerCase();
                setTagEmoji((prev) => {
                  const next = { ...prev };
                  delete next[key];
                  return next;
                });
              }
              setEmojiEditTag(null);
              setEmojiSearch("");
            }}
          >
            Reset to default
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
