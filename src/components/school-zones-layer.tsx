"use client";

import * as React from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLng, PathOptions } from "leaflet";
import {
  PRIVATE_SCHOOLS,
  SCHOOL_NOTES,
  SCHOOL_ZONES,
  gradeLabel,
  zoneStats,
  type CatchmentData,
  type CatchmentPolygon,
  type SchoolZone,
} from "@/lib/schoolZones";

export interface SchoolZonesVisibility {
  hs: boolean;
  elem: boolean;
  pins: boolean;
}

type Kind = "hs" | "shared" | "elem";

let catchmentsPromise: Promise<CatchmentData | null> | null = null;
function loadCatchments() {
  catchmentsPromise ??= fetch("/data/school-catchments.json")
    .then((r) => (r.ok ? (r.json() as Promise<CatchmentData>) : null))
    .catch(() => null);
  return catchmentsPromise;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function zoneTipHtml(z: SchoolZone, what: string) {
  return (
    `<div class="sz-tip-h"><span class="sz-rank" style="background:${z.color}">${z.rank}</span>${esc(z.name)}</div>` +
    `<div class="sz-tip-what">${esc(what)}</div><dl>` +
    zoneStats(z).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("") +
    `</dl><div class="sz-tip-src">2021 Census · ${esc(z.demo.areas)}</div>`
  );
}

function pinIcon(kind: "hs" | "elem" | "private") {
  const svg =
    kind === "hs"
      ? '<svg width="22" height="22" viewBox="0 0 22 22"><rect x="2" y="2" width="18" height="18" rx="4" fill="#18181b" stroke="#fff" stroke-width="2"/><text x="11" y="15.5" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">H</text></svg>'
      : kind === "elem"
        ? '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#fff" stroke="#18181b" stroke-width="2.5"/><text x="10" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="#18181b" font-family="system-ui,sans-serif">E</text></svg>'
        : '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 1.8l3.1 6.4 7 1-5.1 4.9 1.2 7L12 17.8l-6.2 3.3 1.2-7L1.9 9.2l7-1z" fill="#d97706" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const size = kind === "elem" ? 20 : 22;
  return L.divIcon({ className: "sz-pin", html: svg, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

/** Label anchor: area-weighted centroid of the largest outer ring. */
function labelPoint(polys: CatchmentPolygon[]): [number, number] {
  let best: [number, number] = polys[0][0][0];
  let bestA = 0;
  for (const p of polys) {
    const r = p[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < r.length; i++) {
      const [y1, x1] = r[i === 0 ? r.length - 1 : i - 1];
      const [y2, x2] = r[i];
      const f = x1 * y2 - x2 * y1;
      a += f;
      cx += (x1 + x2) * f;
      cy += (y1 + y2) * f;
    }
    if (Math.abs(a) > bestA) {
      bestA = Math.abs(a);
      best = [cy / (3 * a), cx / (3 * a)];
    }
  }
  return best;
}

function style(z: SchoolZone, kind: Kind, hot: boolean): PathOptions {
  if (kind === "hs") return { color: z.color, weight: hot ? 3.5 : 2.5, dashArray: "7 5", fillColor: z.color, fillOpacity: hot ? 0.2 : 0.08 };
  if (kind === "shared") return { color: z.color, weight: hot ? 3 : 2, dashArray: "2 5", fillColor: z.color, fillOpacity: hot ? 0.14 : 0.04 };
  return { color: z.color, weight: hot ? 3.5 : 2.25, fillColor: z.color, fillOpacity: hot ? 0.5 : 0.3 };
}

interface Built {
  hs: L.LayerGroup;
  elem: L.LayerGroup;
  hsLabels: L.LayerGroup;
  elemLabels: L.LayerGroup;
  pins: L.LayerGroup;
}

function build(C: CatchmentData, onZoneClick: (latlng: LatLng) => void): Built {
  const groups: Built = { hs: L.layerGroup(), elem: L.layerGroup(), hsLabels: L.layerGroup(), elemLabels: L.layerGroup(), pins: L.layerGroup() };
  const owners: Record<string, string[]> = {};
  for (const [sn, s] of Object.entries(C.schools)) for (const k of s.layers) (owners[k] ??= []).push(sn);
  const byZone: Record<string, { layer: L.Polygon; kind: Kind }[]> = {};
  const highlight = (z: SchoolZone, on: boolean) => {
    for (const { layer, kind } of byZone[z.id]) layer.setStyle(style(z, kind, on));
  };
  const drawn = new Set<string>();

  for (const z of SCHOOL_ZONES) {
    byZone[z.id] = [];
    const add = (kind: "hs" | "elem", sn: string) => {
      const s = C.schools[sn];
      if (!s) return;
      for (const key of s.layers) {
        if (drawn.has(key) || !C.layers[key]) continue;
        drawn.add(key);
        const shared = kind === "hs" && owners[key].length > 1;
        const k: Kind = shared ? "shared" : kind;
        const what = shared
          ? `Shared high-school zone — choice of ${owners[key].map((o) => C.schools[o].name).join(" or ")}`
          : kind === "hs"
            ? `High-school catchment — ${s.name}`
            : `Elementary catchment — ${s.name} (${gradeLabel(s.grades)})`;
        const layer = L.polygon(C.layers[key], style(z, k, false));
        layer.bindTooltip(zoneTipHtml(z, what), { sticky: true, direction: "top", offset: [0, -12], className: "sz-tip", opacity: 1 });
        layer.on("mouseover", () => highlight(z, true));
        layer.on("mouseout", () => highlight(z, false));
        // Zones sit above the neighbourhood choropleth; pass clicks through so
        // the detail panel still opens for the neighbourhood underneath.
        layer.on("click", (e) => onZoneClick(e.latlng));
        layer.addTo(kind === "hs" ? groups.hs : groups.elem);
        byZone[z.id].push({ layer, kind: k });
        if (!shared && s.layers[0] === key) {
          const short = kind === "hs" ? s.name : s.name.replace(/ (Jr|Jr & Sr|Dr) ?(PS|EMS)$| (PS|CS)$/, "");
          L.marker(labelPoint(C.layers[key]), {
            pane: "shadowPane",
            interactive: false,
            icon: L.divIcon({
              className: `sz-label sz-label-${kind}`,
              html: `<div style="--c:${z.color}"><span class="k">${kind === "hs" ? "High school zone" : "Elementary zone"}</span>${esc(short)}</div>`,
              iconSize: undefined,
            }),
          }).addTo(kind === "hs" ? groups.hsLabels : groups.elemLabels);
        }
      }
      const note = SCHOOL_NOTES[sn];
      L.marker([s.lat, s.lng], { icon: pinIcon(kind), zIndexOffset: kind === "hs" ? 200 : 100 })
        .bindTooltip(
          `<b>${esc(s.name)}</b><br>Public ${kind === "hs" ? "high school" : "elementary"} · ${gradeLabel(s.grades)}${note ? `<br>${esc(note)}` : ""}`,
          { direction: "top", offset: [0, -10], className: "sz-tip sz-tip-pin" },
        )
        .addTo(groups.pins);
    };
    z.hs.forEach((sn) => add("hs", sn));
    z.elem.forEach((sn) => add("elem", sn));
  }
  for (const p of PRIVATE_SCHOOLS) {
    L.marker([p.lat, p.lng], { icon: pinIcon("private"), zIndexOffset: 300 })
      .bindTooltip(`<b>${esc(p.name)}</b><br>Private · ${esc(p.note)}`, { direction: "top", offset: [0, -10], className: "sz-tip sz-tip-pin" })
      .addTo(groups.pins);
  }
  return groups;
}

/**
 * TDSB catchments for the top school neighbourhoods: dashed outlines are
 * high-school zones, solid fills elementary zones, dotted outlines shared
 * (choice) zones. Hovering a zone shows the neighbourhood, drive to MDA and
 * 2021 Census demographics.
 */
export function SchoolZonesLayer({
  show,
  onZoneClick,
}: {
  show: SchoolZonesVisibility;
  onZoneClick: (latlng: LatLng) => void;
}) {
  const map = useMap();
  const [built, setBuilt] = React.useState<Built | null>(null);
  const clickRef = React.useRef(onZoneClick);
  React.useEffect(() => {
    clickRef.current = onZoneClick;
  }, [onZoneClick]);

  React.useEffect(() => {
    let active = true;
    loadCatchments().then((C) => {
      if (active && C) setBuilt(build(C, (ll) => clickRef.current(ll)));
    });
    return () => {
      active = false;
    };
  }, []);

  // Elementary labels only once zoomed in; high-school labels drop their
  // "zone" kicker when zoomed out.
  React.useEffect(() => {
    const el = map.getContainer();
    const sync = () => el.classList.toggle("sz-zoomed", map.getZoom() >= 13);
    sync();
    map.on("zoomend", sync);
    return () => {
      map.off("zoomend", sync);
      el.classList.remove("sz-zoomed");
    };
  }, [map]);

  React.useEffect(() => {
    if (!built) return;
    // Re-add in a fixed order so elementary fills always sit above high-school
    // zones (panes share a z-index in this app, so DOM order decides).
    const order: [keyof Built, boolean][] = [
      ["hs", show.hs],
      ["elem", show.elem],
      ["hsLabels", show.hs],
      ["elemLabels", show.elem],
      ["pins", show.pins],
    ];
    for (const [g] of order) map.removeLayer(built[g]);
    for (const [g, on] of order) if (on) map.addLayer(built[g]);
    // The choropleth is re-created whenever scores change, landing on top of
    // the zones in the shared SVG; raise the zones back above it.
    const raise = (e: L.LayerEvent) => {
      if (!(e.layer instanceof L.GeoJSON)) return;
      built.hs.eachLayer((l) => (l as L.Path).bringToFront());
      built.elem.eachLayer((l) => (l as L.Path).bringToFront());
    };
    map.on("layeradd", raise);
    return () => {
      map.off("layeradd", raise);
      for (const [g] of order) map.removeLayer(built[g]);
    };
  }, [built, show.hs, show.elem, show.pins, map]);

  return null;
}
