# Radar source recon — r48 (2026-09-24)

Closes the advisory-pack-r41 backlog item carried since r42: "researchPOD/fancyLINKS
as Radar source-candidates — S, read-only recon before any integration; queue,
do not build blind."

## Scope and honesty notes

The two raw guide files (`researchPODguide.txt` 53 KB, `fancyLINKSandUSEFULtoolsSITESguide2409.txt` 468 KB) referenced by the advisory pack are **not present in the repository** — only their summaries in `docs/research/advisory-pack-r41.md` survived. This recon therefore combines: (a) the pack's summaries, and (b) a **live probe of researchpod.app** performed 2026-09-24 via agent-browser (landing page, `/search` UI, real search interaction, network capture, direct endpoint probing). fancyLINKS cannot be mined without the file; verdict for it is "parked, needs the artifact re-supplied" — see §3.

## 1. researchPOD — live probe results

**What it is** (confirmed live, matches the pack's UI capture): a paper-search +
audio-explanation product ("Your Reading List, Ready for Your Commute"). Public
`/search` page searches "by title, topic, arXiv ID, or DOI" across a fused
arXiv + OpenAlex corpus, with topic shortcuts (Large Language Models, Quantum
Computing, mRNA Vaccines, …), citation counts, per-paper listen-time estimates,
and save-to-library flows behind auth.

**API surface found (all unauthenticated, probed directly):**

| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/proxy/api/library-search?q=…&limit=N` | 200 | The real search backend, reached through the app's own BFF proxy. Rich JSON. |
| `GET /api/proxy/api/public-folders?q=…&limit=N` | 200 | Curated public paper folders (name, slug, paper_count, top_categories, follower_count, share_url, cover_emoji). |
| `GET /api/health` | 200 | Plain liveness. |
| `/api/papers`, `/api/search`, `/api/papers/search` | 404 | Guessed "clean" API paths do not exist — everything rides `/api/proxy/…`. |

**library-search payload shape** (from a live `?q=transformer&limit=2` call):

- Envelope: `papers`, `results`, `author`, `top_score`, `weak_match`,
  `matched_count`, `library_results`, `external_results`, `query`, `query_type`,
  `provider_warnings`, `total_papers`, `total_library`, `total_external`,
  `has_more_papers`, `has_more_external`, `pagination`.
- Per paper (40+ fields): `doi`, `arxiv_id`, `openalex_id`, `title`, `authors[]`
  (name, affiliation, `openalex_author_id`), `abstract`, `publication_date`,
  `source` ("arxiv" observed), `source_url`, `pdf_url`, `is_open_access`,
  `citation_count`, `topics`, `openalex_topics`, `primary_category`,
  `has_podcast`/`podcast_status`, `has_summary`/`summary_status`,
  `ingestion_status`, `source_text_available`, plus internal ranking fields
  (`_provider_rrf_score`, `_provider_ranks`, `_semantic_similarity`, `_score`).

**Interpretation:** researchPOD is a *hybrid aggregator front-end* — reciprocal-rank
fusion over OpenAlex + arXiv with semantic-similarity re-ranking. The integration-
critical fact: **the same data is available from the documented upstream APIs**
(`api.openalex.org` — free, no key, polite-pool with mailto; `export.arxiv.org/api`
— free, no key). researchpod's `/api/proxy/…` is an *internal app route*, not a
published API: no auth model for third parties, no documented stability or rate
limits, and its robots/ToS say nothing about programmatic reuse.

**Verdict (researchPOD):** VIABLE DATA, WRONG PIPE. Riding their BFF proxy would
couple the Radar to an undocumented internal route that can change or rate-limit
without notice — against the platform's local-first/BYOK stability doctrine.
**Recommendation: integrate the documented upstreams directly**
(OpenAlex `works?search=` for papers+abstracts+citations; arXiv API for
preprint-first rows), using researchpod solely as (1) UX reference for the
fused-search/podcast framing and (2) a shape reference for the RRF-fusion
fields worth keeping (`_provider_rrf_score`-style multi-source provenance).
This converts the carried "add researchPOD as a source" into a concrete,
doctrine-compliant next step: a **Radar Papers tab** with two honest sources
(openalex, arxiv) — same source-discipline as the LLM tracker (per-source
health, TTL throttle, unknown → silence), zero new vendor risk.

**Effort estimate:** M (new Radar data type — papers are not model lanes; needs
its own row shape, sync path, and tab) — the recon itself was the S item, and it
is now closed. Do not start the Papers tab without its own round.

## 2. What this means for the existing tracker

The current 7 LLM sources stay untouched. The r45-r48 capability doctrine
(extract only where published, unknown ≠ no) ports cleanly to OpenAlex/arXiv:
fields like `is_open_access`/`citation_count` are *declared data*, while anything
the upstream omits renders as silence. The 10-min sync TTL throttle and
`meta` JSON `slice(0,1000)` headroom check should be re-validated against paper
abstracts, which are much larger than model metadata — truncation policy must be
decided before any build.

## 3. fancyLINKS — verdict

Raw file absent from the repo; the pack describes it as "curated link dump of
useful sites/tools (hundreds of entries)… an index task, not a build spec."
Without the artifact there is nothing honest to index. **Parked.** If the file
re-appears, the task remains read-only indexing into a candidate list (same
treatment as §1: prefer documented upstreams over scraped aggregators). No
round should block on it.

## 4. Decision record

1. researchPOD as a *direct* tracker source: **REJECTED** (internal BFF route, undocumented).
2. OpenAlex + arXiv as Radar Papers sources: **ADOPTED as candidate** — queued behind a dedicated design round (row shape, truncation policy, sync cadence).
3. researchpod.app kept as UX/shape reference only.
4. fancyLINKS: parked pending the raw artifact.
