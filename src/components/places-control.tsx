"use client";

import * as React from "react";
import { Plus, Trash2, Bike, Car, Footprints, Bus, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlaceRow, TravelMode, PlaceBehavior } from "@/lib/types";

const MODE_ICON: Record<TravelMode, React.ReactNode> = {
  walk: <Footprints className="h-4 w-4" />,
  bike: <Bike className="h-4 w-4" />,
  drive: <Car className="h-4 w-4" />,
  transit: <Bus className="h-4 w-4" />,
  any: <Route className="h-4 w-4" />,
};

function PlaceRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: PlaceRow;
  onChange: (next: PlaceRow) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border p-2 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={row.target}
          placeholder="Address, place, or amenity keyword"
          onChange={(e) => onChange({ ...row, target: e.target.value })}
          className="h-8"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Remove place"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={row.mode}
          onValueChange={(v) =>
            v && onChange({ ...row, mode: v as TravelMode })
          }
        >
          {(["walk", "bike", "drive", "transit"] as TravelMode[]).map((m) => (
            <ToggleGroupItem key={m} value={m} aria-label={m} title={m}>
              {MODE_ICON[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Select
          value={row.behavior}
          onValueChange={(v) =>
            onChange({ ...row, behavior: v as PlaceBehavior })
          }
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rank">Rank map</SelectItem>
            <SelectItem value="click">Show on click</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {row.behavior === "rank" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={row.underMinutes !== undefined}
            onChange={(e) =>
              onChange({
                ...row,
                underMinutes: e.target.checked ? 30 : undefined,
              })
            }
          />
          only show under
          <Input
            type="number"
            min={1}
            disabled={row.underMinutes === undefined}
            value={row.underMinutes ?? ""}
            onChange={(e) =>
              onChange({ ...row, underMinutes: Number(e.target.value) })
            }
            className="h-6 w-16 text-xs"
          />
          min
        </label>
      )}
    </div>
  );
}

export function PlacesControl({
  rows,
  onChange,
  onEdited,
}: {
  rows: PlaceRow[];
  onChange: (rows: PlaceRow[]) => void;
  /** Called whenever the user edits/adds a row (reveals the save-search CTA). */
  onEdited: () => void;
}) {
  function update(id: string, next: PlaceRow) {
    onChange(rows.map((r) => (r.id === id ? next : r)));
    onEdited();
  }
  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id));
    onEdited();
  }
  function add() {
    onChange([
      ...rows,
      {
        id: `place-${Date.now()}`,
        target: "",
        mode: "walk",
        behavior: "click",
      },
    ]);
    onEdited();
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <PlaceRowEditor
          key={row.id}
          row={row}
          onChange={(next) => update(row.id, next)}
          onRemove={() => remove(row.id)}
        />
      ))}
      <Button variant="outline" size="sm" className="w-full" onClick={add}>
        <Plus className="h-4 w-4" /> Add place
      </Button>
    </div>
  );
}
