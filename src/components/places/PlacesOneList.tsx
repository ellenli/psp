"use client";

import * as React from "react";
import { CommuteList } from "@/components/places/shared";
import type { PlaceRow } from "@/lib/types";

/**
 * Variant B — "One list, info-only".
 * A single list of rows (address + mode). No rank/show toggle, no cap.
 */
export function PlacesOneList({
  commutes,
  onCommutesChange,
  onEdited,
}: {
  commutes: PlaceRow[];
  onCommutesChange: (rows: PlaceRow[]) => void;
  onEdited: () => void;
}) {
  return (
    <CommuteList
      rows={commutes}
      onChange={onCommutesChange}
      onEdited={onEdited}
    />
  );
}
