"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  METRIC_TREE,
  sourcesFor,
  type LeafMetricKey,
  type MetricNode,
} from "@/lib/metrics";
import { SourcePills } from "@/components/source-pills";

type CheckedState = boolean | "indeterminate";

/** Leaves excluding any slider-control leaves (which never join the checkbox set). */
function checkboxLeavesOf(node: MetricNode): LeafMetricKey[] {
  if (node.control === "slider") return [];
  if (node.leaf) return [node.leaf];
  if (!node.children) return [];
  return node.children.flatMap(checkboxLeavesOf);
}

function nodeState(node: MetricNode, selected: Set<string>): CheckedState {
  const leaves = checkboxLeavesOf(node);
  if (leaves.length === 0) return false;
  const checked = leaves.filter((l) => selected.has(l)).length;
  if (checked === 0) return false;
  if (checked === leaves.length) return true;
  return "indeterminate";
}

function MetricItem({
  node,
  selected,
  onToggle,
  sliderValues,
  onSliderChange,
  depth,
}: {
  node: MetricNode;
  selected: Set<string>;
  onToggle: (leaves: LeafMetricKey[], checked: boolean) => void;
  sliderValues: Record<string, number>;
  onSliderChange: (key: string, value: number) => void;
  depth: number;
}) {
  const id = `metric-${node.key}`;
  const sources = sourcesFor(node.sourceIds);
  // Top-level groups are collapsible. A group starts EXPANDED when any of its
  // leaves are selected (e.g. the default-enabled Playability group) and
  // collapsed otherwise. (Declared before any early return — hooks must run
  // unconditionally.)
  const [open, setOpen] = React.useState(
    () => depth === 0 && nodeState(node, selected) !== false,
  );

  // Slider-control node: render a labelled range input, not a checkbox.
  if (node.control === "slider") {
    const min = node.min ?? 0;
    const max = node.max ?? 100;
    const key = node.leaf ?? node.key;
    const value = sliderValues[key] ?? min;
    return (
      <div className={depth > 0 ? "ml-6" : ""}>
        <div className="py-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={id} className="text-xs font-medium leading-tight">
              {node.label}
            </label>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {value === min ? "Any" : `${value}+`}
            </span>
          </div>
          <div className="mt-1">
            <Slider
              id={id}
              value={value}
              min={min}
              max={max}
              onValueChange={(v) => onSliderChange(key, v)}
            />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
            {node.definition}
            {sources.length > 0 && (
              <>
                {" "}
                <SourcePills sources={sources} />
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const state = nodeState(node, selected);
  const leaves = checkboxLeavesOf(node);
  const collapsible = depth === 0 && Boolean(node.children?.length);
  return (
    <div className={depth > 0 ? "ml-6" : ""}>
      <div className="flex items-start gap-2 py-1">
        <Checkbox
          id={id}
          checked={state}
          onCheckedChange={(v) => {
            onToggle(leaves, v === true);
            // Selecting a group reveals what was just enabled; deselecting
            // collapses it. The chevron still toggles independently.
            if (collapsible) setOpen(v === true);
          }}
          className="mt-0.5"
        />
        <div className="grid min-w-0 flex-1 gap-0.5">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="flex items-center gap-1 text-left text-xs font-medium leading-tight"
            >
              <span>{node.label}</span>
              {open ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
            </button>
          ) : (
            <label htmlFor={id} className="text-xs font-medium leading-tight">
              {node.label}
            </label>
          )}
          <div className="text-[11px] text-muted-foreground leading-snug">
            {node.definition}
            {sources.length > 0 && (
              <>
                {" "}
                <SourcePills sources={sources} />
              </>
            )}
          </div>
        </div>
      </div>
      {node.children && (!collapsible || open) && (
        <div className="border-l ml-2 pl-2">
          {node.children.map((child) => (
            <MetricItem
              key={child.key}
              node={child}
              selected={selected}
              onToggle={onToggle}
              sliderValues={sliderValues}
              onSliderChange={onSliderChange}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MetricTree({
  selected,
  onChange,
  sliderValues,
  onSliderChange,
}: {
  selected: Set<LeafMetricKey>;
  onChange: (next: Set<LeafMetricKey>) => void;
  sliderValues: Record<string, number>;
  onSliderChange: (key: string, value: number) => void;
}) {
  function handleToggle(leaves: LeafMetricKey[], checked: boolean) {
    const next = new Set(selected);
    for (const leaf of leaves) {
      if (checked) next.add(leaf);
      else next.delete(leaf);
    }
    onChange(next);
  }

  return (
    <div className="space-y-1">
      {METRIC_TREE.map((node) => (
        <MetricItem
          key={node.key}
          node={node}
          selected={selected as Set<string>}
          onToggle={handleToggle}
          sliderValues={sliderValues}
          onSliderChange={onSliderChange}
          depth={0}
        />
      ))}
    </div>
  );
}
