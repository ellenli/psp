"use client";

import * as React from "react";
import { CommuteList, NearbyTagInput } from "@/components/places/shared";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { PlaceRow } from "@/lib/types";

/**
 * Variant C — "Info + optional score switch".
 * Same as Variant A, plus a single Switch "Factor commute into score"
 * (default off). Only when on do the commute rows contribute to the score.
 */
export function PlacesInfoPlusSwitch({
  commutes,
  nearby,
  factorCommute,
  onCommutesChange,
  onNearbyChange,
  onFactorCommuteChange,
  onEdited,
}: {
  commutes: PlaceRow[];
  nearby: PlaceRow[];
  factorCommute: boolean;
  onCommutesChange: (rows: PlaceRow[]) => void;
  onNearbyChange: (rows: PlaceRow[]) => void;
  onFactorCommuteChange: (on: boolean) => void;
  onEdited: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border p-2">
        <Label htmlFor="factor-commute" className="text-xs leading-tight">
          Factor commute into score
        </Label>
        <Switch
          id="factor-commute"
          checked={factorCommute}
          onCheckedChange={(v) => {
            onFactorCommuteChange(v);
            onEdited();
          }}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Commute to</p>
        <CommuteList
          rows={commutes}
          onChange={onCommutesChange}
          onEdited={onEdited}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Nearby</p>
        <NearbyTagInput
          rows={nearby}
          onChange={onNearbyChange}
          onEdited={onEdited}
          tagEmoji={{}}
          onEditEmoji={() => {}}
        />
      </div>
    </div>
  );
}
