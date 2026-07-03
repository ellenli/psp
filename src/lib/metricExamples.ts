// ---------------------------------------------------------------------------
// Per-metric "real example" definitions: which OpenStreetMap features qualify
// for each leaf metric, so the detail panel can show a count and a list of
// top/nearby examples (real places only).
//
// Used server-side by /api/metric-examples (Overpass query + classification).
// The client imports only EXPANDABLE_METRICS to know which rows expand.
// ---------------------------------------------------------------------------

import type { LeafMetricKey } from "./metrics";

type Tags = Record<string, string>;

export interface MetricExampleDef {
  /** Complete Overpass selector statements (element type included, no bbox). */
  selectors: string[];
  /** Predicate over OSM tags deciding whether an element qualifies. */
  match: (tags: Tags) => boolean;
  /** Only include named elements (e.g. bike routes). */
  namedOnly?: boolean;
  /** Dedupe results by name (way segments, paired stops). */
  dedupeByName?: boolean;
  /** Display-name fallback for unnamed elements. */
  kindLabel: (tags: Tags) => string;
  /**
   * Google Places text query for this metric — used (when a working key is
   * configured) to return examples WITH star ratings and real listing links.
   * Omitted for feature types Google has no meaningful listings for
   * (bus/streetcar stops, bike lanes).
   */
  googleQuery?: string;
}

/** Enriched/alternative-education name signal (Montessori, IB, gifted, TOPS…). */
export const ENRICHED_EDU_RE =
  /montessori|waldorf|steiner|international baccalaureate|\bib\b|gifted|alternative|\btops\b|\bmast\b|university of toronto schools|\buts\b/i;

const SECONDARY_NAME_RE = /secondary|high school|collegiate/i;

function name(tags: Tags): string {
  return tags.name ?? "";
}

export const METRIC_EXAMPLE_DEFS: Partial<
  Record<LeafMetricKey, MetricExampleDef>
> = {
  space_for_play: {
    googleQuery: "playground or park",
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
    googleQuery: "park, ravine, or nature trail",
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
    googleQuery: "library or community centre",
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
    googleQuery: "subway station",
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
    googleQuery: "GO Transit station",
    selectors: ['nwr["railway"="station"]'],
    match: (t) =>
      t.railway === "station" &&
      t.station !== "subway" &&
      t.subway !== "yes",
    dedupeByName: true,
    kindLabel: () => "Rail station",
  },
  bike_lanes: {
    // Dedicated cycling trails PLUS streets with protected (track-grade)
    // bike lanes.
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
    googleQuery: "Montessori, IB, gifted, or alternative school",
    selectors: ['nwr["amenity"~"^(school|kindergarten|childcare)$"]'],
    match: (t) =>
      ["school", "kindergarten", "childcare"].includes(t.amenity ?? "") &&
      ENRICHED_EDU_RE.test(name(t)),
    namedOnly: true,
    kindLabel: () => "Enriched program",
  },
  edu_daycare: {
    googleQuery: "daycare or child care centre",
    selectors: [
      'nwr["amenity"="childcare"]',
      'nwr["amenity"="kindergarten"]',
    ],
    match: (t) => ["childcare", "kindergarten"].includes(t.amenity ?? ""),
    kindLabel: () => "Daycare",
  },
  edu_afterschool: {
    googleQuery: "after-school program for kids",
    selectors: [
      'nwr["amenity"="childcare"]',
      'nwr["amenity"="community_centre"]',
    ],
    match: (t) =>
      ["childcare", "community_centre"].includes(t.amenity ?? ""),
    namedOnly: true,
    kindLabel: () => "Program",
  },
  edu_k8: {
    googleQuery: "elementary or middle school",
    selectors: ['nwr["amenity"="school"]'],
    match: (t) => {
      if (t.amenity !== "school") return false;
      if (SECONDARY_NAME_RE.test(name(t))) return false;
      const isced = t["isced:level"] ?? "";
      if (isced && !/0|1|2/.test(isced)) return false;
      return true;
    },
    namedOnly: true,
    kindLabel: () => "School",
  },
  edu_9_12: {
    googleQuery: "high school",
    selectors: ['nwr["amenity"="school"]'],
    match: (t) => {
      if (t.amenity !== "school") return false;
      const isced = t["isced:level"] ?? "";
      return (
        /secondary|high school|collegiate|institute/i.test(name(t)) ||
        /3/.test(isced)
      );
    },
    namedOnly: true,
    kindLabel: () => "Secondary school",
  },
  edu_private: {
    googleQuery: "private school",
    selectors: ['nwr["amenity"="school"]'],
    match: (t) => {
      if (t.amenity !== "school") return false;
      return (
        t["operator:type"] === "private" ||
        t.fee === "yes" ||
        /private|academy|independent/i.test(name(t))
      );
    },
    namedOnly: true,
    kindLabel: () => "Private school",
  },
};

/** Leaf metrics that have a real-example mapping (expandable in the panel). */
export const EXPANDABLE_METRICS = Object.keys(
  METRIC_EXAMPLE_DEFS,
) as LeafMetricKey[];
