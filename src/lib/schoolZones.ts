// Top school neighbourhoods with their TDSB catchments, MDA drive times and
// 2021 Census demographics. Boundary polygons live in
// public/data/school-catchments.json (downloaded from the TDSB School Search
// Map KML on 2026-09-30, simplified to ~4 m); the zones here reference them by
// TDSB school number.

export interface ZoneDemographics {
  /** Census neighbourhoods the zone spans. */
  areas: string;
  /** Median total household income, $k (one value, or [min, max] across areas). */
  inc: number[];
  /** Low-income prevalence (LIM-AT), %. */
  lowInc: number;
  /** Households that own their home, %. */
  owners: number;
  /** Adults 25–64 with a bachelor's degree or higher, %. */
  degree: number;
  medAge: number;
  /** Population under 15, %. */
  kids: number;
  /** Population 65+, %. */
  seniors: number;
  /** Visible minority population, %. */
  vm: number;
  /** Largest visible-minority groups, [group, %]. */
  top: [string, number][];
}

export interface SchoolZone {
  id: string;
  rank: number;
  name: string;
  color: string;
  /** Measured one-way drive to MDA (Brampton), minutes; null if not measured. */
  mda: number | null;
  /** Rough estimate shown when `mda` is null. */
  mdaEst?: number;
  blurb: string;
  /** TDSB school numbers of the high schools / elementary schools in the zone. */
  hs: string[];
  elem: string[];
  demo: ZoneDemographics;
}

export interface CatchmentSchool {
  name: string;
  grades: string | null;
  lat: number;
  lng: number;
  /** TDSB layer keys ("Secondary/2"); a key under several schools is a shared zone. */
  layers: string[];
}

/** Polygons as [lat, lng] rings: first ring outer, the rest holes. */
export type CatchmentPolygon = [number, number][][];

export interface CatchmentData {
  schools: Record<string, CatchmentSchool>;
  layers: Record<string, CatchmentPolygon[]>;
}

export const SCHOOL_ZONES: SchoolZone[] = [
  {
    id: "lawrence", rank: 1, name: "Lawrence Park / Bedford Park", color: "#2563eb", mda: 27,
    blurb: "Best all-round. Strong public JK–6 schools with a by-address path to Lawrence Park CI or North Toronto CI; Havergal nearby, easy reach of Crescent and TFS.",
    hs: ["5525", "5540"], elem: ["5296", "5297", "5204", "5308"],
    demo: { areas: "Lawrence Park North + South, Bedford Park-Nortown", inc: [135, 168], lowInc: 6.7, owners: 70, degree: 74, medAge: 43, kids: 18, seniors: 18, vm: 25, top: [["Chinese", 8], ["Filipino", 4], ["South Asian", 4]] },
  },
  {
    id: "foresthill", rank: 2, name: "Forest Hill", color: "#7c3aed", mda: null, mdaEst: 30,
    blurb: "Best if private is the plan: UCC, BSS and Alive Montessori to Gr 6, plus a solid Forest Hill Jr → Forest Hill CI path.",
    hs: ["5508"], elem: ["5337"],
    demo: { areas: "Forest Hill South + North", inc: [90, 109], lowInc: 10.3, owners: 42, degree: 65, medAge: 44, kids: 14, seniors: 22, vm: 27, top: [["Filipino", 8], ["Black", 4], ["Chinese", 3]] },
  },
  {
    id: "rosedale", rank: 3, name: "Rosedale / Summerhill", color: "#db2777", mda: 34,
    blurb: "Branksome, Cottingham (10/10), camps, the ROM and the Conservatory close by. By address the high school is Jarvis CI (Whitney/Moore Park feeds North Toronto CI).",
    hs: ["5520"], elem: ["5213", "5271", "5307"],
    demo: { areas: "Rosedale-Moore Park", inc: [122], lowInc: 8.8, owners: 58, degree: 76, medAge: 50, kids: 12, seniors: 28, vm: 22, top: [["Chinese", 6], ["South Asian", 5], ["Black", 2]] },
  },
  {
    id: "yorkmills", rank: 4, name: "York Mills / Bayview", color: "#0891b2", mda: null, mdaEst: 30,
    blurb: "Denlow → York Mills CI, near Crescent, TFS (IB) and Bayview Glen; Central Montessori.",
    hs: ["3450"], elem: ["3173"],
    demo: { areas: "Bridle Path-Sunnybrook-York Mills, St.Andrew-Windfields", inc: [118, 222], lowInc: 11.7, owners: 72, degree: 69, medAge: 47, kids: 14, seniors: 22, vm: 49, top: [["Chinese", 22], ["West Asian", 7], ["South Asian", 6]] },
  },
  {
    id: "leaside", rank: 5, name: "Leaside", color: "#16a34a", mda: 32,
    blurb: "Bessborough (9.9) → Leaside HS; Maria Montessori, a music school, Leaside Gardens rink and pool. Fewer private high schools.",
    hs: ["1836"], elem: ["1412"],
    demo: { areas: "Leaside-Bennington", inc: [148], lowInc: 5.8, owners: 72, degree: 72, medAge: 44, kids: 18, seniors: 17, vm: 22, top: [["Chinese", 8], ["South Asian", 3], ["West Asian", 2]] },
  },
  {
    id: "willowdale", rank: 6, name: "Willowdale", color: "#ca8a04", mda: null, mdaEst: 30,
    blurb: "McKee → Earl Haig (enrolment limits); Claude Watson arts at Earl Haig is by audition only.",
    hs: ["3430"], elem: ["3198"],
    demo: { areas: "Willowdale West, Yonge-Doris, East Willowdale", inc: [73, 95], lowInc: 19.8, owners: 60, degree: 70, medAge: 40, kids: 12, seniors: 18, vm: 75, top: [["Chinese", 33], ["West Asian", 11], ["Korean", 11]] },
  },
  {
    id: "highpark", rank: 7, name: "High Park / Swansea", color: "#ea580c", mda: 26,
    blurb: "Swansea → Humberside; a Montessori, High Park kids' programs, Swansea Kids' Place after-school care (waitlist).",
    hs: ["5515"], elem: ["5311"],
    demo: { areas: "High Park-Swansea", inc: [101], lowInc: 8.5, owners: 60, degree: 67, medAge: 41, kids: 15, seniors: 16, vm: 23, top: [["South Asian", 5], ["Chinese", 4], ["Black", 4]] },
  },
  {
    id: "riverdale", rank: 8, name: "Riverdale / Leslieville", color: "#dc2626", mda: 32,
    blurb: "Withrow → Riverdale CI; Montcrest (JK–8), Jimmie Simpson rec centre.",
    hs: ["5555"], elem: ["5285"],
    demo: { areas: "North Riverdale, South Riverdale", inc: [100, 108], lowInc: 10.7, owners: 57, degree: 59, medAge: 40, kids: 15, seniors: 14, vm: 36, top: [["Chinese", 16], ["Black", 5], ["South Asian", 4]] },
  },
  {
    id: "beach", rank: 9, name: "The Beach", color: "#475569", mda: 38,
    blurb: "Balmy Beach → Malvern CI; Beaches Montessori, great outdoors.",
    hs: ["5530"], elem: ["5203"],
    demo: { areas: "The Beaches", inc: [116], lowInc: 7.9, owners: 63, degree: 65, medAge: 44, kids: 17, seniors: 17, vm: 16, top: [["South Asian", 3], ["Chinese", 3], ["Black", 2]] },
  },
];

/** Extra detail shown on public-school pins, keyed by TDSB school number. */
export const SCHOOL_NOTES: Record<string, string> = {
  "5525": "By-address path from Lawrence Park",
  "5540": "By-address path from Lawrence Park",
  "5213": "Rated 10/10",
  "1412": "Rated 9.9",
  "3430": "Enrolment limits · Claude Watson arts program by audition",
};

export const PRIVATE_SCHOOLS = [
  { name: "Havergal College", lat: 43.72007, lng: -79.41399, note: "Girls · JK–12" },
  { name: "Crescent School", lat: 43.73302, lng: -79.3796, note: "Boys · Gr 3–12" },
  { name: "Toronto French School", lat: 43.7288, lng: -79.38374, note: "Co-ed · bilingual · IB" },
  { name: "Upper Canada College", lat: 43.69292, lng: -79.40375, note: "Boys · SK–12 · IB" },
  { name: "Bishop Strachan School", lat: 43.69075, lng: -79.40919, note: "Girls · JK–12" },
  { name: "Branksome Hall", lat: 43.67534, lng: -79.38, note: "Girls · JK–12 · IB" },
  { name: "Bayview Glen", lat: 43.76091, lng: -79.35141, note: "Co-ed · preschool–12 · IB" },
  { name: "Montcrest School", lat: 43.67316, lng: -79.35753, note: "Co-ed · JK–8" },
];

/** "JK–06" → "JK–6". */
export const gradeLabel = (g: string | null) => (g ? g.replace(/0(\d)/g, "$1") : "");

export function zoneMda(z: SchoolZone): string {
  return z.mda != null ? `${z.mda} min` : `not measured (≈${z.mdaEst} est.)`;
}

/** Label/value rows for a zone's hover card. */
export function zoneStats(z: SchoolZone): [string, string][] {
  const d = z.demo;
  const inc = d.inc.length > 1 ? `$${d.inc[0]}k–$${d.inc[1]}k` : `$${d.inc[0]}k`;
  return [
    ["Drive to MDA", zoneMda(z)],
    ["Socioeconomic", `Median household income ${inc} · ${d.lowInc}% low-income · ${d.owners}% own their home · ${d.degree}% of 25–64s hold a degree`],
    ["Age", `Median age ${d.medAge} · ${d.kids}% under 15 · ${d.seniors}% 65+`],
    ["Race", `${d.vm}% visible minority (${d.top.map(([g, p]) => `${g} ${p}%`).join(", ")}) · ${100 - d.vm}% not a visible minority`],
  ];
}
