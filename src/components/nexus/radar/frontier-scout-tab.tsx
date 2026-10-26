"use client";

// ─── Frontier Scout tab (r511) ───────────────────────────────────────────────
// The judge-cascade UI on top of /api/radar/frontier: trend papers + freshly
// minted agent/RL repos land here, the four-highest-traction unjudged items
// are fed SEQUENTIALLY through judgeFrontierItem() (rubric → SystemOne gate →
// mid-band escalation), and every verdict logs WHICH rung decided it. Owners
// promote adopt/watch items into the Evolution seed ledger with one click.
//
// Local-first doctrine preserved: server cache 30 min (TTL on the route),
// client cache in localStorage (nexus-radar-frontier), judgments/seed ledger
// browser-side only — BYOK judges, nothing leaves the machine but the fetches.

import * as React from "react";
import { ArrowUpRight, Check, Copy, Loader2, Pin, Telescope, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/nexus/atoms";
import { copyText } from "@/lib/helpers";
import { useSettingsStore } from "@/lib/stores";
import { cn } from "@/lib/utils";
import {
  boundaryTable,
  fuseScores,
  judgeFrontierItem,
  markSeen,
  pickJudgeQueue,
  promoteSeed,
  readFrontierSeeds,
  readJudgments,
  readSeenLedger,
  recordJudgment,
  ruleScores,
  seedFromItem,
  saveFrontierSeeds,
  withReproduction,
  verdictOf,
} from "@/lib/frontier-scout";
import type {
  FrontierItem,
  FrontierJudgment,
  FrontierScores,
  FrontierSeed,
  FrontierVerdict,
} from "@/lib/frontier-scout";
import {
  CacheStatus,
  CardGridSkeleton,
  Chip,
  ErrorBox,
  isTimeoutError,
  LinkChip,
  readCache,
  relTime,
  writeCache,
} from "./radar-shared";

const CACHE_KEY = "nexus-radar-frontier";
const QUEUE_SIZE = 4;

interface FrontierCache {
  fetchedAt: number;
  items: FrontierItem[];
  errors: string[];
  /** r539: which source served the EXA acquisition lane — "vault" | "env" |
   *  null (null/undefined = lane unconfigured → chip hidden; silence is the
   *  honest state, the lane is invisible by design). Optional so pre-r539
   *  localStorage caches hydrate unchanged. */
  keySource?: "vault" | "env" | null;
}

// ─── Verdict / rung presentation maps (emerald / amber / stone only) ─────────

const VERDICT_CLASS: Record<FrontierVerdict, string> = {
  adopt: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  watch: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  skip: "border-border bg-muted/40 text-muted-foreground",
};

const VERDICT_DOT: Record<FrontierVerdict, string> = {
  adopt: "bg-emerald-500",
  watch: "bg-amber-500",
  skip: "bg-stone-400",
};

const RUNG_META: Record<
  FrontierJudgment["via"],
  { label: string; className: string }
> = {
  rules: {
    label: "rubric",
    className: "border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300",
  },
  "intern-systemone": {
    label: "Decision-4B",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  "fast-model": {
    label: "fast judge",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  // r510 doctrine: paid typesafe Jev stays demoted last inside decide() — it
  // only ever fires when the owner explicitly pastes a Jev key.
  jev: {
    label: "Jev",
    className: "border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300",
  },
};

// Rubric mini-bars: REL/NV/IMP/EV/VEL against the axis maxima in frontier-scout.
const AXES: Array<{ key: keyof FrontierScores; label: string; max: number; fill: string }> = [
  { key: "relevance", label: "REL", max: 30, fill: "bg-emerald-600/50" },
  { key: "novelty", label: "NV", max: 20, fill: "bg-amber-500/50" },
  { key: "implementability", label: "IMP", max: 20, fill: "bg-stone-400/70" },
  { key: "evidence", label: "EV", max: 15, fill: "bg-stone-500/50" },
  { key: "velocity", label: "VEL", max: 15, fill: "bg-emerald-500/40" },
];

// ─── Tab ─────────────────────────────────────────────────────────────────────

export function FrontierScoutTab() {
  const [cache, setCache] = React.useState<FrontierCache | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // id → in-flight (per-item "judging…" chip)
  const [judging, setJudging] = React.useState<Record<string, boolean>>({});
  const [judgments, setJudgments] = React.useState<Record<string, FrontierJudgment>>({});
  const [seeds, setSeeds] = React.useState<FrontierSeed[]>([]);
  const [dismissed, setDismissed] = React.useState<Set<string>>(() => new Set());
  // NEW-badge snapshot — hydrated once at mount so badges never flicker when
  // the post-render markSeen() runs (spec: mark seen AFTER render).
  const [seenSnapshot, setSeenSnapshot] = React.useState<Record<string, number>>({});

  const settings = useSettingsStore((s) => s.settings);
  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;

  const didBoot = React.useRef(false);
  const fetchAbortRef = React.useRef<AbortController | null>(null);

  const fetchItems = React.useCallback(async (fresh: boolean) => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/radar/frontier${fresh ? "?fresh=1" : ""}`, {
        signal: controller.signal,
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        const msg =
          body && typeof body === "object" && "error" in body
            ? String((body as { error?: unknown }).error)
            : `Frontier aggregation failed (HTTP ${res.status}).`;
        throw new Error(msg);
      }
      const rec = body as {
        fetchedAt?: unknown;
        items?: unknown;
        errors?: unknown;
        exaKeySource?: unknown;
      };
      const next: FrontierCache = {
        fetchedAt: typeof rec.fetchedAt === "number" ? rec.fetchedAt : Date.now(),
        items: Array.isArray(rec.items) ? (rec.items as FrontierItem[]) : [],
        errors: Array.isArray(rec.errors) ? rec.errors.map(String) : [],
        keySource:
          rec.exaKeySource === "vault" || rec.exaKeySource === "env" ? rec.exaKeySource : null,
      };
      writeCache(CACHE_KEY, next);
      setCache(next);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        isTimeoutError(err)
          ? "Frontier aggregation took too long — try again."
          : err instanceof Error
            ? err.message
            : "Could not fetch the frontier."
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Boot: hydrate the localStorage ledgers, show the cached board, then the
  // one auto-fetch (spec: refresh button + auto-fetch once on mount).
  React.useEffect(() => {
    if (didBoot.current) return;
    didBoot.current = true;
    setSeeds(readFrontierSeeds());
    setJudgments(readJudgments());
    setSeenSnapshot(readSeenLedger());
    const cached = readCache<FrontierCache>(CACHE_KEY);
    if (cached && Array.isArray(cached.items) && cached.items.length > 0) setCache(cached);
    void fetchItems(false);
    return () => fetchAbortRef.current?.abort();
  }, [fetchItems]);

  // ── Auto-judge queue (runs ONCE per fetched board, never in a loop) ──
  const itemsRef = React.useRef<FrontierItem[]>([]);
  itemsRef.current = cache?.items ?? [];
  const fetchedAt = cache?.fetchedAt ?? 0;
  const queueRanForRef = React.useRef(0);
  const judgedIdsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!fetchedAt || itemsRef.current.length === 0) return;
    if (queueRanForRef.current === fetchedAt) return; // already ran for this board
    queueRanForRef.current = fetchedAt;

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      const queue = pickJudgeQueue(itemsRef.current, QUEUE_SIZE).filter(
        (it) => !judgedIdsRef.current.has(it.id)
      );
      for (const item of queue) {
        if (cancelled || controller.signal.aborted) return;
        judgedIdsRef.current.add(item.id);
        setJudging((m) => ({ ...m, [item.id]: true }));
        try {
          const j = await judgeFrontierItem(item, settingsRef.current, {
            signal: controller.signal,
          });
          if (cancelled) return;
          recordJudgment(item.id, j);
          setJudgments((prev) => ({ ...prev, [item.id]: j }));
        } catch {
          // judgeFrontierItem promises never-throw; belt-and-braces rules fallback.
          if (cancelled) return;
          const scores = ruleScores(item, []);
          const total = fuseScores(scores);
          const fallback: FrontierJudgment = {
            total,
            scores,
            via: "rules",
            verdict: verdictOf(total),
            reason: "Judge rung errored — rubric fallback.",
            judgedAt: Date.now(),
          };
          recordJudgment(item.id, fallback);
          setJudgments((prev) => ({ ...prev, [item.id]: fallback }));
        } finally {
          if (!cancelled) {
            setJudging((m) => {
              const next = { ...m };
              delete next[item.id];
              return next;
            });
          }
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchedAt]);

  // Mark seen AFTER render — once per successful fetch (persisted through the
  // seen ledger; the badge snapshot above stays stable for this session).
  const seenMarkedForRef = React.useRef(0);
  React.useEffect(() => {
    if (!cache || cache.items.length === 0) return;
    if (seenMarkedForRef.current === cache.fetchedAt) return;
    seenMarkedForRef.current = cache.fetchedAt;
    markSeen(cache.items.map((i) => i.id));
  }, [cache]);

  // ── Derived board ──
  const seedTitles = React.useMemo(() => seeds.map((s) => `${s.title} ${s.seed}`), [seeds]);

  const totalOf = React.useCallback(
    (item: FrontierItem): number => {
      const j = judgments[item.id];
      if (j) return j.total;
      return fuseScores(ruleScores(item, seedTitles));
    },
    [judgments, seedTitles]
  );

  const scoresOf = React.useCallback(
    (item: FrontierItem): FrontierScores =>
      judgments[item.id]?.scores ?? ruleScores(item, seedTitles),
    [judgments, seedTitles]
  );

  const effectiveJudgment = React.useCallback(
    (item: FrontierItem): FrontierJudgment => {
      const existing = judgments[item.id];
      if (existing) return existing;
      const scores = ruleScores(item, seedTitles);
      const total = fuseScores(scores);
      return {
        total,
        scores,
        via: "rules",
        verdict: verdictOf(total),
        reason: "Rubric only — not yet reached by the judge queue.",
        judgedAt: Date.now(),
      };
    },
    [judgments, seedTitles]
  );

  const items = React.useMemo(
    () =>
      (cache?.items ?? [])
        .filter((it) => !dismissed.has(it.id))
        .sort((a, b) => totalOf(b) - totalOf(a)),
    [cache, dismissed, totalOf]
  );

  const boundary = React.useMemo(() => boundaryTable(Object.values(judgments)), [judgments]);

  // r584: the ledger itself is the source of truth for "already pinned" — a
  // pinned card flips its action to an honest state chip instead of offering
  // a redundant second pin (promoteSeed dedupes by id, but the button kept
  // promising a fresh pin that isn't one). seed.id === item.id by contract.
  const pinnedIds = React.useMemo(() => new Set(seeds.map((s) => s.id)), [seeds]);

  // ── Actions ──
  const copySeed = React.useCallback(
    async (item: FrontierItem) => {
      const seed = seedFromItem(item, effectiveJudgment(item));
      const ok = await copyText(seed.seed);
      if (ok) toast.success("Seed prompt copied");
      else toast.error("Clipboard refused — copy failed");
    },
    [effectiveJudgment]
  );

  const pinSeed = React.useCallback(
    (item: FrontierItem) => {
      const seed = seedFromItem(item, effectiveJudgment(item));
      const next = promoteSeed(seed);
      setSeeds(next);
      // r582 AWorld: the pin toast names the reproduction verdict — the seed
      // left the distiller already marked (explore → reproduce → improve).
      toast.success(
        `Pinned to Evolution seed ledger — AWorld: ${seed.reproduction?.verdict ?? "unverified"}`
      );
    },
    [effectiveJudgment]
  );

  // r582 AWorld: re-run the deterministic reproduction check (older ledger
  // rows carry no verdict) and persist the stamp. Pure function — same seed,
  // same evidence, so re-verify is idempotent.
  const verifySeed = (id: string) => {
    const next = seeds.map((s) => (s.id === id ? withReproduction(s) : s));
    saveFrontierSeeds(next);
    setSeeds(next);
    // r584: the toast names the fresh verdict — "evidence refreshed" alone
    // made the owner re-open the tooltip to learn what the re-check decided.
    const verdict = next.find((s) => s.id === id)?.reproduction?.verdict ?? "unverified";
    toast(`Seed re-verified — AWorld: ${verdict}`);
  };

  const dismiss = React.useCallback((id: string) => {
    markSeen([id]);
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    toast("Dismissed — back on next fresh find");
  }, []);

  const seedRow = (seed: FrontierSeed, key: number) => {
    const verdict = verdictOf(seed.total);
    return (
      <div key={`${seed.id}-${key}`} className="flex min-w-0 items-center gap-2 py-1">
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", VERDICT_DOT[verdict])}
          title={`${verdict} ${seed.total}/100`}
          aria-hidden
        />
        <a
          href={seed.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-xs font-medium hover:underline"
          title={seed.title}
        >
          {seed.title}
        </a>
        {/* r582 AWorld: the reproduction verdict rides the row — emerald when
            the record reproduced (evidence count), amber when a check broke
            (evidence in the tooltip), stone when unverifiable. Pre-r582 rows
            get an honest one-click verify instead of a silent blank. */}
        {seed.reproduction ? (
          <span
            data-testid="seed-reproduction"
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              seed.reproduction.verdict === "reproduced"
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                : seed.reproduction.verdict === "not-reproduced"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-stone-400/40 bg-stone-500/5 text-stone-600 dark:text-stone-400"
            )}
            title={`AWorld reproduction — ${seed.reproduction.verdict}\n${seed.reproduction.evidence.join("\n")}`}
          >
            {seed.reproduction.verdict === "reproduced"
              ? `reproduced ·${seed.reproduction.evidence.length}`
              : seed.reproduction.verdict}
          </span>
        ) : (
          <button
            className="shrink-0 rounded-md border border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/60"
            aria-label={`Verify seed ${seed.title}`}
            title="AWorld reproduction check — provenance · claim · directive · band"
            onClick={() => verifySeed(seed.id)}
          >
            verify
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          aria-label={`Copy seed prompt for ${seed.title}`}
          onClick={() => {
            void copyText(seed.seed).then((ok) =>
              ok ? toast.success("Seed prompt copied") : toast.error("Clipboard refused — copy failed")
            );
          }}
        >
          <Copy className="h-3 w-3" aria-hidden />
        </Button>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <Telescope className="h-4 w-4 text-muted-foreground" aria-hidden />
          Frontier Scout
        </div>
        <div className="ml-auto">
          <CacheStatus
            fetchedAt={cache?.fetchedAt}
            onRefresh={() => void fetchItems(true)}
            refreshing={loading}
            staleAfterMs={30 * 60_000}
          />
        </div>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Weekly trend sweep — HF daily papers, newly-minted agent/RL repos, the arXiv
        harness/RL feed — judged by a cascade: rubric → Decision-4B gate → fast judge
        for the uncertain band. High scorers become Evolution seeds, each carrying an
        AWorld reproduction verdict (provenance · claim · directive · band) before
        Evolution improves on it.
      </p>

      {/* Seed ledger strip */}
      <div
        className="max-h-40 overflow-y-auto rounded-lg border bg-muted/20 p-3"
        role="region"
        aria-label="Evolution seed ledger"
      >
        {seeds.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Seed ledger empty — pin an adopt/watch finding below and Evolution&apos;s
            stalled-pipeline proposals start pulling from it.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Chip>
                {seeds.length} seed{seeds.length === 1 ? "" : "s"} → Evolution pulls from
                this ledger
              </Chip>
              <Chip>
                {seeds.filter((s) => s.reproduction?.verdict === "reproduced").length}/{seeds.length}{" "}
                reproduced
              </Chip>
            </div>
            {seeds.slice(0, 3).map((seed, i) => seedRow(seed, i))}
            {seeds.length > 3 ? (
              <details className="mt-0.5">
                <summary className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline">
                  +{seeds.length - 3} older seed{seeds.length - 3 === 1 ? "" : "s"}
                </summary>
                <div className="mt-1">{seeds.slice(3).map((seed, i) => seedRow(seed, i))}</div>
              </details>
            ) : null}
          </div>
        )}
      </div>

      {error ? <ErrorBox message={error} onRetry={() => void fetchItems(true)} /> : null}

      {/* r539: acquisition key-source honesty chip — the acquisition lane is
          silent by design when unconfigured, so its ONE visible trace is the
          live key source (vault-first since r537, env fallback). Palette
          doctrine: emerald = first-class vault posture, amber = the demoted
          machine-secret rung. */}
      {cache?.keySource ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            className={
              cache.keySource === "vault"
                ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/40 text-amber-700 dark:text-amber-400"
            }
          >
            acq key · <span className="font-mono">{cache.keySource}</span>
          </Chip>
          <span className="text-[10px] leading-snug text-muted-foreground">
            {cache.keySource === "vault"
              ? "EXA acquisition lane served from the Automation Vault (vault-first)"
              : "EXA acquisition lane served from the EXA_API_KEY machine secret"}
          </span>
        </div>
      ) : null}

      {cache && cache.errors.length > 0 && !error ? (
        <p
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400"
        >
          Partial fetch — {cache.errors.join(" · ")}
        </p>
      ) : null}

      {/* Board */}
      {loading && !cache ? (
        <CardGridSkeleton count={4} />
      ) : items.length === 0 ? (
        <EmptyState
          emoji="🛰"
          title="No frontier findings on the board"
          description={
            cache && cache.items.length > 0
              ? "All current findings are dismissed — hit Refresh for a fresh sweep."
              : "Hit Refresh to sweep HF daily papers, fresh agent/RL repos and the arXiv harness feed."
          }
        />
      ) : (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          role="region"
          aria-label="Frontier findings"
        >
          {items.map((item) => {
            const j = judgments[item.id];
            const scores = scoresOf(item);
            const total = totalOf(item);
            const verdict = j?.verdict ?? verdictOf(total);
            const rung = RUNG_META[j?.via ?? "rules"];
            const isNew = !seenSnapshot[item.id];
            const traction =
              item.kind === "repo" ? `${item.stars ?? 0}★` : `${item.upvotes ?? 0}▲`;
            return (
              <Card key={item.id} className="flex flex-col gap-2.5 p-4">
                {/* Verdict row */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      VERDICT_CLASS[verdict]
                    )}
                  >
                    {verdict.toUpperCase()} {total}/100
                  </span>
                  {isNew ? (
                    <span className="rounded-full border border-emerald-500/40 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">
                      NEW
                    </span>
                  ) : null}
                  {judging[item.id] ? (
                    <Chip className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
                      judging…
                    </Chip>
                  ) : null}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {item.id.startsWith("gh:") ? "repo" : item.hub}
                  </span>
                </div>

                {/* Title */}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-start gap-1 text-sm font-semibold leading-snug hover:underline"
                  title={item.title}
                >
                  <span className="line-clamp-2">{item.title}</span>
                  <ArrowUpRight
                    className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-colors group-hover:text-violet-600 dark:group-hover:text-violet-400"
                    aria-hidden
                  />
                </a>

                {/* Meta line */}
                <p className="truncate text-[11px] text-muted-foreground" title={`${item.hub} · ${item.kind} · ${traction}${item.authors ? ` · ${item.authors}` : ""}`}>
                  {item.hub} · {item.kind} · {traction}
                  {item.createdAt ? ` · ${relTime(item.createdAt)}` : ""}
                  {item.authors ? ` · ${item.authors}` : ""}
                </p>

                {/* Rubric mini-bars */}
                <div className="flex items-end gap-2" aria-label="Rubric scores per axis">
                  {AXES.map((ax) => {
                    const val = scores[ax.key];
                    return (
                      <div key={ax.key} className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-[9px] font-medium text-muted-foreground">
                          {ax.label} {val}
                        </span>
                        <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full", ax.fill)}
                            style={{ width: `${Math.round((val / ax.max) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Judgment line */}
                <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold",
                      rung.className
                    )}
                    title="Which cascade rung decided this verdict"
                  >
                    {rung.label}
                  </span>
                  {typeof j?.confidence === "number" ? (
                    <span className="text-muted-foreground">
                      {Math.round(j.confidence * 100)}% conf
                    </span>
                  ) : null}
                  <span
                    className="min-w-0 flex-1 truncate text-muted-foreground"
                    title={j?.reason ?? "Awaiting the judge queue"}
                  >
                    {j?.reason ?? "Awaiting the judge queue"}
                  </span>
                </p>

                {/* Summary */}
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {item.summary || "No summary provided."}
                </p>

                {/* Actions */}
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  <LinkChip href={item.url} ariaLabel={`Open ${item.title}`}>
                    open
                  </LinkChip>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => void copySeed(item)}
                    aria-label={`Copy seed prompt for ${item.title}`}
                  >
                    <Copy className="h-3 w-3" aria-hidden />
                    Copy seed
                  </Button>
                  {verdict !== "skip" ? (
                    pinnedIds.has(item.id) ? (
                      <span
                        data-testid="seed-in-ledger"
                        title="Already in the Evolution seed ledger — Evolution's stalled-pipeline proposals pull from it"
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-2 text-[11px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                      >
                        <Check className="h-3 w-3" aria-hidden />
                        in seed ledger
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[11px]"
                        onClick={() => pinSeed(item)}
                        aria-label={`Pin ${item.title} to the Evolution seed ledger`}
                      >
                        <Pin className="h-3 w-3" aria-hidden />
                        Pin to seeds
                      </Button>
                    )
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={() => dismiss(item.id)}
                    aria-label={`Dismiss ${item.title}`}
                  >
                    <X className="h-3 w-3" aria-hidden />
                    Dismiss
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Cascade footer */}
      {items.length > 0 || Object.keys(judgments).length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t pt-3">
          <Chip>decided by rubric: {boundary.rules}</Chip>
          <Chip className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
            Decision-4B: {boundary["intern-systemone"]}
          </Chip>
          <Chip className="border-amber-500/40 text-amber-700 dark:text-amber-400">
            fast judge: {boundary["fast-model"]}
          </Chip>
          {boundary.jev > 0 ? (
            <Chip>Jev (legacy paid): {boundary.jev}</Chip>
          ) : null}
          <p className="w-full text-[10px] leading-snug text-muted-foreground sm:w-auto sm:flex-1">
            Cascade: rubric → Decision-4B gate → fast judge only for the uncertain band
            (arXiv:2609.01345) — every verdict logs which rung decided it.
          </p>
        </div>
      ) : null}
    </div>
  );
}
