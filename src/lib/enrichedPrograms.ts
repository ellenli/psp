// ---------------------------------------------------------------------------
// Curated registry of REAL Toronto alternative/enriched education programs.
//
// Why this exists: specialized programs (TOPS, MaST, IB, arts) are hosted
// INSIDE regular schools — OpenStreetMap only knows the host school's name
// ("Marc Garneau Collegiate Institute", no mention of TOPS), so tag/name
// matching can never surface them, and Google's text search only helps when a
// working key is configured. These are well-known, verifiable public programs;
// coordinates are the host school's location.
// ---------------------------------------------------------------------------

export interface EnrichedProgram {
  /** Program name shown in the panel. */
  name: string;
  /** Host school. */
  school: string;
  address: string;
  lat: number;
  lon: number;
}

export const ENRICHED_PROGRAMS: EnrichedProgram[] = [
  {
    name: "TOPS Program",
    school: "Marc Garneau Collegiate Institute",
    address: "135 Overlea Blvd, Toronto, ON",
    lat: 43.7057,
    lon: -79.3418,
  },
  {
    name: "TOPS Program",
    school: "Bloor Collegiate Institute",
    address: "1141 Bloor St W, Toronto, ON",
    lat: 43.6598,
    lon: -79.436,
  },
  {
    name: "MaST Program",
    school: "Danforth Collegiate and Technical Institute",
    address: "800 Greenwood Ave, Toronto, ON",
    lat: 43.6845,
    lon: -79.3298,
  },
  {
    name: "University of Toronto Schools (UTS)",
    school: "University of Toronto Schools",
    address: "371 Bloor St W, Toronto, ON",
    lat: 43.6678,
    lon: -79.402,
  },
  {
    name: "International Baccalaureate (IB)",
    school: "Parkdale Collegiate Institute",
    address: "209 Jameson Ave, Toronto, ON",
    lat: 43.6372,
    lon: -79.4356,
  },
  {
    name: "International Baccalaureate (IB)",
    school: "Monarch Park Collegiate Institute",
    address: "1 Hanson St, Toronto, ON",
    lat: 43.681,
    lon: -79.323,
  },
  {
    name: "International Baccalaureate (IB)",
    school: "Victoria Park Collegiate Institute",
    address: "15 Wallingford Rd, North York, ON",
    lat: 43.7332,
    lon: -79.3253,
  },
  {
    name: "International Baccalaureate (IB)",
    school: "Weston Collegiate Institute",
    address: "100 Pine St, York, ON",
    lat: 43.7,
    lon: -79.514,
  },
  {
    name: "Arts Program",
    school: "Etobicoke School of the Arts",
    address: "675 Royal York Rd, Etobicoke, ON",
    lat: 43.644,
    lon: -79.499,
  },
  {
    name: "Arts Program",
    school: "Wexford Collegiate School for the Arts",
    address: "1176 Pharmacy Ave, Scarborough, ON",
    lat: 43.7519,
    lon: -79.2963,
  },
  {
    name: "Arts Program",
    school: "Claude Watson School for the Arts",
    address: "130 Doris Ave, North York, ON",
    lat: 43.766,
    lon: -79.411,
  },
];
