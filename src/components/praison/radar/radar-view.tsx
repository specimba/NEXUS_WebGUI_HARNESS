"use client";

import * as React from "react";
import {
  ArrowUpRight,
  Boxes,
  Database,
  Download,
  ExternalLink,
  FileText,
  Github,
  Heart,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/praison/atoms";
import { ModelRadarTab } from "@/components/praison/tracker/model-radar-tab";
import { fmtRel } from "@/lib/helpers";
import { cn } from "@/lib/utils";

// ─── Trend Radar (r26) ───────────────────────────────────────────────────────
// Three radars in one view — the user's GitHub stars, Hugging Face trending
// and an arXiv paper radar. Local-first: every tab caches its last result in
// localStorage and only phones out on explicit fetches (GitHub/HF public APIs
// + our own /api/radar/papers proxy). Nothing is sent anywhere else.

const GH_USER_KEY = "praison-radar-user";
const GH_CACHE_KEY = "praison-radar-gh";
const HF_CACHE_KEY = "praison-radar-hf";
const ARXIV_CACHE_KEY = "praison-radar-arxiv";

const DEFAULT_GH_USER = "specimba";
const GH_PAGES = 3; // 3 × 100 repos — enough radar, not a full scrape
const HF_LIMIT = 30;
const PAPERS_MAX = 12;
const DEFAULT_PAPER_QUERY = "cat:cs.AI OR cat:cs.CL OR cat:cs.LG";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GhRepo {
  id: number;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  topics?: string[];
  html_url: string;
  fork?: boolean;
}

interface GhCache {
  user: string;
  fetchedAt: number;
  repos: GhRepo[];
}

interface HfItem {
  id: string;
  likes?: number;
  downloads?: number;
  pipeline_tag?: string;
  library_name?: string;
}

interface HfCache {
  fetchedAt: number;
  models: HfItem[];
  datasets: HfItem[];
  spaces: HfItem[];
}

interface ArxivPaper {
  id: string;
  title: string;
  authors: string;
  published: string;
  summary: string;
  pdf: string;
}

interface ArxivCache {
  fetchedAt: number;
  query: string;
  papers: ArxivPaper[];
}

type HfKind = "models" | "datasets" | "spaces";

// ─── localStorage helpers (all reads/writes guarded — radar never throws) ────

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — the radar works without persistence */
  }
}

/** Shared relative-time for cache stamps and repo pushes. */
function relTime(ts: number | string): string {
  const n = typeof ts === "string" ? new Date(ts).getTime() : ts;
  return Number.isFinite(n) ? fmtRel(n) : "unknown";
}

// ─── Small shared UI pieces ──────────────────────────────────────────────────

/** "cached 5m ago · Refresh" header row used by every tab. */
function CacheStatus({
  fetchedAt,
  onRefresh,
  refreshing,
  extra,
}: {
  fetchedAt?: number;
  onRefresh: () => void;
  refreshing: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {extra}
      {fetchedAt ? (
        <span className="text-[11px] text-muted-foreground" aria-live="polite">
          cached {relTime(fetchedAt)}
        </span>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh results"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
        Refresh
      </Button>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
      <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Retry
      </Button>
    </div>
  );
}

function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="space-y-3 p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Muted chip — used for topics, pipeline tags and link-outs alike. */
function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}

/** Outbound link chip (arXiv / alphaXiv / PDF / repo). */
function LinkChip({
  href,
  children,
  ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400"
    >
      {children}
      <ArrowUpRight className="h-2.5 w-2.5" aria-hidden />
    </a>
  );
}

// ─── GitHub Stars tab ────────────────────────────────────────────────────────

const GH_CLUSTERS: { id: string; label: string; keywords: string[] }[] = [
  { id: "all", label: "All", keywords: [] },
  { id: "agents", label: "Agents", keywords: ["agent", "agentic", "autonomous", "multi-agent", "harness", "swarm", "crew", "orchestrat"] },
  { id: "inference", label: "Inference", keywords: ["inference", "llm", "vllm", "sglang", "serving", "quantiz", "gguf", "runtime", "kvcache", "speculative"] },
  { id: "memory", label: "Memory", keywords: ["memory", "mem0", "vector", "embedding", "knowledge", "recall"] },
  { id: "rag", label: "RAG", keywords: ["rag", "retrieval", "retriev", "chunk", "semantic search"] },
  { id: "evals", label: "Evals", keywords: ["eval", "benchmark", "arena", "garak", "red-team", "redteam", "guardrail", "safety"] },
  { id: "mcp", label: "MCP", keywords: ["mcp", "model context protocol"] },
  { id: "local", label: "Local", keywords: ["local", "on-device", "webgpu", "ollama", "llama.cpp", "llama-cpp", "edge", "offline", "web-llm", "wllama"] },
  { id: "media", label: "Media", keywords: ["image", "video", "audio", "speech", "diffusion", "tts", "stt", "vision", "multimodal", "music", "photo"] },
];

const LANGUAGE_DOTS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  "Jupyter Notebook": "#DA5B0B",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Zig: "#ec915c",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Java: "#b07219",
};

function matchesCluster(repo: GhRepo, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = [
    repo.full_name,
    repo.description ?? "",
    (repo.topics ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

function GitHubStarsTab() {
  const [user, setUser] = React.useState(DEFAULT_GH_USER);
  const [cache, setCache] = React.useState<GhCache | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cluster, setCluster] = React.useState("all");
  const [query, setQuery] = React.useState("");

  // Restore persisted username + last fetch on mount.
  React.useEffect(() => {
    const savedUser = readCache<string>(GH_USER_KEY);
    if (savedUser && savedUser.trim()) setUser(savedUser.trim());
    setCache(readCache<GhCache>(GH_CACHE_KEY));
  }, []);

  const fetchStars = React.useCallback(async (username: string) => {
    const name = username.trim();
    if (!name || loading) return;
    setLoading(true);
    setError(null);
    try {
      const repos: GhRepo[] = [];
      // r26: routed through our own /api/radar/github proxy — it sanitizes
      // the username and may attach a SERVER-side token for a higher rate
      // limit (never shipped to the client). Still an explicit user action.
      for (let page = 1; page <= GH_PAGES; page++) {
        const res = await fetch(
          `/api/radar/github?user=${encodeURIComponent(name)}&page=${page}`,
          { signal: AbortSignal.timeout(20_000) }
        );
        const data = (await res.json().catch(() => null)) as
          | { repos?: GhRepo[]; error?: string }
          | null;
        if (res.status === 404) throw new Error(`GitHub user “${name}” was not found.`);
        if (res.status === 429) throw new Error(data?.error ?? "GitHub API rate limit hit — try again in a bit.");
        if (!res.ok || !data || !Array.isArray(data.repos)) {
          throw new Error(data?.error ?? `GitHub API returned HTTP ${res.status}.`);
        }
        repos.push(...data.repos);
        if (data.repos.length < 100) break; // last page — stop early
      }
      // Dedupe + most-starred first for a stable, scannable grid.
      const seen = new Set<number>();
      const unique = repos.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      unique.sort((a, b) => b.stargazers_count - a.stargazers_count);
      const next: GhCache = { user: name, fetchedAt: Date.now(), repos: unique };
      writeCache(GH_CACHE_KEY, next);
      writeCache(GH_USER_KEY, name);
      setCache(next);
    } catch (err) {
      const message =
        err instanceof Error && /timeout|timed? ?out/i.test(err.message)
          ? "GitHub took too long to answer — try again."
          : err instanceof Error
            ? err.message
            : "Could not fetch stars.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const activeCluster = GH_CLUSTERS.find((c) => c.id === cluster) ?? GH_CLUSTERS[0];
  const filtered = React.useMemo(() => {
    const repos = cache?.repos ?? [];
    const q = query.trim().toLowerCase();
    return repos.filter(
      (r) =>
        matchesCluster(r, activeCluster.keywords) &&
        (q === "" ||
          `${r.full_name} ${r.description ?? ""} ${(r.topics ?? []).join(" ")}`
            .toLowerCase()
            .includes(q))
    );
  }, [cache, activeCluster, query]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Controls: username + fetch/refresh */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={user}
          onChange={(e) => {
            setUser(e.target.value);
            writeCache(GH_USER_KEY, e.target.value.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void fetchStars(user);
          }}
          placeholder="GitHub username"
          aria-label="GitHub username to browse stars for"
          className="h-9 w-44 font-mono text-xs"
        />
        {cache ? (
          <CacheStatus
            fetchedAt={cache.fetchedAt}
            onRefresh={() => void fetchStars(user)}
            refreshing={loading}
            extra={
              <span className="text-[11px] text-muted-foreground">
                @{cache.user} · {cache.repos.length} repos
                {cache.user !== user.trim() ? " (fetch to switch user)" : ""}
              </span>
            }
          />
        ) : (
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => void fetchStars(user)}
            disabled={loading || !user.trim()}
            aria-label="Fetch starred repositories"
          >
            <Github className={cn("h-4 w-4", loading && "animate-pulse")} aria-hidden />
            {loading ? "Fetching…" : "Fetch stars"}
          </Button>
        )}
      </div>

      {/* First visit: explicit user-triggered fetch only */}
      {!cache && !loading && !error ? (
        <EmptyState
          emoji="🛰️"
          title="No stars fetched yet"
          description={`Pull the public starred repos for a GitHub user (default: @${DEFAULT_GH_USER}) — 3 pages × 100, cached locally, no token needed.`}
          action={
            <Button size="sm" onClick={() => void fetchStars(user)}>
              <Github className="h-4 w-4" aria-hidden />
              Fetch stars
            </Button>
          }
        />
      ) : null}

      {error ? <ErrorBox message={error} onRetry={() => void fetchStars(user)} /> : null}

      {loading && !cache ? <CardGridSkeleton count={6} /> : null}

      {/* Filters + grid */}
      {cache && cache.repos.length > 0 ? (
        <>
          <div
            role="group"
            aria-label="Cluster filter"
            className="flex flex-wrap items-center gap-1.5"
          >
            {GH_CLUSTERS.map((c) => {
              const active = cluster === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCluster(c.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active
                      ? "border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                      : "text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {c.label}
                </button>
              );
            })}
            <div className="relative ml-auto">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                aria-label="Filter repositories by keyword"
                className="h-8 w-40 pl-8 text-xs sm:w-52"
              />
            </div>
          </div>

          {loading ? (
            <p className="text-[11px] text-muted-foreground" aria-live="polite">
              Refreshing from GitHub…
            </p>
          ) : null}

          <div className="min-h-0 flex-1">
            <div
              className="max-h-[58vh] overflow-y-auto pr-1"
              role="region"
              aria-label="Starred repositories"
            >
              {filtered.length === 0 ? (
                <EmptyState
                  emoji="🔭"
                  title="Nothing matches"
                  description="Try another cluster chip or clear the filter."
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((repo) => {
                    const dot = repo.language ? LANGUAGE_DOTS[repo.language] : undefined;
                    const topics = (repo.topics ?? []).slice(0, 4);
                    return (
                      <Card key={repo.id} className="card-lift flex flex-col gap-2 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <a
                            href={repo.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${repo.full_name} on GitHub`}
                            className="group flex min-w-0 items-center gap-1.5 font-mono text-xs font-semibold transition-colors hover:text-violet-500 dark:hover:text-violet-400"
                          >
                            <span className="truncate">{repo.full_name}</span>
                            <ArrowUpRight
                              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                              aria-hidden
                            />
                          </a>
                          <span
                            className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground"
                            title={`${repo.stargazers_count} stars`}
                          >
                            <Star className="h-3 w-3 text-amber-500" aria-hidden />
                            {repo.stargazers_count.toLocaleString()}
                          </span>
                        </div>

                        {repo.description ? (
                          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {repo.description}
                          </p>
                        ) : null}

                        {topics.length > 0 ? (
                          <div className="flex flex-wrap gap-1" aria-label="Repository topics">
                            {topics.map((t) => (
                              <Chip key={t}>{t}</Chip>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-auto flex items-center gap-2 pt-1 text-[10px] text-muted-foreground">
                          {repo.language ? (
                            <span className="flex items-center gap-1">
                              <span
                                aria-hidden
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: dot ?? "var(--muted-foreground)" }}
                              />
                              {repo.language}
                            </span>
                          ) : null}
                          <span aria-hidden>·</span>
                          <span title={`Last push ${new Date(repo.pushed_at).toLocaleString()}`}>
                            pushed {relTime(repo.pushed_at)}
                          </span>
                          {repo.fork ? (
                            <>
                              <span aria-hidden>·</span>
                              <span>fork</span>
                            </>
                          ) : null}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {filtered.length} of {cache.repos.length} starred repos
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── HF Trending tab ─────────────────────────────────────────────────────────

const HF_KINDS: { id: HfKind; label: string; icon: React.ElementType; path: string }[] = [
  { id: "models", label: "Models", icon: Boxes, path: "models" },
  { id: "datasets", label: "Datasets", icon: Database, path: "datasets" },
  { id: "spaces", label: "Spaces", icon: ExternalLink, path: "spaces" },
];

function hfHref(kind: HfKind, id: string): string {
  if (kind === "datasets") return `https://huggingface.co/datasets/${id}`;
  if (kind === "spaces") return `https://huggingface.co/spaces/${id}`;
  return `https://huggingface.co/${id}`;
}

function HfTrendingTab() {
  const [cache, setCache] = React.useState<HfCache | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<HfKind>("models");
  const didAuto = React.useRef(false);

  const fetchTrending = React.useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const kinds: HfKind[] = ["models", "datasets", "spaces"];
      const lists = await Promise.all(
        kinds.map(async (k) => {
          const path = HF_KINDS.find((x) => x.id === k)!.path;
          const res = await fetch(
            `https://huggingface.co/api/${path}?sort=trendingScore&direction=-1&limit=${HF_LIMIT}`,
            { signal: AbortSignal.timeout(20_000) }
          );
          if (!res.ok) throw new Error(`Hugging Face API (${k}) returned HTTP ${res.status}.`);
          const items = (await res.json()) as HfItem[];
          if (!Array.isArray(items)) throw new Error(`Unexpected Hugging Face response for ${k}.`);
          return [k, items] as const;
        })
      );
      const next: HfCache = { fetchedAt: Date.now(), models: [], datasets: [], spaces: [] };
      for (const [k, items] of lists) next[k] = items;
      writeCache(HF_CACHE_KEY, next);
      setCache(next);
    } catch (err) {
      const message =
        err instanceof Error && /timeout|timed? ?out/i.test(err.message)
          ? "Hugging Face took too long to answer — try again."
          : err instanceof Error
            ? err.message
            : "Could not fetch HF trending.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // First open of the tab = the explicit trigger; afterwards cache-only.
  React.useEffect(() => {
    if (didAuto.current) return;
    didAuto.current = true;
    const cached = readCache<HfCache>(HF_CACHE_KEY);
    if (cached) {
      setCache(cached);
    } else {
      void fetchTrending();
    }
  }, [fetchTrending]);

  const items = cache ? cache[kind] : [];
  const kindMeta = HF_KINDS.find((k) => k.id === kind)!;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Hub section"
          className="flex overflow-hidden rounded-lg border"
        >
          {HF_KINDS.map(({ id, label, icon: Icon }) => {
            const active = kind === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(id)}
                className={cn(
                  "flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors",
                  id !== "models" && "border-l",
                  active
                    ? "bg-violet-500/15 text-violet-500 dark:text-violet-400"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto">
          <CacheStatus
            fetchedAt={cache?.fetchedAt}
            onRefresh={() => void fetchTrending()}
            refreshing={loading}
          />
        </div>
      </div>

      {error ? <ErrorBox message={error} onRetry={() => void fetchTrending()} /> : null}

      {loading && !cache ? (
        <CardGridSkeleton count={6} />
      ) : (
        <div
          className="max-h-[62vh] overflow-y-auto pr-1"
          role="region"
          aria-label={`Trending ${kind}`}
        >
          {items.length === 0 ? (
            <EmptyState
              emoji="🤗"
              title={`No ${kindMeta.label.toLowerCase()} cached`}
              description="Hit Refresh to pull the current trending board from the Hugging Face Hub."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <Card key={`${kind}-${item.id}`} className="card-lift flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={hfHref(kind, item.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${item.id} on Hugging Face`}
                      className="group flex min-w-0 items-center gap-1.5 font-mono text-xs font-semibold transition-colors hover:text-violet-500 dark:hover:text-violet-400"
                    >
                      <span className="truncate">{item.id}</span>
                      <ArrowUpRight
                        className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </a>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {item.pipeline_tag ? <Chip>{item.pipeline_tag}</Chip> : null}
                    {item.library_name ? <Chip>{item.library_name}</Chip> : null}
                  </div>

                  <div className="mt-auto flex items-center gap-3 pt-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1" title="Likes">
                      <Heart className="h-3 w-3 text-rose-500" aria-hidden />
                      {(item.likes ?? 0).toLocaleString()}
                    </span>
                    {item.downloads != null ? (
                      <span className="flex items-center gap-1" title="Downloads">
                        <Download className="h-3 w-3" aria-hidden />
                        {item.downloads.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Paper Radar tab ─────────────────────────────────────────────────────────

function PaperRadarTab() {
  const [query, setQuery] = React.useState(DEFAULT_PAPER_QUERY);
  const [cache, setCache] = React.useState<ArxivCache | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const didAuto = React.useRef(false);

  const search = React.useCallback(
    async (rawQuery: string) => {
      if (loading) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          query: rawQuery.trim(),
          max: String(PAPERS_MAX),
          sort: "submittedDate",
        });
        const res = await fetch(`/api/radar/papers?${params.toString()}`, {
          signal: AbortSignal.timeout(25_000),
        });
        const body: unknown = await res.json();
        if (!res.ok) {
          const msg =
            body && typeof body === "object" && "error" in body
              ? String((body as { error?: unknown }).error)
              : `Paper radar failed (HTTP ${res.status}).`;
          throw new Error(msg);
        }
        const papers = (Array.isArray(body) ? body : []) as ArxivPaper[];
        const next: ArxivCache = {
          fetchedAt: Date.now(),
          query: rawQuery.trim() || DEFAULT_PAPER_QUERY,
          papers,
        };
        writeCache(ARXIV_CACHE_KEY, next);
        setCache(next);
        setQuery(next.query);
      } catch (err) {
        const message =
          err instanceof Error && /timeout|timed? ?out/i.test(err.message)
            ? "arXiv did not answer in time — try again."
            : err instanceof Error
              ? err.message
              : "Could not fetch papers.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  // First open: show the cached radar, or run the default fresh-papers query.
  React.useEffect(() => {
    if (didAuto.current) return;
    didAuto.current = true;
    const cached = readCache<ArxivCache>(ARXIV_CACHE_KEY);
    if (cached) {
      setCache(cached);
      setQuery(cached.query || DEFAULT_PAPER_QUERY);
    } else {
      void search(DEFAULT_PAPER_QUERY);
    }
  }, [search]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xl">
          <FileText
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search(query);
            }}
            placeholder={DEFAULT_PAPER_QUERY}
            aria-label="arXiv query"
            className="h-9 pl-8 font-mono text-xs"
          />
        </div>
        <Button
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => void search(query)}
          disabled={loading}
          aria-label="Search arXiv papers"
        >
          <Search className={cn("h-4 w-4", loading && "animate-pulse")} aria-hidden />
          {loading ? "Scanning…" : "Scan"}
        </Button>
        {cache ? (
          <CacheStatus
            fetchedAt={cache.fetchedAt}
            onRefresh={() => void search(query)}
            refreshing={loading}
          />
        ) : null}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        arXiv query syntax: <code className="font-mono">cat:cs.CL</code> ·{" "}
        <code className="font-mono">ti:&quot;agent memory&quot;</code> ·{" "}
        <code className="font-mono">all:retrieval</code> — combine with{" "}
        <code className="font-mono">AND / OR / ANDNOT</code>. Empty query falls back to fresh{" "}
        cs.AI / cs.CL / cs.LG submissions. Every hit links to arXiv, the alphaXiv discussion
        mirror and the PDF.
      </p>

      {error ? <ErrorBox message={error} onRetry={() => void search(query)} /> : null}

      {loading && !cache ? (
        <CardGridSkeleton count={4} />
      ) : (
        <div
          className="max-h-[56vh] overflow-y-auto pr-1"
          role="region"
          aria-label="arXiv paper radar results"
        >
          {!cache || cache.papers.length === 0 ? (
            <EmptyState
              emoji="📡"
              title="No papers on the radar yet"
              description="Run a query above — e.g. cat:cs.AI OR cat:cs.CL — and fresh preprints land here."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {cache.papers.map((paper) => (
                <Card key={paper.id} className="card-lift flex flex-col gap-2 p-4">
                  <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
                    {paper.title}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    {paper.authors} · {paper.published}
                  </p>
                  <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {paper.summary}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                    <LinkChip
                      href={`https://arxiv.org/abs/${paper.id}`}
                      ariaLabel={`Open arXiv abstract for ${paper.id}`}
                    >
                      arXiv
                    </LinkChip>
                    <LinkChip
                      href={`https://www.alphaxiv.org/abs/${paper.id}`}
                      ariaLabel={`Open alphaXiv discussion for ${paper.id}`}
                    >
                      alphaXiv
                    </LinkChip>
                    <LinkChip
                      href={paper.pdf}
                      ariaLabel={`Open PDF for ${paper.id}`}
                    >
                      PDF
                    </LinkChip>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {paper.id}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {cache && cache.papers.length > 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {cache.papers.length} papers · query{" "}
              <code className="font-mono">{cache.query}</code>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── View shell ──────────────────────────────────────────────────────────────

export function RadarView() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Trend Radar"
        description="Free/new models · GitHub stars · HF trending · arXiv papers — fetched on demand, cached locally"
      />
      <Tabs defaultValue="models" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-4 pt-3 md:px-6">
          <TabsList aria-label="Trend radar sections">
            <TabsTrigger value="models" className="gap-1.5">
              <Database className="h-3.5 w-3.5" aria-hidden />
              Models
            </TabsTrigger>
            <TabsTrigger value="github" className="gap-1.5">
              <Github className="h-3.5 w-3.5" aria-hidden />
              GitHub Stars
            </TabsTrigger>
            <TabsTrigger value="hf" className="gap-1.5">
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              HF Trending
            </TabsTrigger>
            <TabsTrigger value="papers" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Paper Radar
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="models" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <ModelRadarTab />
        </TabsContent>
        <TabsContent value="github" className="mt-0 min-h-0 flex-1 p-4 md:p-6">
          <GitHubStarsTab />
        </TabsContent>
        <TabsContent value="hf" className="mt-0 min-h-0 flex-1 p-4 md:p-6">
          <HfTrendingTab />
        </TabsContent>
        <TabsContent value="papers" className="mt-0 min-h-0 flex-1 p-4 md:p-6">
          <PaperRadarTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
