// Metric tree definition for the "Select metrics to score" control.
// Leaf keys map 1:1 to the per-neighbourhood sub-scores generated in mockScores.ts
// (and, eventually, to the real Can-ALE / GTFS / Can-BICS / Census derived scores).

export type LeafMetricKey =
  | "traffic_env"
  | "space_for_play"
  | "social_env"
  | "natural_env"
  | "destinations"
  | "walk"
  | "transit_bus"
  | "transit_subway"
  | "transit_streetcar"
  | "transit_go"
  | "bike_lanes"
  | "bike_safety"
  | "bike_share"
  | "edu_montessori"
  | "edu_daycare"
  | "edu_afterschool"
  | "edu_k8"
  | "edu_9_12"
  | "edu_private"
  | "edu_fraser";

/** A single data source used to derive a metric. */
export interface MetricSource {
  id: string;
  domain: string;
  url: string;
  title: string;
  year: number;
  description: string;
}

/** Registry of all data sources, keyed by a short id referenced from metrics. */
export const SOURCE_REGISTRY: Record<string, MetricSource> = {
  osm: {
    id: "osm",
    domain: "openstreetmap.org",
    url: "https://www.openstreetmap.org/about",
    title: "OpenStreetMap",
    year: 2025,
    description:
      "Community-maintained open map of roads, paths, parks, and amenities.",
  },
  torontoParks: {
    id: "torontoParks",
    domain: "open.toronto.ca",
    url: "https://open.toronto.ca/dataset/parks-and-recreation-facilities/",
    title: "City of Toronto — Parks & Recreation",
    year: 2025,
    description:
      "Locations of parks, playgrounds, and recreation facilities.",
  },
  statcan: {
    id: "statcan",
    domain: "statcan.gc.ca",
    url: "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/index-eng.cfm",
    title: "Statistics Canada — 2021 Census",
    year: 2021,
    description: "Population, household, and demographic data by area.",
  },
  torontoCanopy: {
    id: "torontoCanopy",
    domain: "open.toronto.ca",
    url: "https://open.toronto.ca/dataset/forest-and-land-cover/",
    title: "City of Toronto — Forest & Land Cover",
    year: 2023,
    description: "Tree canopy and land cover across the city.",
  },
  canale: {
    id: "canale",
    domain: "canue.ca",
    url: "https://canue.ca/data/",
    title: "Can-ALE (Active Living Environments)",
    year: 2021,
    description:
      "National walkability index: intersection & dwelling density, points of interest.",
  },
  ttc: {
    id: "ttc",
    domain: "open.toronto.ca",
    url: "https://open.toronto.ca/dataset/ttc-routes-and-schedules/",
    title: "TTC Routes & Schedules (GTFS)",
    year: 2025,
    description:
      "Toronto Transit Commission stops, routes, and frequencies.",
  },
  metrolinx: {
    id: "metrolinx",
    domain: "metrolinx.com",
    url: "https://www.metrolinx.com/en/about-us/open-data",
    title: "Metrolinx Open Data (GO Transit)",
    year: 2025,
    description: "Regional GO rail/bus schedules and stations (GTFS).",
  },
  canbics: {
    id: "canbics",
    domain: "health-infobase.canada.ca",
    url: "https://health-infobase.canada.ca/datalab/bicycling-infrastructure.html",
    title: "Can-BICS",
    year: 2022,
    description:
      "National classification of cycling-infrastructure comfort and safety.",
  },
  torontoCycling: {
    id: "torontoCycling",
    domain: "open.toronto.ca",
    url: "https://open.toronto.ca/dataset/cycling-network/",
    title: "City of Toronto — Cycling Network",
    year: 2025,
    description: "Bike lanes and cycling routes across the city.",
  },
  bikeshare: {
    id: "bikeshare",
    domain: "open.toronto.ca",
    url: "https://open.toronto.ca/dataset/bike-share-toronto/",
    title: "Bike Share Toronto",
    year: 2025,
    description: "Bike Share Toronto docking-station locations (GBFS).",
  },
  playscore: {
    id: "playscore",
    domain: "sciencedirect.com",
    url: "https://www.sciencedirect.com/science/article/pii/S026427512500945X",
    title: "UBC Playability Index (Gemmell et al.)",
    year: 2026,
    description:
      "Geospatial index of urban playability for young children.",
  },
  ontarioSchools: {
    id: "ontarioSchools",
    domain: "data.ontario.ca",
    url: "https://data.ontario.ca/dataset/school-information-and-student-demographics",
    title: "Ontario — School Information",
    year: 2025,
    description: "Ontario school locations, levels, and types.",
  },
  ontarioChildCare: {
    id: "ontarioChildCare",
    domain: "data.ontario.ca",
    url: "https://data.ontario.ca/dataset/licensed-child-care-facilities",
    title: "Ontario — Licensed Child Care",
    year: 2025,
    description: "Licensed child-care and daycare locations.",
  },
  fraser: {
    id: "fraser",
    domain: "fraserinstitute.org",
    url: "https://www.fraserinstitute.org/school-performance",
    title: "Fraser Institute — School Rankings",
    year: 2025,
    description: "Annual Ontario school report-card ratings.",
  },
};

export interface MetricNode {
  key: string;
  label: string;
  definition: string;
  /** Present on leaves only — the sub-score key used by the scorer. */
  leaf?: LeafMetricKey;
  /** Optional data-source attribution shown under the definition. */
  sourceIds?: string[];
  children?: MetricNode[];
  /** Render this node as a slider control instead of a checkbox. */
  control?: "slider";
  /** Slider bounds (only used when control === "slider"). */
  min?: number;
  max?: number;
}

export const METRIC_TREE: MetricNode[] = [
  {
    key: "playability",
    label: "Playability score",
    definition:
      "Overall neighbourhood playability for young children; a weighted combination of the five domains below.",
    sourceIds: ["playscore", "osm", "statcan"],
    children: [
      {
        key: "traffic_env",
        leaf: "traffic_env",
        label: "Traffic environment",
        definition:
          "How safe and calm streets are for children — walking routes, cycling routes, intersections, and road types.",
        sourceIds: ["osm"],
      },
      {
        key: "space_for_play",
        leaf: "space_for_play",
        label: "Space for play",
        definition:
          "Availability of designated and informal places to play (playgrounds, parks, open and green space).",
        sourceIds: ["torontoParks", "osm"],
      },
      {
        key: "social_env",
        leaf: "social_env",
        label: "Social environment",
        definition:
          "Presence of other young children and family-oriented households nearby.",
        sourceIds: ["statcan"],
      },
      {
        key: "natural_env",
        leaf: "natural_env",
        label: "Natural environment",
        definition: "Access to nature — tree canopy and blue space (water).",
        sourceIds: ["torontoCanopy", "osm"],
      },
      {
        key: "destinations",
        leaf: "destinations",
        label: "Child-relevant destinations",
        definition:
          "Access to places that matter to children (e.g., schools, libraries, community centres).",
        sourceIds: ["osm"],
      },
    ],
  },
  {
    key: "education",
    label: "Education score",
    definition:
      "Access to child-relevant education and care — early learning, daycare, and schools by level and quality.",
    sourceIds: ["ontarioSchools", "fraser"],
    children: [
      {
        key: "edu_montessori",
        leaf: "edu_montessori",
        label: "Alternative & enriched programs",
        definition:
          "Proximity to alternative and enriched education — Montessori, Waldorf, IB (International Baccalaureate), gifted programs, and specialized programs like TOPS, MaST, and UTS.",
        sourceIds: ["ontarioSchools"],
      },
      {
        key: "edu_daycare",
        leaf: "edu_daycare",
        label: "Daycare",
        definition: "Access to licensed daycare and child-care centres.",
        sourceIds: ["ontarioChildCare"],
      },
      {
        key: "edu_afterschool",
        leaf: "edu_afterschool",
        label: "After-school programs",
        definition: "Availability of licensed after-school care programs.",
        sourceIds: ["ontarioChildCare"],
      },
      {
        key: "edu_k8",
        leaf: "edu_k8",
        label: "Kindergarten – Grade 8",
        definition:
          "Proximity to elementary and middle schools (JK through grade 8).",
        sourceIds: ["ontarioSchools"],
      },
      {
        key: "edu_9_12",
        leaf: "edu_9_12",
        label: "9–12",
        definition: "Proximity to grade 9–12 secondary schools.",
        sourceIds: ["ontarioSchools"],
      },
      {
        key: "edu_private",
        leaf: "edu_private",
        label: "Private school",
        definition: "Access to independent/private schools.",
        sourceIds: ["ontarioSchools"],
      },
      {
        key: "edu_fraser",
        leaf: "edu_fraser",
        control: "slider",
        min: 0,
        max: 10,
        label: "Fraser Institute rating",
        definition:
          "Minimum school ranking (out of 10) required to fully count.",
        sourceIds: ["fraser"],
      },
    ],
  },
  {
    key: "walk",
    leaf: "walk",
    label: "Walk score",
    definition:
      "How walkable the area is — sidewalk coverage, intersection density, and walking access to everyday destinations.",
    sourceIds: ["canale"],
  },
  {
    key: "transit",
    label: "Public transit score",
    definition: "Quality of transit access near the neighbourhood.",
    sourceIds: ["ttc", "metrolinx"],
    children: [
      {
        key: "transit_bus",
        leaf: "transit_bus",
        label: "Bus",
        definition: "Proximity and frequency of bus service.",
        sourceIds: ["ttc"],
      },
      {
        key: "transit_subway",
        leaf: "transit_subway",
        label: "Subway / metro",
        definition: "Proximity to subway/metro stations and lines.",
        sourceIds: ["ttc"],
      },
      {
        key: "transit_streetcar",
        leaf: "transit_streetcar",
        label: "Streetcar",
        definition: "Proximity and frequency of streetcar routes.",
        sourceIds: ["ttc"],
      },
      {
        key: "transit_go",
        leaf: "transit_go",
        label: "GO Transit",
        definition: "Proximity to regional GO Transit rail/bus stations.",
        sourceIds: ["metrolinx"],
      },
    ],
  },
  {
    key: "biking",
    label: "Biking score",
    definition: "How bike-friendly the area is.",
    sourceIds: ["canbics", "torontoCycling", "bikeshare"],
    children: [
      {
        key: "bike_lanes",
        leaf: "bike_lanes",
        label: "Cycling trails and protected bike lanes",
        definition:
          "Coverage and connectivity of cycling trails and streets with protected bike lanes.",
        sourceIds: ["torontoCycling"],
      },
      {
        key: "bike_safety",
        leaf: "bike_safety",
        label: "Cycling safety",
        definition:
          "Collision risk and protected-infrastructure presence on cycling routes.",
        sourceIds: ["canbics"],
      },
      {
        key: "bike_share",
        leaf: "bike_share",
        label: "Bike Share Toronto",
        definition: "Docking stations for Toronto's bike share program.",
        sourceIds: ["bikeshare"],
      },
    ],
  },
];

/** All leaf metric keys, flattened. */
export const ALL_LEAF_KEYS: LeafMetricKey[] = (function collect(
  nodes: MetricNode[],
): LeafMetricKey[] {
  const out: LeafMetricKey[] = [];
  for (const n of nodes) {
    if (n.leaf) out.push(n.leaf);
    if (n.children) out.push(...collect(n.children));
  }
  return out;
})(METRIC_TREE);

/** Leaves that are checked by default (the Playability domains). */
export const DEFAULT_CHECKED_LEAVES: LeafMetricKey[] = [
  "traffic_env",
  "space_for_play",
  "social_env",
  "natural_env",
  "destinations",
];

/** Returns the leaf keys under a node (or the node itself if it is a leaf). */
export function leavesOf(node: MetricNode): LeafMetricKey[] {
  if (node.leaf) return [node.leaf];
  if (!node.children) return [];
  return node.children.flatMap(leavesOf);
}

/** Resolve a list of source ids to their MetricSource records (ignoring unknown ids). */
export function sourcesFor(ids?: string[]): MetricSource[] {
  if (!ids) return [];
  return ids
    .map((id) => SOURCE_REGISTRY[id])
    .filter((s): s is MetricSource => s !== undefined);
}

export const CENSUS_CHARACTERISTICS = [
  { key: "population", label: "Population", unit: "persons" },
  { key: "pop_density", label: "Population density", unit: "persons per km²" },
  { key: "low_income_prop", label: "Low income proportion", unit: "%" },
  {
    key: "children_under15_prop",
    label: "Proportion children under 15",
    unit: "%",
  },
] as const;

export type CensusCharacteristicKey =
  (typeof CENSUS_CHARACTERISTICS)[number]["key"];
