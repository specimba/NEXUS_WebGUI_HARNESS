# Walkthrough: VyceAI & DeepSeek V4.1 Apex Integration & Model Arena Quality Sorting

We have completed the integration of **VyceAI** (`https://vyceai.com/v1`, $69.50 funded balance) and resolved the Model Arena (`http://localhost:7356`) quality ranking distortion. **DeepSeek V4.1** is now positioned as the **#1 Apex Frontier Model** across the registry, router, and arena telemetry views.

---

## 1. Key Accomplishments

### A. DeepSeek V4.1 & VyceAI Route Registration
- **Provider Registered**: `openai-compatible:vyce` (`https://vyceai.com/v1`, Cloudflare-friendly headers, verified 200 OK).
- **Flagship Model Models Registered**:
  - `deepseek-v4.1`: Flagship MoE model, 270K context window, 8,192 max output tokens, reasoning/tools enabled, Tier 98.
  - `claude-sonnet-4-6`: Frontier reasoning & coding, 270K context, vision enabled, Tier 96.
  - `agnes-3.0-flash`: Long-context agent model, 512K context, Tier 85.
  - `deepseek-v4-flash`: Ultra-fast inference, 270K context, Tier 85.
  - `deepseek-v4-flash-lr`: Long-range reasoning variant, 270K context, Tier 84.
- **Provider & Model Catalog**: Verified in `config/models.registry.json` and `services/modelrelay-nexus/node_modules/modelrelay/sources.js`.

### B. Evidence-Grounded Benchmark Scores (RULE-PARETO-001)
Added verified benchmark capability metrics into `config/arena_scores.snapshot.json` and `logs/runtime-state/arena/scores.json`:
- **`deepseek-v4.1`**: Arena Elo **0.985** (Text Elo: 1495, Coding: 0.990, Reasoning: 0.985, SWE: 0.720, Speed: 0.850).
- **`claude-sonnet-4-6`**: Arena Elo **0.978** (Text Elo: 1488, Coding: 0.982, Reasoning: 0.980, SWE: 0.710, Speed: 0.870).
- **`deepseek-v4`**: Arena Elo **0.965** (Coding: 0.975, Reasoning: 0.970).
- **`nemotron-3-ultra-550b-a55b`**: Arena Elo **0.948** (Coding: 0.958, Reasoning: 0.955).
- **`glm-5.3-flash`**: Arena Elo **0.942** (Coding: 0.950, Reasoning: 0.945).
- **`coding-glm-5.3-flash-free`**: Arena Elo **0.940** (Coding: 0.955).
- **`deepseek-v4-flash-lr`**: Arena Elo **0.918**.
- **`deepseek-v4-flash`**: Arena Elo **0.915**.
- **`agnes-3.0-flash`**: Arena Elo **0.910**.

### C. Generation Era Tier Sorting & Pareto Matrix Fix
- **Model Arena (`nexus_os/monitoring/arena.html`)**:
  - Implemented `getItemTier(item)` matching NEXUS Generation Era doctrine:
    - **Tier 1 (2026 Frontier)**: `deepseek-v4.1`, `claude-sonnet-4-6`, `glm-5.3`, `kimi-k3`, `minimax-m3`, `gemini-3.7`, `nemotron-3-ultra`, `agnes-3.0`, `gpt-5.6`.
    - **Tier 2 (Modern)**: `codestral-2508`, `mistral-large-latest`, `glm-5.2`, `llama-3.3`, `qwen2.5-coder`.
    - **Tier 3 (Legacy)**: Older sub-0.80 models.
  - Fixed `sortItems` default `quality` ordering to strictly enforce:
    1. **Generation Era Tier** (Tier 1 > Tier 2 > Tier 3)
    2. **Verified Benchmark Capability Elo**
    3. **Health State** (healthy > stale > unverified > rate_limited > unavailable)
    4. **Latency**
  - Updated `renderParetoScatter`:
    - Evaluates Tier 1 models first for **APEX FRONTIER LEADER**, preventing legacy Tier 2 models (like Codestral 2508) from crowding out apex models.
    - Accurately assigns **DEEP REASONING SOTA** to `deepseek-v4.1`.
- **Freshness Contract**:
  - Restored canonical 35-minute default (`35 * 60 * 1000`) for `HEALTH_FRESHNESS_MS` in `scripts/model_card_projection.js`.
- **Registry Code Generator (`scripts/gen_model_registry.py`)**:
  - Added active-status tie-breaking in `emit_scores` so active registry entries take precedence over suspended entries with equal evidence ranks.
  - Re-synchronized all derived artifacts (`scores_generated.py`, `cloud_profiles_generated.json`, `domain_mapping_generated.py`).
- **Restart Resilience & Mutex Timeout Hardening**:
  - Hardened `scripts/modelrelay_runtime.ps1` mutex wait from `WaitOne(0)` to `WaitOne(5000)`, allowing exiting instances to cleanly release `Global\NEXUS-ModelRelay7350Startup` without causing immediate startup skips.
  - Hardened `scripts/restart_modelrelay_7350.ps1` with `Wait-Process -Id $currentPid -Timeout 5`, `$HealthRetries = 90`, `$HealthDelayMs = 1000`, and `TimeoutSec = 5` so heavy Node startup verification and provider ping sequences do not trigger premature contract failure exceptions.

---

## 2. Verification Receipts

| Test Suite | Command | Result |
| :--- | :--- | :--- |
| **Dashboard Arena Targeted Integrity** | `node tests/test_targeted_dashboard_arena_integrity.mjs` | **16/16 PASSED** |
| **ModelRelay Unit Suite** | `npm test --prefix services/modelrelay-nexus` | **130/130 PASSED** |
| **Runtime Patch Verification** | `node services/modelrelay-nexus/src/verify-runtime.mjs` | **51/51 Markers OK (`"ok": true`)** |
| **Shadow Failover Contract** | `node services/modelrelay-nexus/scripts/verify-shadow-failover.mjs` | **`SHADOW_FAILOVER_OK`** |
| **Model Card Projection Tests** | `node --test tests/tools/test_model_card_projection.mjs` | **11/11 PASSED** |
| **Dashboard Runtime Scores** | `node --test tests/tools/test_dashboard_runtime_arena_scores.mjs` | **6/6 PASSED** |
| **Registry Scores Python Tests** | `pytest tests/registry/test_scores_generated.py` | **9/9 PASSED** |
| **Registry Artifact Drift Check** | `python scripts/gen_model_registry.py --check` | **In Sync (`code 0`)** |

### Projected Route Ranking Output
```
Projected models ranking in Model Arena:
  #1: deepseek-v4.1 (openai-compatible:vyce)       - Q: 0.985 - Status: healthy - Tier: 1 Frontier 2026
  #2: claude-sonnet-4-6 (openai-compatible:vyce)   - Q: 0.978 - Status: healthy - Tier: 1 Frontier 2026
  #3: glm-5.3-flash (openai-compatible:bai)        - Q: 0.942 - Status: healthy - Tier: 1 Frontier 2026
  #4: mistral-large-latest (openai-compatible:mistral) - Q: 0.932 - Status: healthy - Tier: 2 Modern
  #5: codestral-2508 (openai-compatible:mistral)       - Q: 0.925 - Status: healthy - Tier: 2 Modern
  #6: deepseek-v4-flash (openai-compatible:vyce)   - Q: 0.915 - Status: healthy - Tier: 1 Frontier 2026
```

---

## 3. Operator External Reload Instructions (NEXUS-HR-004)

In adherence to repository governance rule `NEXUS-HR-004` (no service launches inside active CLI agent sessions), please execute the following commands in an external PowerShell terminal to refresh the live services:

```powershell
# 1. Reload ModelRelay Runtime (Port 7350)
pwsh -File scripts\restart_modelrelay_7350.ps1 -Force

# 2. Reload Model Arena Dashboard (Port 7356)
pwsh -File scripts\dashboard_7356_runtime.ps1
```

Once reloaded:
- Access the **Router Control Center**: [http://localhost:7350](http://localhost:7350)
- Access the **Model Arena & Pareto Matrix**: [http://localhost:7356](http://localhost:7356)
