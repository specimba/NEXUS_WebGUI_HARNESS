"use client";

// ─── Paper Radar tab (r425, survey slice 4 — final) ─────────────────────────
// Mechanical move out of radar-view.tsx per the r422 decomposition plan —
// types, the arXiv cache keys, the papers constants, and the tab component,
// verbatim. Zero code edits beyond the move: the catch block already calls
// the shared isTimeoutError() predicate in radar-shared (r423). With this
// slice radar-view.tsx is just the view shell and the decomposition closes.

import * as React from "react";
import { FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/praison/atoms";
import { cn } from "@/lib/utils";
import {
  CacheStatus,
  CardGridSkeleton,
  ErrorBox,
  isTimeoutError,
  LinkChip,
  readCache,
  writeCache,
} from "./radar-shared";

const ARXIV_CACHE_KEY = "praison-radar-arxiv";
const ARXIV_QUERY_KEY = "praison-radar-paper-query";

const PAPERS_MAX = 12;
const DEFAULT_PAPER_QUERY = "cat:cs.AI OR cat:cs.CL OR cat:cs.LG";

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Paper Radar tab ─────────────────────────────────────────────────────────

export function PaperRadarTab() {
  const [query, setQueryState] = React.useState<string>(
    () => readCache<string>(ARXIV_QUERY_KEY) ?? DEFAULT_PAPER_QUERY
  );
  // r240: every keystroke persists, mirroring the GitHub username input —
  // a query typed but not yet searched now survives view switches (before,
  // only the last SEARCHED query came back on remount).
  const setQuery = (q: string) => {
    setQueryState(q);
    writeCache(ARXIV_QUERY_KEY, q);
  };
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
        const message = isTimeoutError(err)
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
    const typed = readCache<string>(ARXIV_QUERY_KEY);
    if (cached) {
      setCache(cached);
      setQuery(typed?.trim() || cached.query || DEFAULT_PAPER_QUERY);
    } else {
      void search(typed?.trim() || DEFAULT_PAPER_QUERY);
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
              // r245 IME parity sweep: don't search mid-composition.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void search(query);
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
            staleAfterMs={86_400_000}
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
