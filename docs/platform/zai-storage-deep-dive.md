# chat.z.ai Storage & z-ai-web-dev-sdk — Deep Dive (r517)

> Distilled from round 517-b research (SDK v0.0.18 enumeration + a 3-layer
> live probe of the storage surfaces + a real 172.5MiB sharded round-trip).
> Answers the Owner's question: can the backend use the new chat.z.ai 2GB
> account storage (50MB per upload), and how do we get durable offsite
> backups despite the caps?

## Verdict

| Surface | Status | Detail |
|---|---|---|
| chat.z.ai 2GB storage from the backend | **BLOCKED (session-gated)** | `POST https://chat.z.ai/api/v1/files` EXISTS (Allow: POST) but returns `403 {"detail":"Not authenticated"}` with no-auth AND with every SDK credential (Bearer apiKey, X-Token, X-User-Id, X-Chat-Id). It is a **browser-session feature** — the SDK token does not transfer. Unlocking would require exporting the Owner's chat.z.ai session cookie (brittle, expiry/CSRF/ToS-sensitive — intentionally NOT built). |
| SDK upload/storage API | **ABSENT** | z-ai-web-dev-sdk v0.0.18 (latest on npm) has ZERO upload/storage functions. The internal API (`internal-api.z.ai/v1`) 404s every storage-shaped path (`files`, `upload`, `storage`, `oss`, `buckets`, `attachments`, …) with verified-valid auth. |
| The Owner's actual pain | **SOLVED NOW via sharding** | Full platform payload (~249M) → 172.5MiB tar.gz → **4 × ≤49MiB shards** — under both chat.z.ai's 50MB/upload and Supabase's 50MB/object caps. Pipeline proven live (split → manifest → reassemble → `sha256sum -c` OK) and shipped as `scripts/backup-shard.sh`. |

## Recommended shard home

1. **PRIMARY — Supabase Storage bucket `nexus-backups`** on the EXISTING
   active mirror project (`vwottesqbdgcsmvvvzok`): same anon key the Owner
   already holds, 1GB free tier ≈ 5 archive generations, 50MB/object limit
   matches 49MiB shards. One-time Owner dashboard step: create the bucket +
   policies (**anon insert allowed, anon select DENIED** — the mirror's
   run_reports precedent shows anon-read is readable by key holders).
2. Secondary — GitHub backup repo (already wired via `scripts/backup-push.sh`
   + `GITHUB_BACKUP_PAT`), but that lane covers TRACKED files only and is
   **blocked until the bb6120b31 PAT is rotated**.
3. Tertiary — manual WebUI: upload the 4 shards to chat.z.ai storage (exactly
   4 uploads under the 50MB cap).

## Security doctrine (baked into backup-shard.sh)

- NEVER archive `.chrome-qa-profile` (QA session cookies) or `.env`.
- `db/custom.db` IS the crown jewel — it rides in the archive, so treat the
  destination as sensitive: insert-only bucket policies, encrypt (age/gpg)
  before third-party storage if it ever leaves trusted infrastructure.
- Rotate the git-history-exposed GitHub PAT BEFORE the GitHub lane carries shards.

## SDK capability surface (v0.0.18 — worth exploiting)

Zero runtime deps; config from `./.z-ai-config → ~/.z-ai-config → /etc/.z-ai-config`
(JSON: baseUrl, apiKey, chatId?, userId?, token?); auth headers `Authorization:
Bearer <apiKey>` + `X-Z-AI-From: Z` + optional `X-Chat-Id` / `X-User-Id` / `X-Token`.

| Capability | Call | Notes |
|---|---|---|
| LLM chat | `zai.chat.completions.create(body)` | `thinking: {type:'enabled'|'disabled'}`, SSE passthrough on `stream:true` |
| VLM | `zai.chat.completions.createVision(body)` | content items `text \| image_url \| video_url \| file_url` — **file_url accepts pdf/txt/word/jsonl/xlsx/pptx BY URL (read-only) — VLM document understanding over any hosted file, no upload needed** |
| TTS | `zai.audio.tts.create(body)` | raw `Response`; SSE PCM base64 streaming; voices/speed 0.5–2.0 |
| ASR | `zai.audio.asr.create(body)` | `{file \| file_base64}` JSON body — no multipart |
| Image gen | `zai.images.generations.create(body)` | 7 sizes; returns base64 (URLs auto-downloaded) |
| Image edit | `zai.images.generations.edit(body)` | prompt + image |
| Image search | `zai.images.search.create(body)` | **OSS-hosted guaranteed-reachable direct URLs** |
| Video gen | `zai.video.generations.create(body)` | prompt / image_url (single or 2-frame first+last), quality speed\|quality, with_audio, fps 30/60, duration 5\|10s |
| Async poll | `zai.async.result.query(taskId)` | video task status + result URLs |
| Functions | `zai.functions.invoke(name, args)` | `web_search {query, num?, recency_days?}` · **`page_reader {url → html, title, publishedTime, tokens}` — server-side web reading through Z.ai's own egress (a WAF-bypass lane for content fetch)** |

CLI mirrors everything (`z-ai chat|vision|tts|asr|image|image-edit|image-search|video|async-result|function`).

### Adaptation candidates for NEXUS (from this census)

- `page_reader` as a content-fetch escape hatch where direct fetches get
  WAF-403'd (complements the Webshare egress pool).
- `images.search` OSS URLs for research lanes needing guaranteed-reachable art.
- `createVision` `file_url` over hosted PDFs (arXiv lanes) — document
  understanding without any storage.
- TTS raw-Response streaming + ASR base64-JSON for the bot system's voice lanes.
