# NEXUS Cortex Harness — Supabase AI Assistant Paste Pack (v2)

> Copy everything inside the fence in **Step "Paste this to your Supabase AI Assistant"** into the
> Supabase AI Assistant on the NEXUS mirror project (`vwottesqbdgcsmvvvzok`).
> If the assistant asks for the exact TypeScript, open **Edge Functions → Deploy a new function →
> Via Editor**, name it `nexus-cortex-harness`, and paste `nexus-cortex-harness-edge-function.ts`
> (same folder, v2.0). The kickbot `nexus-cortex` function on the same project is NOT touched — this
> is a sibling function so the stream widget keeps working unchanged. Re-deploying over an existing
> `nexus-cortex-harness` v1 is safe and is the intended upgrade path (v1 cache rows stay valid).

---

## Paste this to your Supabase AI Assistant

````markdown
Please help me deploy an updated Edge Function named `nexus-cortex-harness` (v2) on this project. It
is the free intelligence substrate for my NEXUS agent harness — AGENT tool calls, not a chat widget:
Hyperbrowser deep-web lanes, a hedged BYOK LLM with exact+semantic caching, Upstash Vector semantic
memory, QStash durable async jobs, an Upstash Box sandbox lane, Redis rate limits/locks, and
append-only telemetry. Callers stay READ-ONLY on tables: every service-role write is telemetry or
cache rows only.

### 1. Database migration (run this first — idempotent, safe to re-run)

Two tables, RLS enabled, NO anon policies (the service role bypasses RLS; nothing is readable or
writable by anon):

```sql
create table if not exists public.nexus_cortex_events (
    id bigserial primary key,
    action text not null,
    ok boolean not null default true,
    lane text not null default '',
    cached boolean not null default false,
    latency_ms integer default 0,
    error text default '',
    created_at timestamptz default now()
);

create table if not exists public.nexus_cortex_cache (
    key text primary key,
    payload jsonb not null,
    created_at timestamptz default now(),
    expires_at timestamptz not null default now() + interval '30 minutes'
);

alter table public.nexus_cortex_events enable row level security;
alter table public.nexus_cortex_cache  enable row level security;

create index if not exists nexus_cortex_events_created_idx
    on public.nexus_cortex_events (created_at desc);
create index if not exists nexus_cortex_cache_expires_idx
    on public.nexus_cortex_cache (expires_at);
```

### 2. Deploy / update Edge Function `nexus-cortex-harness`

- `verify_jwt: false` — auth is a caller-chosen shared secret: when project secret
  `CORTEX_SHARED_SECRET` is set, every POST must carry header `x-nexus-cortex-key` with the same
  value; GET health stays open. Full CORS OPTIONS support (headers include `x-nexus-cortex-key`).
- Upstash Redis is deliberately NOT BYOK: it holds shared state (cache, rate counters, locks, job
  parking) and a caller-supplied Redis could poison it. Redis resolves from edge secrets only.
  Everything else resolves edge-secret-first, then per-request `body.keys`
  (`{hyperbrowserKey?, vectorUrl?, vectorToken?, qstashToken?, boxApiKey?, boxId?}`). Keys are never
  logged, never echoed.

Edge secrets (Dashboard → Edge Functions → Secrets) — mark of what needs what:
- `HYPERBROWSER_API_KEY` — required for scrape/search/crawl unless provided per-request (BYOK)
- `CORTEX_SHARED_SECRET` — recommended (random phrase); gates every POST
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — required for rate limits, locks, job
  parking, and the Redis L2 cache (without them: no limiting, Postgres cache fallback)
- `UPSTASH_VECTOR_REST_URL` + `UPSTASH_VECTOR_REST_TOKEN` — required for memory.* and the LLM
  semantic cache; the index MUST be created with an Upstash-hosted embedding model (recommended:
  hybrid text-embedding-3-small + BM25, 1536-dim)
- `QSTASH_TOKEN` — required for job.enqueue/job.schedule (optional `QSTASH_URL` for regional hosts)
- `BOX_API_KEY` + `BOX_ID` — required for sandbox.* (optional `BOX_REGION`, default us-east-1)
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Actions (POST JSON `{action, params, keys?}`; metered replies carry `telemetry.rate = {count, cap}`,
over-cap → HTTP 429 `{ok:false}`):
- `scrape` `{url, formats?, excludeSelectors?, maxChars?, autoRemember?}` → `{metadata, markdown, links}`;
  cap 60/h; with `autoRemember:true` a FREE rubric judge (no LLM, no vector ops: ≥1200 chars, ≥2
  structure signals, links:words < 0.5) may distill the page into vector memory in the background
- `search` `{query, site?, filetype?, excludeTerms?, boostTerms?, maxAgeSeconds?}` → `{query, results}`; cap 90/h
- `crawl` `{url, maxPages? (1–20), includePatterns?, excludePatterns?, maxCharsPerPage?}` →
  `{status, totalPages, pages}`; cap 20/h
- `llm` `{messages[], baseUrl, apiKey, model, temperature?, maxTokens?, hedge?, cache?}` — 6.5s
  shield then hedge race (BYOK); with `cache:true`: exact cache first (6h), then a DENSE cosine
  semantic cache on the vector index (score ≥ 0.93 → cached reply, never dials); fresh replies are
  cached into both layers in the background; cap 120/h
- `memory.put` `{text (≤12000), kind? (default "note"), id?, metadata?, source?}` → `{id, kind}`;
  content-dedupe id `mem_<sha16>`; cap 200/h
- `memory.query` `{text, topK? (≤10), kind?, threshold? (default 0.5)}` →
  `{results:[{id, score, data, metadata}], topK, threshold}` — DENSE cosine 0–1 scores; cap 300/h
- `memory.delete` `{id}` → `{deleted}` — exact id only (no prefix delete)
- `job.enqueue` `{action: scrape|search|crawl, params, delaySeconds? (≤604800), jobId?}` →
  `{jobId, messageId}`; cap 60/h. Flow: QStash publishes the job to this same function with the
  shared key forwarded; the function runs it and responds; QStash then delivers that response to the
  function's callback, which base64-decodes it and parks the outcome in Redis for 1h under
  `nexus:cortex:job:{jobId}`; you poll it with `job.result` — so long crawls never hit the ~26s
  client/edge wall-clock.
- `job.result` `{jobId}` → `{found:true, result}` or `{found:false, note:"not finished yet (or expired after 1h)"}`
  (unmetered — polling-friendly). `job.execute` and `job.complete` are internal (QStash-invoked only).
- `job.schedule` `{name (slug), cron (5+ fields), action, params}` → `{scheduleId}` — idempotent
  upsert via `Upstash-Schedule-Id: nexus-{name}`; each fire gets a fresh jobId and parks its own
  result; `lastFiredAt` rolls into a `nexus:cortex:sched:{name}` summary
- `sandbox.exec` `{command (string, run via sh -c) | argv (string[]), boxId?, region?, timeoutMs? (≤600000)}`
  → `{exitCode, output, error?}`; cap 40/h
- `sandbox.info` `{boxId?}` → `{status, runtime, size}`
- `lock.acquire` `{name, ttlMs? (≤600000)}` → `{acquired, holder?}` / `lock.release` `{name, holder}`
  → `{released}` — Redis `SET NX PX` distributed lock for pipeline dedupe; cap 60/h each
- `diagnostics` — `{secrets:{hyperbrowser, redis, vector, qstash, box, sharedSecretGate}}` (presence
  booleans only, never values), `rate:{day, hour}` snapshot, `vector:{vectorCount, dimension,
  indexType, embeddingModel}` (from `GET /info` when configured)

Request/response examples:

```json
{ "action": "scrape", "params": { "url": "https://example.com", "autoRemember": true } }
→ 200 { "ok": true, "action": "scrape",
        "data": { "metadata": { "title": "…" }, "markdown": "…", "links": [] },
        "telemetry": { "latencyMs": 612, "edgeRegion": "fra1", "cached": false,
                       "rate": { "count": 3, "cap": 60 },
                       "memorized": { "judged": true, "passed": true, "id": "mem_…" } } }
```

```json
{ "action": "memory.put", "params": { "text": "Upstash Vector free tier = 10K ops/day…",
                                      "kind": "note", "source": "owner" } }
→ 200 { "ok": true, "action": "memory.put", "id": "mem_9f2c…", "kind": "note",
        "telemetry": { "latencyMs": 240, "rate": { "count": 1, "cap": 200 } } }

{ "action": "memory.query", "params": { "text": "what are the vector free tier limits?", "topK": 3 } }
→ 200 { "ok": true, "action": "memory.query",
        "results": [ { "id": "mem_9f2c…", "score": 0.87, "data": "Upstash Vector free tier…",
                       "metadata": { "kind": "note", "source": "owner" } } ],
        "topK": 3, "threshold": 0.5, "telemetry": { "rate": { "count": 2, "cap": 300 } } }
```

```json
{ "action": "job.enqueue", "params": { "action": "crawl",
                                       "params": { "url": "https://docs.example.com", "maxPages": 12 } } }
→ 200 { "ok": true, "action": "job.enqueue", "jobId": "job_1a2b3c4d5e6f…",
        "note": "poll job.result — the edge parks the outcome for 1h" }

{ "action": "job.result", "params": { "jobId": "job_1a2b3c4d5e6f…" } }
→ 200 { "ok": true, "action": "job.result", "found": true,
        "result": { "ok": true, "data": { "status": "completed", "pages": [ … ] }, "at": "…" } }
```

```json
{ "action": "sandbox.exec", "params": { "command": "python3 -c 'print(6*7)'", "timeoutMs": 30000 } }
→ 200 { "ok": true, "action": "sandbox.exec", "exitCode": 0, "output": "42",
        "telemetry": { "rate": { "count": 1, "cap": 40 } } }
```

Free-tier budget map (why the caps are tight — "as free as possible, as smart as possible"):

| Lane | Free allowance | Edge behavior |
|---|---|---|
| Upstash Redis cmds | ≈500K /month | tiny INCR/GET/SETEX cmds; hourly fixed-window caps per action |
| Upstash Vector ops | 10K query+upsert /day (combined) | rubric-gated auto-memory; LLM semantic cache strictly opt-in |
| QStash messages | 1000 /day (1MB each, 10 schedules) | long jobs only, `Upstash-Retries: 2` |
| Upstash Box | 5 CPU-hours /month, 10 boxes | sandbox.exec 40/h |
| Hyperbrowser | per plan | scrape 60/h · search 90/h · crawl 20/h |

Behavior: scrape/search go through a 30-min L2 cache (Upstash Redis SETEX when configured, else the
`nexus_cortex_cache` table via service role); rate counters are hourly Redis fixed windows
(`telemetry.rate` on every metered reply); every request appends one `nexus_cortex_events` row via
`EdgeRuntime.waitUntil()` so the reply is never delayed; cache/memory/job-parking failures are
best-effort and never block the reply; no secrets in logs or responses.

I have the full TypeScript source ready — if you need it, tell me and I'll switch to
Edge Functions → Deploy a new function → Via Editor, name it `nexus-cortex-harness`, and paste
`nexus-cortex-harness-edge-function.ts` directly.
````

---

## Step 3 — Verify after deploy

```bash
BASE=https://vwottesqbdgcsmvvvzok.supabase.co/functions/v1/nexus-cortex-harness
KEY=<YOUR_SHARED_SECRET>

# health (no secret needed)
curl $BASE

# diagnostics (secret-gated — presence booleans + rate snapshot + vector info)
curl -X POST $BASE -H 'content-type: application/json' -H "x-nexus-cortex-key: $KEY" \
  -d '{"action":"diagnostics"}'

# memory round-trip (needs UPSTASH_VECTOR_REST_URL/TOKEN + a hosted-model index)
curl -X POST $BASE -H 'content-type: application/json' -H "x-nexus-cortex-key: $KEY" \
  -d '{"action":"memory.put","params":{"text":"NEXUS harness v2 is live — vector memory works.","kind":"note","source":"verify"}}'
curl -X POST $BASE -H 'content-type: application/json' -H "x-nexus-cortex-key: $KEY" \
  -d '{"action":"memory.query","params":{"text":"vector memory works?","topK":3}}'

# async job: enqueue, wait ~30s, then poll with the returned jobId
curl -X POST $BASE -H 'content-type: application/json' -H "x-nexus-cortex-key: $KEY" \
  -d '{"action":"job.enqueue","params":{"action":"scrape","params":{"url":"https://example.com"}}}'
curl -X POST $BASE -H 'content-type: application/json' -H "x-nexus-cortex-key: $KEY" \
  -d '{"action":"job.result","params":{"jobId":"<jobId from enqueue>"}}'

# sandbox (needs BOX_API_KEY + BOX_ID)
curl -X POST $BASE -H 'content-type: application/json' -H "x-nexus-cortex-key: $KEY" \
  -d '{"action":"sandbox.exec","params":{"command":"echo hello from the box"}}'
```

## Then wire it into the harness

NEXUS WebGUI → **Settings → Cortex Edge**: paste the Function URL + the shared key, hit **Probe**
(GET health), then enable the edge tools on agents. v1 lanes keep their order
(`edge function → direct Hyperbrowser → read_url fallback`). v2 adds the agentic lanes: semantic
memory (`memory.put`/`memory.query`), durable long crawls (`job.enqueue` → poll `job.result`),
sandbox shells (`sandbox.exec`), pipeline locks (`lock.acquire`/`lock.release`), and
`autoRemember` on scrape — all free-tier-metered via `telemetry.rate`.
