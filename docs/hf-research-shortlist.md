# HuggingFace Hub Deep Research — Shortlist

> Task ID: phase-4 (research-only) · Date: 2026-09-15 · Method: `hf` CLI 1.9.2 (huggingface_hub) + HF REST API via curl, all sizes verified from the Hub API (see §D).
> Scope: (A) models that fit an 8 GB VRAM budget, (B) agent-tooling/UX Spaces, (C) top-5 concrete integrations for PraisonAI Web, (D) method & sources.
> Not re-researched: the 12 WebGPU inference Spaces already curated in `src/lib/hf-spaces.ts` and the 21 WebLLM prebuilts in `src/lib/webgpu.ts` (cross-checked, see §D contradictions).

---

## A. ≤ 8 GB VRAM model shortlist (20 verified rows)

**VRAM column = on-disk weight size + ~1.25 GB KV/activation headroom** (GQA models ≈ 0.13–0.15 MB/token → an 8K-token window costs ~1–1.2 GB). All weight sizes are **measured on-disk bytes from the HF API** (`?blobs=true`), not card claims. ⚠️ = see note.

| # | Repo id | Params | Quantization | Weight size | Expected VRAM | Why relevant to our app | Notes (license · context) |
|---|---------|--------|--------------|-------------|---------------|--------------------------|----------------------------|
| 1 | `unsloth/Qwen3-4B-Instruct-2507-GGUF` | 4B | GGUF Q4_K_M (IQ4_XS 2.17 GB) | **2.38 GB** | ~3.6 GB | Primary local agent/chat workhorse — fast non-thinking mode, strong instruction following | Apache-2.0 · ctx 256K (config measured) |
| 2 | `Qwen/Qwen3-8B-AWQ` | 8.2B | AWQ Int4 (official) | **5.82 GB** (shard sum) | ~7.1 GB — fits 8 GB **tightly**, short ctx only | Best-quality single-GPU ≤8 GB chat/agent model | Apache-2.0 · ctx 40K native |
| 3 | `bartowski/Meta-Llama-3.1-8B-Instruct-GGUF` | 8B | GGUF Q4_K_M | **4.69 GB** | ~6.0 GB | General chat + native tool-calling via Ollama/custom provider | llama3.1 · ctx 128K |
| 4 | `bartowski/Llama-3.2-3B-Instruct-GGUF` | 3.2B | GGUF Q4_K_M | **1.93 GB** | ~3.2 GB | Balanced chat/tool-caller for mid GPUs | llama3.2 · ctx 128K |
| 5 | `bartowski/Llama-3.2-1B-Instruct-GGUF` | 1.2B | GGUF Q4_K_M | **0.77 GB** | ~2.0 GB | Tiny router / tool-dispatcher / heartbeat agent | llama3.2 · ctx 128K · already in-app as WebLLM q4f16 (879 MB) |
| 6 | `unsloth/gemma-3-4b-it-GGUF` | 4.3B | GGUF Q4_K_M (+mmproj for vision) | **2.38 GB** | ~4.3 GB | Multimodal chat; pairs with `run_code` for image analysis | gemma license · ctx 128K |
| 7 | `unsloth/Phi-4-mini-instruct-GGUF` | 3.8B | GGUF Q4_K_M | **2.38 GB** | ~4.2 GB | Strong function-calling at low VRAM — good default agent model | MIT · ctx 128K (config measured) |
| 8 | `unsloth/SmolLM3-3B-GGUF` | 3.1B | GGUF Q4_K_M | **1.83 GB** | ~3.5 GB | Open chat with dual think / no-think modes (matches our `<think>` streaming UX) | Apache-2.0 · ctx 64K (config measured) |
| 9 | `bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF` | 7.6B | GGUF Q4_K_M | **4.47 GB** | ~5.8 GB | Local reasoning-tier agent for heavy steps | MIT · ctx 128K (config measured) |
| 10 | `unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF` | 1.5B | GGUF Q4_K_M | **1.07 GB** | ~2.4 GB | Entry reasoning model; the in-browser DeepSeek space already proves the UX | Apache-2.0 · 128K (family spec) |
| 11 | `bartowski/Qwen_Qwen3.5-4B-GGUF` | ~4B | GGUF Q4_K_M | **2.87 GB** | ~4.4 GB | Newest Qwen generation (multimodal per pipeline tag) | Apache-2.0 · ctx 256K (official config measured) ⚠️ new family, GGUF by third party |
| 12 | `LiquidAI/LFM2.5-8B-A1B-GGUF` | 8.3B MoE / ~1.5B active | GGUF Q4_K_M | **4.92 GB** | ~6.4 GB | Agent-grade MoE: 8B quality with ~1.5B decode cost — ideal for multi-step runs | LFM Open License (other) ⚠️ check revenue cap · ctx 128K (config measured) |
| 13 | `LiquidAI/LFM2.5-2.6B-GGUF` | 2.6B | GGUF Q4_K_M | **1.60 GB** | ~2.9 GB | Edge chat/agent; vendor-official WebGPU space already in our gallery | LFM Open License (other) · ctx 128K (config measured) |
| 14 | `Qwen/Qwen2.5-Coder-7B-Instruct-AWQ` | 7.6B | AWQ Int4 (official) | **5.31 GB** (shard sum) | ~6.6 GB | Local coding model to pair with the `run_code` tool (vLLM) | Apache-2.0 · ctx 32K (config measured) |
| 15 | `unsloth/Qwen3-VL-4B-Instruct-GGUF` | 4B VL | GGUF Q4_K_M | **2.38 GB** (+~0.5 GB mmproj) | ~4.2 GB | Vision chat / screenshot-understanding / OCR agent step | Apache-2.0 · ctx 256K (config measured) |
| 16 | `Qwen/Qwen2.5-VL-3B-Instruct-AWQ` | 3.7B VL | AWQ Int4 (official) | **3.24 GB** | ~4.6 GB | Vision + tool-use; official AWQ for vLLM serving | Apache-2.0 (base repo) · ctx 128K (config measured) |
| 17 | `HuggingFaceTB/SmolVLM2-500M-Video-Instruct` | 500M | ONNX q8 decoder (348 MB) + fp16 vision encoder (375 MB) | **~0.72 GB** | ~1.3 GB | In-browser webcam/video agent (transformers.js) — direct `LOCAL_MODELS` candidate | Apache-2.0 · ctx 8K (config measured) |
| 18 | `onnx-community/whisper-small` | 244M | ONNX fp16 (decoder 294 MB + encoder ~170 MB) | **~0.5 GB** | ~1.0 GB | Local voice input for agents (better than the whisper-base already in our gallery) | Apache-2.0 · n/a |
| 19 | `onnx-community/Kokoro-82M-v1.0-ONNX` | 82M | ONNX fp16 (q4f16 147 MB, uint8f16 109 MB) | **0.16 GB** | ~0.4 GB | TTS voice output — completes a fully-local voice agent loop with #18 | Apache-2.0 · n/a |
| 20 | `onnx-community/embeddinggemma-300m-ONNX` | 300M | ONNX q4f16 (188 MB q8) | **0.17 GB** | ~0.5 GB | **Local RAG/memory embeddings**: 100+ languages, Matryoshka dims (768→512→256→128), SOTA-for-size | Gemma license · ctx 2K (spec) |

**Also worth knowing** (verified but cut for table budget): `onnx-community/gemma-4-E4B-it-ONNX` (in-browser multimodal, q4f16 decoder 1.98 GB + embed 1.92 GB ≈ 4 GB — the E-series MatFormer trick, Apache-2.0, ctx 128K measured); `onnx-community/moonshine-base-ONNX` (27M realtime ASR, q4f16 81 MB, MIT); `Xenova/all-MiniLM-L6-v2` (int8 22 MB / q4f16 29 MB — cheapest default embedding, Apache-2.0); `Xenova/bge-small-en-v1.5` (q8 32 MB, MIT); `onnx-community/Qwen3-Embedding-0.6B-ONNX` (q8 585 MB / q4 872 MB, Apache-2.0, ctx 32K measured — strongest local embedding if 0.5 GB is acceptable); `Qwen/Qwen3-Embedding-0.6B` (official bf16).

Sizing methodology: GGUF rows cite the Q4_K_M file (the standard quality/size sweet spot; most repos also ship IQ4_XS ~10% smaller and Q8_0 ~1.7× larger); AWQ rows cite the sum of `*.safetensors` shard files (⚠️ HF's `safetensors.total` **overstates** AWQ repos ~35–40% — e.g. Qwen3-8B-AWQ reports 7.81 GB but shards total 5.82 GB — trust file sums, not `total`); ONNX rows cite the named variant file(s). Context lengths were read from each repo's `config.json` (`max_position_embeddings`) where noted "measured".

---

## B. Agent-tooling / UX Spaces shortlist (10 verified alive)

Aliveness = HTTP 200 on `https://huggingface.co/api/spaces/<id>` **plus** runtime stage from the same API (2026-09-15). `RUNNING` = live now; `PAUSED` = repo alive (HTTP 200), app paused — still referenceable for code/README, wakes on visit/restart. None duplicate the 12 spaces in `hf-spaces.ts` (those are all WebGPU *inference* demos; these are agent *harness* demos).

| # | Space id (verified) | Org | What it demonstrates | UX / harness pattern worth adopting | Stage · likes · link |
|---|---------------------|-----|----------------------|--------------------------------------|----------------------|
| 1 | `smolagents/computer-agent` | Hugging Face (smolagents) | Official computer-use agent: takes screenshots, clicks/types, narrates each step | **Human-in-the-loop gating** — agent pauses for user approval before destructive actions; live screenshot trail + stop button | PAUSED · 984 · [link](https://huggingface.co/spaces/smolagents/computer-agent) |
| 2 | `m-ric/open_Deep-Research` | m-ric (HF) | Open reproduction of OpenAI Deep Research (smolagents + search) | **Visible plan → fan-out searches → cited markdown report**; report downloadable as .md — maps 1:1 onto our workflow runner + `runToMarkdown` | PAUSED · 672 · [link](https://huggingface.co/spaces/m-ric/open_Deep-Research) |
| 3 | `smolagents/hf-realtime-voice` | Hugging Face (smolagents) | Realtime voice agent over WebSocket/WebRTC | **Barge-in voice loop** (speak while agent talks); pairs perfectly with our local Whisper (#18) + Kokoro (#19) stack | RUNNING · 558 · [link](https://huggingface.co/spaces/smolagents/hf-realtime-voice) |
| 4 | `agent-memory-leaderboard/leaderboard` | community | Unified benchmark of agent-memory systems | **Memory eval criteria** — what to measure (retention, update, forgetting) when we wire embeddings into `memory.ts` | RUNNING · 769 · [link](https://huggingface.co/spaces/agent-memory-leaderboard/leaderboard) |
| 5 | `galileo-ai/agent-leaderboard` | galileo-ai | Ranks LLMs specifically on agentic/tool-calling tasks | **"Agent-grade" model tagging** — informs which local/cloud models we badge as reliable for multi-step runs | RUNNING · 453 · [link](https://huggingface.co/spaces/galileo-ai/agent-leaderboard) |
| 6 | `jupyter-agent/jupyter-agent` | jupyter-agent org | LLM writes and executes code in a **live Jupyter kernel** | **Persistent execution state** — variables survive between steps, streamed cells, plots/tables rendered as artifacts; the upgrade path for our per-call `node:vm` `run_code` | RUNNING · 317 · [link](https://huggingface.co/spaces/jupyter-agent/jupyter-agent) |
| 7 | `cfahlgren1/qwen-2.5-code-interpreter` | cfahlgren1 | Code-interpreter via E2B embedded in a *static* Space | **Zero-backend sandbox via iframe** — same org as our existing WebLLM playground space; a template for hosting run_code previews without a server | RUNNING · 147 · [link](https://huggingface.co/spaces/cfahlgren1/qwen-2.5-code-interpreter) |
| 8 | `Agents-MCP-Hackathon/gradio_workflowbuilder` | Agents-MCP-Hackathon | Gradio custom component: natural-language → **visual workflow graph** | **"Describe workflow → editable graph"** assistant — same shape as our workflow-editor-dialog; could add AI-import of a workflow from text | RUNNING · 68 · [link](https://huggingface.co/spaces/Agents-MCP-Hackathon/gradio_workflowbuilder) |
| 9 | `bstraehle/multi-agent-ai-autogen-coding` | bstraehle | Classic 3-agent AutoGen crew (writer → critic → editor) | **Minimal role-handoff trace** — the clearest tiny demo of sequential multi-agent handoffs, i.e. our linear workflow with roles | RUNNING · 32 · [link](https://huggingface.co/spaces/bstraehle/multi-agent-ai-autogen-coding) |
| 10 | `Agents-MCP-Hackathon/gradio_agent_inspector` | Agents-MCP-Hackathon | "Gradio component to help debug your agent" | **Step/tool-call I/O inspector widget** — expandable per-step trace with prompt/response/tool payloads; direct reference for our run panel | RUNNING · 6 · [link](https://huggingface.co/spaces/Agents-MCP-Hackathon/gradio_agent_inspector) |

**Checked but excluded (HTTP 200 yet `RUNTIME_ERROR` at check time — app broken despite likes):** `smolagents/smolagents-leaderboard` (142★), `freddyaboulton/gradio_agentchatbot` (33★), `thinkall/AutoGen_Playground` (22★), `langfuse/langfuse-template-space` (11★), `ysharma/crewai-multiagent-gradio-chatbot` (6★). **SLEEPING (alive, wakes on demand):** `Agents-MCP-Hackathon/gradio_consilium_roundtable` (10★, poker-style multi-agent roundtable component). Additional `RUNNING` honorable mentions: `lvwerra/jupyter-agent-2` (253★), `davidberenstein1957/smolagents-and-tools` (122★ tool-gallery), `Agents-MCP-Hackathon/multi-agent_deep-research` (28★).

---

## C. Top 5 concrete integrations (ranked, do-this-week)

| # | Integration | Effort | What exactly |
|---|-------------|--------|--------------|
| 1 | **Ollama / LM Studio quick-connect ("local GGUF bridge")** | **S** | Add `ollama` (+ `lmstudio`) presets to `src/lib/providers.ts` (baseUrl `http://localhost:11434/v1`, keyless, keyed-flag like Pollinations) and a "Local GGUF models" card in the provider gallery listing Section-A rows with copy-paste `ollama pull` commands (e.g. `qwen3:4b-instruct-2507-q4_K_M`). Users get zero-cloud agent runs on 8 GB GPUs through our existing custom/OpenAI-compatible engine — no app-side inference needed. |
| 2 | **Wire WebLLM into chat as a "Local" provider** | **M** | `resolveLlm()` gains a `local` branch using the existing engine wrapper in `local-models.tsx` → run the whole agent loop (tools included) on-device. Long-listed as next-phase idea since r14/r15; Section-A rows 5/10/13 are the natural default picks (Qwen2.5-0.5B, R1-Distill-1.5B, LFM2.5-2.6B). |
| 3 | **In-browser local RAG/memory embeddings** | **M** | Add `onnx-community/embeddinggemma-300m-ONNX` (167 MB q4f16) and `Xenova/all-MiniLM-L6-v2` (22 MB int8) as transformers.js `LOCAL_MODELS` rows + a `memory.ts` vector path: embed notes → cosine top-k into agent context, all localStorage-side. Use agent-memory-leaderboard criteria (retention/update/forgetting) as the acceptance checklist. |
| 4 | **Persistent `run_code` session (jupyter-agent pattern)** | **M** | Replace the per-call fresh `node:vm` context with a module-level persistent VM store keyed by conversation id (variables/files survive between steps), and render cell-style outputs (stdout / result / plots-as-text) in the run panel. This is the single biggest agent-capability upgrade visible in the jupyter-agent Spaces. |
| 5 | **Run-panel trace inspector + agent-grade badges (inspector/leaderboard pattern)** | **S** | (a) In `workflow-run-panel.tsx`, make each step expandable into a full tool-call I/O inspector (pretty-printed JSON args/results — the `gradio_agent_inspector` pattern). (b) Tag models in pickers with an "agent-grade" badge sourced from galileo-ai/agent-leaderboard findings (Qwen3-4B-2507, Phi-4-mini, LFM2.5-8B-A1B as local agent picks). |

---

## D. Method + sources + date

**Date:** 2026-09-15 (all API responses pulled this day).

**Toolchain (as requested, HF CLI first):**
1. `hf` CLI present in sandbox: `huggingface_hub 1.9.2` at `/home/z/.venv/bin/hf` (upgrade to 1.31.0 available, not required). Used `hf models ls --search/--author/--filter --sort downloads --expand ... --format json` and `hf spaces ls --search --sort likes --expand ...` for discovery — the CLI wraps exactly the REST endpoints below.
2. HF REST API via curl (`--max-time 15` per call) for everything the CLI search doesn't expose:
   - Model discovery: `/api/models?search=…|author=…&filter=text-generation|awq&sort=downloads|likes&limit=…` (searches run: gguf, qwen (author), google (author), microsoft (author), HuggingFaceTB (author), phi-4-mini, deepseek-r1-distill, bge-small, all-minilm, arctic-embed, mxbai-embed, sentence-transformers (author), onnx-community (author), LiquidAI (author), awq filter, whisper, kokoro, smollm).
   - Space discovery: `/api/spaces?search=…&sort=likes&limit=…` (searches: agent, multi-agent, smolagents, mcp, browser-use, code interpreter, agent trace, autogen, langfuse, openai-agents, deep research, tool calling, inspector, workflow builder, gradio agent, crewai, langgraph).
   - **Weight sizes (measured):** `/api/models/<id>?blobs=true` → sibling file `size` fields (GGUF: Q4_K_M/IQ4_XS/Q8_0 files; AWQ: shard sums; ONNX: named variant files).
   - **Context lengths:** `<repo>/resolve/main/config.json` → `max_position_embeddings` (marked "measured" in tables; "spec" = model-card value).
   - **Space aliveness:** `/api/spaces/<id>` → HTTP code + `runtime.stage` (RUNNING / PAUSED / SLEEPING / RUNTIME_ERROR) + likes + sdk. 20 candidate spaces probed; 0 were 404; 5 RUNTIME_ERROR excluded from the table (listed separately).
   - jq used for parsing; python3 + `huggingface_hub` confirmed installed (import OK).
3. **Cross-check against our own catalog:** pulled `mlc-ai/web-llm` main `src/config.ts` (raw.githubusercontent.com) and diffed all 21 `LOCAL_MODELS` ids in `webgpu.ts` against the 167 current prebuilt records.

**Sources:** huggingface.co REST API + model/space READMEs as listed above; mlc-ai/web-llm prebuilt config; all numbers in §A are Hub-API-measured unless marked "spec".

**Cross-check findings vs current `webgpu.ts` / `hf-spaces.ts` (no fatal contradictions; 3 data fixes suggested):**
1. **`webgpu.ts` Qwen2.5-0.5B q4f32 row understates VRAM**: catalog says `760 MB`, current MLC main config says **`1060.2 MB`** (the q4f16 row `945` is correct). Devices without shader-f16 get a slightly optimistic suggestion. Also minor: SmolLM2-360M q4f32 `560` → current config `579.61`; Llama-3.2-1B q4f32 `1188` → current config `1128.82` (ours overstates — safe direction). All other 18 rows match current config exactly (±0.5 MB).
2. **AWQ `safetensors.total` is not disk size**: for `Qwen3-8B-AWQ` the API `total` reads 7.81 GB while the actual shard files sum to **5.82 GB** (HF counts packed I32 as full bytes). If we ever show AWQ weights, compute from sibling files, not `total`. (Same pattern on Qwen2.5-Coder-7B-AWQ: total 7.26 GB vs shards 5.31 GB.)
3. **hf-spaces.ts SmolVLM-500M "500 MB" is space-specific** (mixed-precision payload of `SmolVLM-500M-Instruct`); the newer `SmolVLM2-500M-Video-Instruct` ONNX stack is ~723 MB quantized — still "tiny/small tier" but don't reuse the 500 number if we add SmolVLM2 rows. No contradiction on GPT-OSS-20b (unsloth GGUF exists; ~12 GB class confirmed) or on our Qwen3-8B WebLLM figure (5 696 MB MLC ≈ 5 816 MB AWQ disk — consistent).

**Reuse note:** everything in this file is additive; nothing in §A/§B duplicates entries already shipped in `hf-spaces.ts` (WebGPU inference spaces) or the WebLLM prebuilt list (row 5 GGUF/Llama-3.2-1B is the llama.cpp/Ollama counterpart of an existing WebLLM row — different consumption path, complementary).
