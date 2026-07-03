"use client";

import * as React from "react";
import {
  Plus,
  Trash2,
  Bike,
  Car,
  Footprints,
  Bus,
  Route,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { emojiForTag } from "@/lib/emoji";
import type { PlaceRow, TravelMode } from "@/lib/types";

export const MODE_ICON: Record<TravelMode, React.ReactNode> = {
  walk: <Footprints className="h-4 w-4" />,
  bike: <Bike className="h-4 w-4" />,
  drive: <Car className="h-4 w-4" />,
  transit: <Bus className="h-4 w-4" />,
  any: <Route className="h-4 w-4" />,
};

const MODE_OPTIONS: { value: TravelMode; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "walk", label: "Walk" },
  { value: "bike", label: "Bike" },
  { value: "drive", label: "Drive" },
  { value: "transit", label: "Transit" },
];

/** A single commute row: address input + mode toggle + remove. */
export function CommuteRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: PlaceRow;
  onChange: (next: PlaceRow) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border p-2">
      {/* Row 1: name + delete */}
      <div className="mb-1.5 flex items-center gap-2">
        <Input
          value={row.label ?? ""}
          placeholder="Name (optional)"
          onChange={(e) => onChange({ ...row, label: e.target.value })}
          className="h-8 flex-1 text-xs"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 border border-border/60"
          aria-label="Remove place"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {/* Row 2: address on its own row */}
      <Input
        value={row.target}
        placeholder="Address or place"
        onChange={(e) => onChange({ ...row, target: e.target.value })}
        className="h-8 text-xs"
      />
      {/* Row 3: the commute sentence — Max [n] min commute by [mode].
          Enforced as ONE line (no wrapping); the panel is sized to fit it. */}
      <div className="mt-2 flex flex-nowrap items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <span className="shrink-0">Max</span>
        <Input
          type="number"
          min={1}
          placeholder="any"
          value={row.underMinutes ?? ""}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            onChange({
              ...row,
              underMinutes: Number.isNaN(parsed) ? undefined : parsed,
            });
          }}
          className="h-7 min-w-14 flex-1 text-xs"
        />
        <span className="shrink-0">min commute by</span>
        <Select
          value={row.mode}
          onValueChange={(v) => onChange({ ...row, mode: v as TravelMode })}
        >
          <SelectTrigger className="h-7 w-[92px] shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** A list of commute rows with an "Add place" button. */
export function CommuteList({
  rows,
  onChange,
  onEdited,
}: {
  rows: PlaceRow[];
  onChange: (rows: PlaceRow[]) => void;
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
      { id: `commute-${Date.now()}`, target: "", mode: "any" },
    ]);
    onEdited();
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <CommuteRowEditor
          key={row.id}
          row={row}
          onChange={(next) => update(row.id, next)}
          onRemove={() => remove(row.id)}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        onClick={add}
      >
        <Plus className="h-3.5 w-3.5" /> Add place
      </Button>
    </div>
  );
}

/**
 * Comma/word tag input rendering removable Badge chips. Each chip is stored as
 * a `PlaceRow` (info-only, mode "walk") so it flows into the detail sheet.
 */
export function NearbyTagInput({
  rows,
  onChange,
  onEdited,
  tagEmoji,
  onEditEmoji,
}: {
  rows: PlaceRow[];
  onChange: (rows: PlaceRow[]) => void;
  onEdited: () => void;
  tagEmoji: Record<string, string>;
  onEditEmoji: (tag: string) => void;
}) {
  const [draft, setDraft] = React.useState("");

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const existing = new Set(rows.map((r) => r.target.toLowerCase()));
    const additions: PlaceRow[] = [];
    for (const p of parts) {
      if (existing.has(p.toLowerCase())) continue;
      existing.add(p.toLowerCase());
      additions.push({
        id: `nearby-${Date.now()}-${additions.length}`,
        target: p,
        mode: "walk",
      });
    }
    if (additions.length > 0) {
      onChange([...rows, ...additions]);
      onEdited();
    }
    setDraft("");
  }

  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id));
    onEdited();
  }

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <Badge
              key={r.id}
              variant="secondary"
              className="gap-1 pl-1 pr-1 text-xs font-normal"
            >
              <button
                type="button"
                aria-label={`Change emoji for ${r.target}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditEmoji(r.target);
                }}
                className="inline-flex items-center justify-center rounded-sm leading-none hover:bg-muted-foreground/20"
              >
                {emojiForTag(r.target, tagEmoji)}
              </button>
              {r.target}
              <button
                type="button"
                aria-label={`Remove ${r.target}`}
                onClick={() => remove(r.id)}
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        placeholder="Add a tag and press Enter"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          }
        }}
        onBlur={() => commit(draft)}
        className="h-8 text-xs"
      />
    </div>
  );
}
