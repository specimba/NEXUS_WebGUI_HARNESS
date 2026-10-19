# HF Hub + GitHub — Deep Integrations Research (r501 part 2)

> Follow-up to `hf-hub-capabilities-r501.md` (part 1). Everything below was
> **live-verified** against the real APIs on 2026-10-19 with the owner's
> credentials (HF PAT `db/hf-token.txt`, GitHub PAT embedded in the origin
> remote) — not doc-copied. Two parallel research agents produced the raw
> matrices; this doc is the synthesis + what we shipped + what's parked and why.

---

## 1. Hugging Face — verified capability map

| Surface | Endpoint | Status | Notes |
|---|---|---|---|
| Identity | `GET /api/whoami-v2` | ✅ 200 | `specimba`, `isPro:false`, `canPay:false`, `billingMode:"prepaid"` |
| Router catalog | `GET router.huggingface.co/v1/models` | ✅ 200 **public** | 135 models × 14 live providers, rich annotations |
| Router dialing | `POST /v1/chat/completions` | ❌ **402** | "no remaining credits" — account has 0 prepaid credits; `is_free` lanes today: **0** |
| Task routers | `router…/{task}/v1/models` | ❌ 404 | OpenAI-compat is chat-only; no per-task model lists |
| Spaces fleet | `GET /api/spaces?author=…` + `/api/spaces/{id}/runtime` | ✅ 200 | **8 spaces** (4 RUNNING / 3 SLEEPING / 1 PAUSED), hardware + domains per space |
| MCP spaces | `GET /api/spaces?filter=mcp` | ✅ 200 | MCP-badged spaces are discoverable; Hub docs confirm read-token MCP auth |
| Webhooks | `GET /api/settings/webhooks` | ✅ 200 | ⚠️ **`/api/webhooks` is NOT the route** — it 401s under every auth scheme. The settings route works |
| Webhook health | `disabled` field | 🚨 finding | Owner's webhook (`nexus-os-mcp-core.hf.space/webhook/telegram`, 10 watched) is **`suspended-after-failure`** — HF auto-suspends and never tells you |
| Collections | `GET /api/collections?owner=…` + `/{ns}/{slug}` | ✅ 200 | 1 collection ("consciousness"); items carry `_id,type,id,position` |
| Owned artifacts | `/api/models?author=` `/api/datasets?author=` | ✅ 200 | 6 models, 7 datasets |
| Datasets-server | `datasets-server.huggingface.co/{splits,first-rows,search,parquet,statistics,rows}` | ✅ all 6 live | Verified on `HuggingFaceH4/no_robots`; ⚠️ rename trap: `fka/awesome-chatgpt-prompts` 404s here while the Hub API 307s to `fka/prompts.chat` |
| Jobs | `GET /api/jobs/{ns}` | ✅ 200 (empty) | routes: `/{id}/cancel,duplicate,expose,labels` + `/api/jobs/hardware` |
| JS clients | `@huggingface/hub@2.17.8`, `@huggingface/inference@4.13.32` | ✅ npm | hub: whoAmI/listModels/downloadFile/uploadFile/deleteFiles/listCollections; inference: `InferenceClient` + 40+ tasks + 21 providers + `auto` |

### HF verdicts
- **Inference Providers as a vault lane = parked by billing, not tech.** The
  router API is fully OpenAI-compatible and the catalog is the best
  provider-annotated model table anywhere (latency, throughput, pricing,
  supports_tools per provider). But with 0 credits every dial is a 402. The
  platform treats it as a **catalog lane** until credits/PRO exist.
- **Webhook-driven model-update push is viable but the owner's webhook is
  suspended.** The fleet panel now polls `/api/settings/webhooks` and renders
  the suspension in red — this was previously a silent failure.
- **Datasets-server = free prompt-pack/eval-stream material** (no downloads).

## 2. GitHub — verified capability map (fine-grained PAT from r498)

| Capability | Status | Evidence |
|---|---|---|
| Identity | ✅ 200 | `specimba`; token expiry exposed via the `github-authentication-token-expiration` response header (2027-01-14 — surfaced in the ops card) |
| Rate budget | ✅ free | core 5000/h, search 30/min, code_search 10/min, graphql 5000/h |
| Gists READ | ✅ 200 | 3 gists, full inline content ≤ ~65KB/file, `truncated:false` |
| **Gists WRITE** | ❌ **403** | `"Resource not accessible by personal access token"` — fine-grained PATs need the **account-level "Gists" permission**; r498's PAT was minted without it |
| Contents GET | ✅ 200 | any path/ref, base64, ETag-cacheable (`max-age=60`) |
| Contents PUT | 📄 documented | `{message, content(base64), sha, branch}` → 201; 409 on stale sha → re-GET |
| Releases | ✅ reads 200 | 0 releases today; create + `uploads.github.com` asset upload documented; **unauthenticated download URLs verified live** |
| Commit status | ✅ shape | `POST /repos/{o}/{r}/statuses/{sha}` — client-side friendly radar-evidence markers |
| Sync state | ✅ | `git/refs/heads/main` = `b925847d6`; compare to local HEAD (no clone needed) |
| ETag 304 | ✅ | `If-None-Match` round trip → 304, 0 bytes |
| Code search | ❌ broken on own repos | fine-grained PAT quirk: `total_count:0, incomplete_results:true` for symbols that verifiably exist. Workarounds: classic PAT, local `git grep`, `/git/trees?recursive=1` |
| Actions | ✅ workflows list 200 | 0 workflows; dispatch + scheduled `.github/workflows/*.yml` documented |

## 3. What we shipped in r501-p2 (this round)

1. **`/api/hub/fleet`** (server) — one authenticated HF sweep: identity +
   billing truth, 8 spaces with runtime stages, owned models/datasets/
   collections, **webhook health incl. `suspended-after-failure`**, router
   catalog top-12 lanes sorted by first-token latency. Every section degrades
   independently.
2. **Hub Fleet panel** (HF Trending tab) — collapsible, explicit "Load fleet",
   localStorage-cached (`nexus-radar-hf-fleet`), red suspended-webhook badge
   on the collapsed header, billing honesty line ("no prepaid balance →
   router lanes are catalog-only"), router table with TTFT/ctx/pricing.
3. **`/api/gh/vitals`** (server) — GitHub sweep with the r498 PAT derived from
   the origin remote (`src/lib/server/gh-token.ts`, 5-min TTL, no second
   credential copy on disk): identity, free rate-limit meter, local-vs-remote
   sync state, repos fleet (top 5 by push), gists fleet.
4. **GitHub Ops card** (Settings → "GitHub" section) — probe button, PAT
   chip, budget meters (color-banded), sync row with short SHAs + "in sync /
   push needed", repos + gists lists, static 403-capability note.
5. **Secret hygiene**: no tokens in code/docs; HF token stays in
   `db/hf-token.txt` (gitignored), GitHub token stays derived from the remote
   URL at runtime.

## 4. Ranked next integrations (with the exact unlock conditions)

| # | Integration | Unlocks when | First call |
|---|---|---|---|
| A | **Gist-backed snapshot backup** (platform export → secret gist → PATCH updates) | owner regenerates the fine-grained PAT with **Gists write** (or a classic PAT w/ `gist`) | `POST /gists {"description","files":{"nexus-snapshot-…json":{"content":…}}}` |
| B | **HF webhook → NEXUS receiver** (model-update push into the radar) | owner re-enables the suspended webhook + points it at an NEXUS `/api/hf/webhook` route w/ HMAC secret | `POST /api/settings/webhooks {watched,domains,secret,url}` |
| C | **HF Inference Providers as opt-in vault lane** | owner adds prepaid credits or PRO; then BYOK vault entry `hf-token + router base URL` is OpenAI-compatible out of the box | `POST router.huggingface.co/v1/chat/completions` |
| D | **Datasets-server prompt-packs** (no-download eval/prompt streams into Studio) | nothing — buildable now | `datasets-server.huggingface.co/first-rows?dataset=…` |
| E | **Commit-status radar evidence markers** (ack a finding → status on HEAD) | nothing — but needs a deliberate "server writes to GitHub" policy decision | `POST /repos/{o}/{r}/statuses/{sha}` |
| F | **Releases-as-artifact-CDN** (versioned export snapshots, shareable unauth download URLs) | nothing — needs policy decision (public artifacts!) | `POST /releases` + `uploads.github.com/…/assets` |
| G | **Nightly radar CI workflow** (scheduled snapshot commit) | owner approves adding `.github/workflows/` | `on: schedule: cron` + `permissions: contents: write` |

## 5. Risks / caveats to remember

- Webhook suspension is **silent** — only polling surfaces it (the fleet
  panel does now).
- Datasets-server does **not** follow dataset renames (hub API does).
- Router `pricing` is optional per provider (109/339 entries lack it) — UI
  must render "—" honestly.
- Code search on own repos is unusable with fine-grained PATs — never put it
  in a radar loop anyway (10/min budget).
- Gist file content inline cap ≈ 65KB — snapshots must chunk or compress.
- All GitHub writes (gists today) depend on PAT shape; rotation =
  re-embed in the remote URL, picked up within 5 min.
