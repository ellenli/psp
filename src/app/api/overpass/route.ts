import { NextResponse } from "next/server";
import { fetchOverpassTag } from "@/lib/overpassServer";

// Server-side proxy to the OpenStreetMap Overpass API. Browsers can't set a
// custom User-Agent and are frequently blocked/CORS-rejected; calling from the
// server with a proper UA fixes that. Accepts { bbox: [s,w,n,e], tags: [] } and
// returns { pois }. All errors fall back to { pois: [] } so callers never break.
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      bbox?: [number, number, number, number];
      tags?: string[];
    };
    const bbox = body.bbox;
    const tags = (body.tags ?? []).map((t) => t.trim()).filter(Boolean);
    if (!bbox || bbox.length !== 4 || tags.length === 0) {
      return NextResponse.json({ pois: [] });
    }
    const [s, w, n, e] = bbox;
    const perTag = await Promise.all(
      tags.map((tag) => fetchOverpassTag(tag, s, w, n, e)),
    );
    return NextResponse.json({ pois: perTag.flat() });
  } catch {
    return NextResponse.json({ pois: [] });
  }
}
