"use client";

import * as React from "react";
import { CommuteList, NearbyTagInput } from "@/components/places/shared";
import type { PlaceRow } from "@/lib/types";

/**
 * Variant A — "Two sections, info-only".
 * "Commute to" (rows: address + mode) and "Nearby" (tag chips). Neither affects
 * the map score.
 */
export function PlacesTwoSections({
  commutes,
  nearby,
  onCommutesChange,
  onNearbyChange,
  onEdited,
  tagEmoji,
  onEditEmoji,
}: {
  commutes: PlaceRow[];
  nearby: PlaceRow[];
  onCommutesChange: (rows: PlaceRow[]) => void;
  onNearbyChange: (rows: PlaceRow[]) => void;
  onEdited: () => void;
  tagEmoji: Record<string, string>;
  onEditEmoji: (tag: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Commute to
        </p>
        <CommuteList
          rows={commutes}
          onChange={onCommutesChange}
          onEdited={onEdited}
        />
      </div>
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Nearby
        </p>
        <NearbyTagInput
          rows={nearby}
          onChange={onNearbyChange}
          onEdited={onEdited}
          tagEmoji={tagEmoji}
          onEditEmoji={onEditEmoji}
        />
      </div>
    </div>
  );
}
