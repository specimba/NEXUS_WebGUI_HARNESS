# HF Hub capabilities — deep dive (r501)

Trigger (owner, r501): *"give proper deep dive investigation into HF docs with HF cli HUB usage and I can provide for more if you have smarter approaches with bucket / space / ssh gpg key needs etc — adapt them our platform in useful way."*

Method: live pulls of huggingface.co docs + Hub API (not memory), plus the owner's token-scoped repo list. Everything below is verified against what HF serves today.

---

## 1. What the Hub actually offers (verified)

| Surface | What it is | Verified evidence |
|---|---|---|
| **Models** | Git-versioned weight repos; API `huggingface.co/api/models` with `sort=trendingScore/createdAt`, pipeline/library filters | Used by tracker + radar today |
| **Datasets** | Same repo type for data; **"Agent Traces"** now a first-class doc section | Hub docs sidebar |
| **Spaces** | App hosting (Gradio/Streamlit/Static/Docker); **"Spaces as MCP servers"**, "Spaces as Agent Tools", "Spaces as API Endpoints" are documented patterns | Hub docs sidebar |
| **Storage Buckets (new)** | **S3-like object-storage repo type on the Xet backend — non-versioned, mutable**, aimed at checkpoints/logs/artifacts. Reachable via hf CLI, Python API, `hf://` paths, **S3-compatible API (AWS CLI, boto3, s5cmd)**, volume mounts in Jobs/Spaces, pandas/Dask snippets | `docs/hub/storage-buckets` (200): *"S3-like object storage, powered by the Xet storage backend… non-versioned and mutable"* |
| **Jobs** | Docker-image jobs on HF hardware: serve models, train, process datasets, **scheduled via cron + webhook automation** | Hub docs sidebar |
| **Inference Providers** | Routed serverless inference behind one token (`Make calls to Inference Providers`) — the owner's new PAT has this scope | Token page (owner-provided) |
| **Auth** | Fine-grained PATs (per-repo scopes — the owner's token enumerates 8 `buckets/specimba/*` + spaces + a dataset), SSH/GPG keys for **git-over-SSH only**, OAuth for sign-in flows | Token page + docs |

The owner's token already scopes: `specimba/nexus-l2-v5-agent-security`, `datasets/specimba/ml-intern-sessions`, 3 spaces (`nexus-os-space`, `nexus-os-lab`, `nexus-os-backyard-ai`) and **8 buckets** (DiscoveryNEXUS, nexus, nexus-private, nexus-storage, home, nexus-vap-bucket, nexus-worker-storage, NEXUS_General_USE).

## 2. Shipped this round (r501)

- **HF PAT stored properly**: `db/hf-token.txt` (chmod 600, **gitignored**, same discipline as the r498 git credentials). Read by `src/lib/server/hf-token.ts` (mtime-cached → rotate the file, no restart).
- **Wired server-side**: tracker's `fetchHuggingFaceSignals` + `/api/radar/hf` proxy now send `Authorization: Bearer <token>` → higher Hub rate-limit ceiling + gated repos the token can see. Token never enters the browser bundle.
- **UI truth-chip**: HF Trending tab shows a green "HF auth" pill when the proxy answered authenticated.
- **Local-models catalog rebuilt** from the *installed* web-llm 0.2.85 prebuilt list (163 entries) — Qwen3.5 0.8B/2B/4B/9B, Ministral-3-3B ×3 (Dec-25), Qwen3 1.7B, Qwen2.5-3B, OLMo-2-1B added; transformers.js rows now include **onnx-community/LFM2-350M-ONNX** and **onnx-community/Qwen3-0.6B-ONNX** (both verified 200 on the Hub). Every vramMB is the package's own number — nothing can 404 on load.

### The MTP / DFLASH honesty note (owner's ask, answered)
Trending small models on the Hub right now — LFM2.5-24B-A2B (+GGUF), Nemotron **Dory1.0-4B**, **Mellum2.1-12B-A2.5B-Thinking** (+GGUF), **Kolibri-1** (+ MLX 3–8bit variants), Ternary-Bonsai-2-27B-gguf — ship **GGUF / MTP / DFLASH / MLX** variants. Those are **llama.cpp / vLLM / MLX server formats**: a browser tab can only stream **MLC-compiled** weights (that's what WebLLM's q4f16 *is* — 4-bit quantized, shader-f16). So the local panel stays MLC-only (now current), and the MTP/DFLASH fleets are reachable via the **server paths** below, not the browser.

## 3. Ranked adaptations for NEXUS (proposed)

- **A. Bucket-backed archive backups (highest leverage, smallest build)** — the 4–5 MB `nexus-workflows-full.json` export packs + `db/custom.db` snapshots pushed to `buckets/specimba/NEXUS_General_USE` via the **S3-compatible API** (server-side, same gitignored-credential pattern). Non-versioned + mutable = exactly right for rolling backups. *Needs from owner:* an S3 access key pair for one bucket (or confirm the PAT itself works for S3 sigv4), and which bucket is canonical.
- **B. Spaces as MCP servers / Agent Tools** — the owner's 3 nexus spaces can be attached as tools for the chat agents (documented HF pattern). Natural extension of the tools layer; no new credentials needed beyond the PAT's space read scope.
- **C. HF Inference Providers as a relay lane** — the token's "Make calls to Inference Providers" scope enables a token-gated server lane with real small-model serving; quota-billed, so BYOK-doctrine: opt-in slot in the Automation Vault ("provider: huggingface"), never implicit.
- **D. Jobs for heavy research** — scheduled Docker jobs could run the research pipelines on HF hardware instead of the sandbox; cron + webhooks already exist on both sides. Bigger lift; park until A/B land.
- **E. SSH/GPG**: only needed for git-over-SSH pushes; the HTTPS PAT (r498) already covers everything the platform does. Recommend **not** adding SSH keys to the platform — one credential type per lane is easier to audit.

## 4. What the owner can provide next (his standing offer, answered concretely)

1. S3 access keys (or confirmation the PAT authorizes S3-sigv4) for the canonical backup bucket → unlocks **A**.
2. Pick: which of the 8 buckets is the archive-of-record.
3. Optional: a second fine-grained token with **write** scope limited to that one bucket (least-privilege for the backup lane).
