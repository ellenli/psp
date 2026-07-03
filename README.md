# PlayScore Plus

A single-page Next.js app for exploring Greater Toronto Area neighbourhoods by
**playability, walk, transit, and biking** scores plus the **places you care
about**. Pick a neighbourhood, choose which metrics to score on, add anchors
(addresses that rank the map "closer is better") and amenity keywords (shown in
the click detail), and read it all on two synced choropleth maps.

The maps frame the **full Greater Toronto Area** (Oakville → Milton → Uxbridge →
Whitby/Oshawa), matching the reach of the UBC PlayScore Toronto CMA. This map
**framing** is always active. Until you run the ETL (see **Data pipeline**), the
app shows **City-of-Toronto neighbourhoods (live) only**; running the ETL
produces the full-extent dataset (Toronto's 158 neighbourhoods + surrounding GTA
municipalities).

Built with **Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui** and
**react-leaflet** over OpenStreetMap tiles.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build && npm start   # production build
npx tsc --noEmit             # type-check
npm run lint                 # eslint
```

The app runs fully offline out of the box: it renders from the committed sample
dataset and uses seeded placeholder scores. No env vars or external services are
required to develop.

## Environment variables

Copy `.env.example` to `.env.local`. **All are optional** — unset vars fall back
to stubs.

| Var | Used by | Purpose |
| --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | `/api/places`, `/api/geocode`, `/api/route` | Google Places (New) place data + star ratings + real listing links; Google Geocoding; Google Directions with average weekday-morning traffic |

### Google key (ratings, listing links, traffic routing)

Set `GOOGLE_MAPS_API_KEY` in `.env.local` with **billing enabled** on the Cloud
project and these APIs on: **Places API (New)**, **Geocoding API**,
**Directions API**. Without a working key the app still uses **real data**, from
free sources: OpenStreetMap (Overpass) for places (no star ratings — those
don't exist in free data), Nominatim/Photon for geocoding, and OSRM/FOSSGIS for
real turn-by-turn routing (driving times scaled ×1.25 to approximate typical
traffic).

## What is real vs. placeholder

**Real / implemented:**
- Full Explore UI (neighbourhood combobox, metric checkbox tree with
  indeterminate parents, "Places you care about" rows, census selector).
- Leaflet choropleths with decile coloring + legends, click popups, and an
  inline click-detail panel.
- Composite scoring, `ntile` decile binning, and palette helpers
  (`src/lib/score.ts`).
- `/api/neighbourhoods`: **real** City of Toronto 158-neighbourhood boundaries.
- **Map place markers** (`/api/places`): Google Places (name, address, rating,
  reviews, real Google Maps listing link) or OSM fallback. **No synthetic
  markers anywhere** — if nothing real is available, nothing renders.
- **Detail-panel commutes** (`/api/geocode` + `/api/route`): real geocoding and
  real turn-by-turn routes with expandable directions.
- **Detail-panel nearby** (`/api/places`): real places, open by default, with
  ratings and Maps links.

**Seeded placeholders (clean interfaces, ready to swap):**
- Per-metric sub-scores and census values fall back to deterministic seeds in
  `src/lib/mockScores.ts` when the ETL hasn't been run (see Data pipeline);
  the ETL replaces them with real derived scores.
- The synthetic postal-code dot layer was **removed** (fake codes/scores);
  it can return once real postal-level PlayScore data is available.

## Data pipeline

`scripts/precompute-examples.mjs` (run locally with an **open network**:
`node scripts/precompute-examples.mjs`, ~10–25 min, resumable) precomputes
per-neighbourhood **metric examples** (real OSM parks, schools, stations, …)
into `public/data/metric-examples.json`. The detail panel then loads metric
counts/examples **instantly** from that file instead of querying the slow
public Overpass servers at click time (live Google/Overpass remain as the
rating-enrichment and fallback paths). Re-run occasionally to refresh.

`scripts/fetch-data.mjs` (run locally with an **open network**:
`node scripts/fetch-data.mjs`, takes a few minutes) computes **real
OpenStreetMap + open-census-based sub-scores** and writes them to
`public/data/neighbourhoods.json`, which `/api/neighbourhoods` prefers when
present (`source: "local-real-data"`). **Without running it, the app uses the
seeded modeled scores** from `src/lib/mockScores.ts`.

Running the ETL produces the **full-extent dataset** — Toronto's 158
neighbourhoods **plus** the surrounding GTA municipalities (Mississauga,
Brampton, Oakville, Milton, Markham, Vaughan, Pickering, Ajax, Whitby, Oshawa,
Clarington, Uxbridge, and the rest of the Toronto CMA reach). The map **framing**
already spans the full GTA regardless; **until the ETL is run, the app shows
City-of-Toronto neighbourhoods (live) only**, and full-extent **data** activates
only after the script writes `public/data/neighbourhoods.json`.

The added municipalities' **census is modeled** — only Toronto neighbourhoods
have open Neighbourhood-Profiles census, so municipalities fall back to the
app's modeled census values (population/density/low-income/children). All OSM-
derived leaf sub-scores are real for every area (Toronto + municipalities).

How it works:

- Fetches the real City of Toronto neighbourhood boundaries (158 areas,
  EPSG:4326), then **also** fetches surrounding GTA municipality boundaries
  (Statistics Canada 2021 Census Subdivisions / Ontario municipal boundaries via
  a GeoJSON endpoint) and **merges** them into the same feature set. The fetch is
  fully **defensive**: the source URLs live in `GTA_MUNICIPALITIES_SOURCE`, the
  whole fetch is wrapped in try/catch, and on any failure/unexpected shape it
  logs a warning and continues with Toronto neighbourhoods only. Municipalities
  are filtered by name to the GTA set, and a whole-Toronto CSD is excluded to
  avoid overlap with the 158 neighbourhoods.
- Uses a **GTA-wide bounding box** (≈ s=43.3, w=-80.05, n=44.4, e=-78.6) for the
  Overpass category queries so scoring data exists for the added municipalities.
- Issues **one Overpass query per OSM feature category** over the Toronto
  bounding box (not one query per neighbourhood), then assigns each returned
  element to a neighbourhood by **point-in-polygon** (ray casting; handles
  Polygon + MultiPolygon). Categories map to leaf scores:
  - **space_for_play** ← parks / playgrounds / pitches
  - **destinations** ← schools / libraries / community centres / kindergartens
  - **natural_env** ← parks + water + wood (greenspace/blue-space proxy)
  - **traffic_env** ← *reverse* density of primary/secondary/trunk roads
  - **walk** ← everyday POI density + footway/pedestrian ways
  - **transit_bus / transit_subway / transit_streetcar / transit_go** ← bus
    stops / subway stations / tram stops / regional rail stations
  - **bike_lanes / bike_safety** ← cycleway infrastructure; **bike_share** ←
    `amenity=bicycle_rental` / Bike Share Toronto network
  - **edu_montessori / edu_daycare / edu_afterschool / edu_k6 / edu_6_8 /
    edu_9_12 / edu_private** ← schools/childcare split by ISCED/name heuristics
- Normalizes each category's per-neighbourhood counts to **0–100 using
  within-city rank/percentile** (ntile-style, matching the app's decile
  coloring), reversing where noted (`traffic_env`). Categories with no data are
  left out so the runtime enrichment fills a modeled value.
- Joins **population / density / low-income % / children %** from the City of
  Toronto **Neighbourhood Profiles** (2021 Census) CSV via CKAN, and derives
  **social_env** as a normalized children-under-15 proportion.

**Approximate / modeled even after running the script:**

- **edu_fraser** — Fraser Institute school report-card ratings are
  **proprietary** and are *not* sourced; the app fills a modeled value.
- The playability domains and the exact playability-composite weighting are
  **approximations** derived from OSM, not the licensed originals (Can-ALE,
  GTFS, Can-BICS, UBC Playability Index).

Overpass calls are sequential with a ~1s delay to be polite, and each category
is wrapped in try/catch so a single failure never aborts the run.

## Deploy

1. **GitHub** — push this repo.
2. **Vercel** — import the repo; framework auto-detected as Next.js. Add the env
   vars above in the Vercel project settings (optional). Deploy.
3. **Routing** (optional) — create an OpenRouteService key, set `ORS_API_KEY`,
   wire the TODOs in `src/lib/routing.ts`. Add TravelTime/OTP for transit.

The original product spec lives in `docs/playscore_explore_prompt.md`.
