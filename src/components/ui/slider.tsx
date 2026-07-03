"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal shadcn-style slider built on a native `<input type="range">`,
 * styled with Tailwind. `onValueChange` fires with the numeric value.
 */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  className,
  ...props
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  className?: string;
} & Omit<
  React.ComponentPropsWithoutRef<"input">,
  "value" | "min" | "max" | "step" | "onChange" | "type"
>) {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onValueChange?.(Number(e.target.value))}
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
