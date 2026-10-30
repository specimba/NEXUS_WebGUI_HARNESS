"use client";

// ─── GitHub Stars tab (r423, survey slice 2) ────────────────────────────────
// Mechanical move out of radar-view.tsx per the r422 decomposition plan —
// types, GH constants, clusters, and the tab component, verbatim. The only
// edit is the catch block: the friendly-timeout regex lived copy-pasted in
// all three radar tabs; it is now the shared isTimeoutError() predicate in
// radar-shared (the per-source timeout messages stay at the call sites —
// "GitHub took too long" vs "Hugging Face took too long" vs arXiv's wording).

import * as React from "react";
import { ArrowUpRight, Github, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/nexus/atoms";
import {
  CacheStatus,
  CardGridSkeleton,
  Chip,
  ErrorBox,
  isTimeoutError,
  readCache,
  relTime,
  writeCache,
} from "./radar-shared";
import { apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

const GH_USER_KEY = "nexus-radar-user";
const GH_CACHE_KEY = "nexus-radar-gh";

const DEFAULT_GH_USER = "specimba";
const GH_PAGES = 3; // 3 × 100 repos — enough radar, not a full scrape

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
      let poolPages = 0; // r516: pages that needed the Webshare egress pool
      // r26: routed through our own /api/radar/github proxy — it sanitizes
      // the username and may attach a SERVER-side token for a higher rate
      // limit (never shipped to the client). Still an explicit user action.
      for (let page = 1; page <= GH_PAGES; page++) {
        // r786: the GitHub proxy pages ride the apiJson guard - idempotent
        // GETs with the 30s pool-retry timeout passing through untouched; a
        // death-window HTML page now raises the honest ApiError into the
        // same error line instead of the generic HTTP fallback.
        const { res, json: data } = await apiJson<{ repos?: GhRepo[]; error?: string; via?: string } | null>(
          `/api/radar/github?user=${encodeURIComponent(name)}&page=${page}`,
          { signal: AbortSignal.timeout(30_000) }, // r516: 20s→30s — the pool retry leg adds a hop
        );
        if (res.status === 404) throw new Error(`GitHub user “${name}” was not found.`);
        if (res.status === 429) throw new Error(data?.error ?? "GitHub API rate limit hit — try again in a bit.");
        if (!res.ok || !data || !Array.isArray(data.repos)) {
          throw new Error(data?.error ?? `GitHub API returned HTTP ${res.status}.`);
        }
        if (data.via === "pool") poolPages++;
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
      // r516: honest routing witness — the direct egress IP was rate-limited
      // and the residential pool carried this refresh instead.
      if (poolPages > 0) {
        toast.success("Refreshed via the egress pool", {
          description: `Direct GitHub dials were rate-limited; ${poolPages} page${poolPages === 1 ? "" : "s"} rode the Webshare pool instead.`,
        });
      }
    } catch (err) {
      const message = isTimeoutError(err)
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
            // r245 IME parity sweep: Enter confirming a CJK composition must
            // not fire the fetch with a half-composed username.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void fetchStars(user);
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
            staleAfterMs={7 * 86_400_000}
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
                      <Card key={repo.id} className="card-lift cv-auto flex flex-col gap-2 p-4">
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
            {/* r417 aria-live parity (r411 handoff): every other filter-driven
                count line in this view announces politely (GH status 495, HF
                763/832, models-tab signals 306) — this one updates on every
                keystroke in the keyword filter and was the last silent one. */}
            <p className="mt-2 text-[11px] text-muted-foreground" aria-live="polite">
              {filtered.length} of {cache.repos.length} starred repos
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

export { GitHubStarsTab };
