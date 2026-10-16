"use client";

import * as React from "react";
import { Check, ChevronDown, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ─── ModelPicker — searchable, grouped, badged model selector ────────────────
// Replaces plain Radix Selects for model choice: models stay findable when a
// provider's list grows past a screenful (live catalogs), and every row can
// carry a status badge (curated / live / free / no-key / stale). Empty state is
// explicit — never a blank list.

export type PickerBadgeTone = "violet" | "emerald" | "amber" | "muted";

export interface PickerOption {
  /** Stable model id — the value passed to onSelect. */
  id: string;
  /** Human label shown on the row and (when selected) on the trigger. */
  label: string;
  /** Secondary hint — quantization, context, provider quirk. */
  note?: string;
  /** Grouping heading; groups render in first-seen order. */
  group?: string;
  /** Status badge text (e.g. "live", "curated", "no key"). */
  badge?: string;
  badgeTone?: PickerBadgeTone;
  /** Extra search keywords beyond label + id. */
  keywords?: string[];
}

export interface ModelPickerProps {
  value: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyHint?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Rendered at the bottom of the list (e.g. refresh button). */
  footer?: React.ReactNode;
}

/** r439: render cap — the list never draws more than this many rows; search
 * narrows to reach the rest, and the caption states the truncation honestly
 * instead of callers silently dropping knowledge upstream. */
const RENDER_CAP = 60;

const BADGE_CLASS: Record<PickerBadgeTone, string> = {
  violet: "border-violet-500/40 bg-violet-500/10 text-violet-400",
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  muted: "border-border bg-muted/50 text-muted-foreground",
};

export function ModelPicker({
  value,
  options,
  onSelect,
  placeholder = "Pick a model…",
  searchPlaceholder = "Search models…",
  emptyTitle = "No model matches",
  emptyHint,
  disabled,
  className,
  ariaLabel,
  footer,
}: ModelPickerProps) {
  const [open, setOpen] = React.useState(false);
  // r439: the picker owns its search now — query state + self-filtering (see
  // the pool memo below). Cleared on close AND on select so a stale query
  // never silently narrows the next open.
  const [query, setQuery] = React.useState("");
  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);
  const selected = options.find((o) => o.id === value);

  // r28: when the value is a pin that isn't in the enumerated options (e.g. a
  // tracker/roster model never refreshed into this browser), synthesize an
  // honest "pinned" row so the trigger names the real model instead of the
  // placeholder. Pin resolution itself still works — resolveExplicitLlm
  // accepts any providerId::model.
  const fallback: PickerOption | undefined =
    !selected && value && value !== "default" && value !== "auto::builtin"
      ? (() => {
          const [pid, ...rest] = value.split("::");
          const model = rest.join("::") || value;
          return { id: value, label: model, note: pid !== "custom" ? `${pid} · exact pin` : "custom endpoint", group: "Pinned", badge: "pinned", badgeTone: "emerald" as const };
        })()
      : undefined;

  // r439: the search pool is EVERY option passed in — the pinned-row
  // synthesis plus the full list (the composer now feeds whole live rosters;
  // its old slice(0, 20) was a KNOWLEDGE cap that made live models 21+
  // unsearchable and unselectable). Filtering is plain case-insensitive
  // substring over label, id, note and keywords — the r434/r435 doctrine:
  // the render cap applies AFTER the filter, never to what search sees.
  const pool = React.useMemo(
    () => (fallback ? [fallback, ...options] : options),
    [fallback, options]
  );
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const filtered = React.useMemo(
    () =>
      searching
        ? pool.filter(
            (o) =>
              o.label.toLowerCase().includes(q) ||
              o.id.toLowerCase().includes(q) ||
              (o.note ?? "").toLowerCase().includes(q) ||
              (o.keywords ?? []).some((k) => k.toLowerCase().includes(q))
          )
        : pool,
    [pool, searching, q]
  );
  const capped = filtered.length > RENDER_CAP;
  const renderItems = capped ? filtered.slice(0, RENDER_CAP) : filtered;

  // Groups in first-seen order (stable across re-renders for a given list).
  const groups = React.useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, PickerOption[]>();
    const push = (g: string, o: PickerOption) => {
      if (!map.has(g)) {
        map.set(g, []);
        order.push(g);
      }
      map.get(g)!.push(o);
    };
    for (const o of renderItems) push(o.group ?? "Models", o);
    return order.map((g) => ({ name: g, items: map.get(g)! }));
  }, [renderItems]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between gap-2 px-3 font-normal",
            !selected && !fallback && "text-muted-foreground",
            className
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {selected || fallback ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{(selected ?? fallback)!.label}</span>
                {(selected ?? fallback)!.badge ? (
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 px-1 py-0 text-[9px]", BADGE_CLASS[(selected ?? fallback)!.badgeTone ?? "muted"])}
                  >
                    {(selected ?? fallback)!.badge}
                  </Badge>
                ) : null}
              </span>
            ) : (
              placeholder
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2.5rem))] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            className="h-9"
          />
          {(searching || capped) && (
            <p
              aria-live="polite"
              className="border-b px-3 py-1.5 text-[10px] text-muted-foreground"
            >
              {searching
                ? `${filtered.length} of ${pool.length} match${capped ? ` · first ${RENDER_CAP} shown` : ""}`
                : `first ${RENDER_CAP} of ${pool.length} shown — search reaches the rest`}
            </p>
          )}
          <CommandList className="max-h-72">
            <CommandEmpty className="py-6 text-center">
              <SearchX className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground/50" aria-hidden />
              {searching ? (
                <>
                  <p className="text-xs font-medium">
                    No model matches &ldquo;{query.trim()}&rdquo;
                  </p>
                  <p className="mt-0.5 px-4 text-[11px] leading-relaxed text-muted-foreground">
                    Labels, ids, notes and keywords all count.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-medium">{emptyTitle}</p>
                  {emptyHint ? (
                    <p className="mt-0.5 px-4 text-[11px] leading-relaxed text-muted-foreground">{emptyHint}</p>
                  ) : null}
                </>
              )}
            </CommandEmpty>
            {groups.map((g, gi) => (
              <React.Fragment key={g.name}>
                {gi > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={g.name}>
                  {g.items.map((o) => {
                    const isSel = o.id === value;
                    return (
                      <CommandItem
                        key={o.id}
                        value={o.id}
                        keywords={[o.label, o.note ?? "", ...(o.keywords ?? [])]}
                        onSelect={() => {
                          onSelect(o.id);
                          setOpen(false);
                          setQuery("");
                        }}
                        className="gap-2"
                      >
                        <Check
                          className={cn("h-3.5 w-3.5 shrink-0", isSel ? "text-violet-400" : "text-transparent")}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">{o.label}</span>
                            {o.badge ? (
                              <Badge
                                variant="outline"
                                className={cn("shrink-0 px-1 py-0 text-[9px]", BADGE_CLASS[o.badgeTone ?? "muted"])}
                              >
                                {o.badge}
                              </Badge>
                            ) : null}
                          </span>
                          {o.note ? (
                            <span className="block truncate font-mono text-[10px] text-muted-foreground">
                              {o.note}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </React.Fragment>
            ))}
          </CommandList>
          {footer ? (
            <div className="border-t p-1.5">
              {footer}
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
