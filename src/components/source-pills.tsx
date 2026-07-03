"use client";

import * as React from "react";
import ReactDOM from "react-dom";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetricSource } from "@/lib/metrics";

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

/** Small favicon <img> that hides itself if it fails to load. */
function Favicon({
  domain,
  className,
}: {
  domain: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={faviconUrl(domain)}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("rounded-sm", className)}
    />
  );
}

/**
 * AI-chat-citation-style source pill. Shows the first source's favicon +
 * domain, and a hover card that browses through all sources one at a time.
 *
 * The hover card is rendered into a `document.body` portal with `position:
 * fixed` so it is never clipped by a scroll container / `overflow` ancestor
 * (e.g. the controls sidebar). Position is derived from the trigger's
 * bounding rect on open. SSR-safe: portals only after mount.
 */
export function SourcePills({ sources }: { sources: MetricSource[] }) {
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const [mounted, setMounted] = React.useState(false);
  const [pos, setPos] = React.useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    // Deferred so the portal-mount flag isn't set synchronously in the effect
    // body (react-hooks/set-state-in-effect).
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Recompute portal position from the trigger's rect.
  const reposition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const CARD_WIDTH = 280;
    let left = rect.left;
    // Clamp so the card stays within the viewport width.
    if (typeof window !== "undefined") {
      const maxLeft = window.innerWidth - CARD_WIDTH - 8;
      left = Math.max(8, Math.min(left, maxLeft));
    }
    setPos({ left, top: rect.bottom + 4 });
  }, []);

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  function handleOpen() {
    cancelClose();
    reposition();
    setOpen(true);
  }

  React.useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  if (sources.length === 0) return null;

  const first = sources[0];
  const extra = sources.length - 1;
  const current = sources[Math.min(index, sources.length - 1)];

  function prev(e: React.MouseEvent) {
    e.stopPropagation();
    setIndex((i) => (i - 1 + sources.length) % sources.length);
  }
  function next(e: React.MouseEvent) {
    e.stopPropagation();
    setIndex((i) => (i + 1) % sources.length);
  }

  const card = (
    <div
      role="dialog"
      style={{ position: "fixed", left: pos.left, top: pos.top, width: 280 }}
      className="z-[1100] rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <Favicon domain={current.domain} className="mt-0.5 h-4 w-4" />
        <div className="min-w-0 flex-1">
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="block text-xs font-medium underline underline-offset-2"
          >
            {current.title}
          </a>
          <div className="text-[11px] text-muted-foreground">
            {current.domain} · {current.year}
          </div>
        </div>
        {sources.length > 1 && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={prev}
              aria-label="Previous source"
              className="inline-flex h-5 w-5 items-center justify-center rounded border text-muted-foreground hover:bg-muted"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[10px] text-muted-foreground">
              {Math.min(index, sources.length - 1) + 1}/{sources.length}
            </span>
            <button
              type="button"
              onClick={next}
              aria-label="Next source"
              className="inline-flex h-5 w-5 items-center justify-center rounded border text-muted-foreground hover:bg-muted"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {current.description}
      </div>
    </div>
  );

  return (
    <span
      className="relative inline-flex w-fit align-middle"
      onMouseEnter={handleOpen}
      onMouseLeave={scheduleClose}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onFocus={handleOpen}
        onBlur={scheduleClose}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 leading-none transition-colors hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`Sources: ${sources.map((s) => s.title).join(", ")}`}
      >
        <Search className="h-3 w-3 text-muted-foreground" />
        <Favicon domain={first.domain} className="h-3.5 w-3.5" />
        {extra > 0 && (
          <span className="text-[10px] text-muted-foreground/70">
            +{extra}
          </span>
        )}
      </button>

      {open &&
        mounted &&
        typeof document !== "undefined" &&
        ReactDOM.createPortal(card, document.body)}
    </span>
  );
}
