# Walkthrough: VyceAI, AgentRouter MPP Integration & Model Arena Quality Cockpit

We have completed the full suite of enhancements requested:
1. **DeepSeek V4.1 Apex Integration & Health**: VyceAI parameter adaptation (`max_tokens` -> `max_completion_tokens`) resolved, elevating DeepSeek V4.1 (Elo 0.985) as the #1 Apex Frontier model.
2. **Model Name Aliasing**: `ox-alpha` mapped and labeled cleanly as `GLM-5.3 Flash (Ox-Alpha AIHubMix)`.
3. **Pareto 2D Scatter Chart Bug Fix**: Fixed the x-axis tick collision (`50010002000ms`) in Model Arena (`nexus_os/monitoring/arena.html`) by introducing bounded plot scaling (3s-8s), non-overlapping tick intervals, and edge-pinned outlier indicators.
4. **AgentRouter MPP Provider Integration**: Registered AgentRouter gateway (`https://api.agentrouter.to/api/agentic-api`) with 100 credits balance, supporting DeepSeek MPP models (`deepseek-v4-flash`, `deepseek-v4-pro`), automatic `routeKey` injection, and standard OpenAI response unwrapping.

---

## 1. Key Accomplishments

### A. DeepSeek V4.1 & VyceAI Parameter Adaptation
- **Bug Diagnosed**: VyceAI rejects standard `max_tokens` with HTTP 500 (`"Unknown parameter: 'max_tokens'"`), but requires `max_completion_tokens`.
- **Engine Patch**: Updated `buildProviderRequestBody` in `services/modelrelay-nexus/node_modules/modelrelay/lib/server.js` and `ours-lib_server.js` to automatically translate `max_tokens` to `max_completion_tokens` for VyceAI endpoints.
- **Apex Status**: DeepSeek V4.1 is registered with Elo **0.985** in `config/arena_scores.snapshot.json` and `config/models.registry.json`.

### B. AgentRouter MPP Integration
- **Endpoint**: `https://api.agentrouter.to/api/agentic-api/domains/models/capabilities/chat-complete/execute`.
- **Payload Requirements**: Automatic injection of `routeKey` (`models.chat.complete.deepseek.mpp`) and `provider: "deepseek"` for target models `deepseek-v4-flash` and `deepseek-v4-pro`.
- **Response Unwrapping**: Standardized nested `{ success: true, data: { ... } }` into top-level OpenAI chat completion responses.
- **Rate Limit & Policy**: Configured 30 RPM / burst 5 in `rate_limit_manager.js` and added to `nexus-runtime-policy.js` allowlist.
- **Live Verification**: Direct completions return HTTP 200 OK with full assistant reasoning and content in ~5 seconds.

### C. Pareto 2D Scatter Plot X-Axis Fix (`nexus_os/monitoring/arena.html`)
- **Root Cause**: High-latency outliers (e.g. 15s cold starts) stretched the linear x-axis scale to 16,000ms+, compressing sub-2s ticks (`500ms`, `1000ms`, `2000ms`) into overlapping text collisions.
- **Solution**:
  - Implemented bounded scale: `plotMaxLat = Math.min(Math.max(maxObserved, 3000), 8000)`.
  - Outliers (>8s) are clamped and labeled with `[OUTLIER PINNED TO BOUNDARY]`.
  - Adaptive non-colliding tick steps (`500ms`, `1s`, `2s`, `4s`) maintain legibility at all resolutions.

### D. Model Aliasing: `ox-alpha` -> `GLM-5.3 Flash (Ox-Alpha AIHubMix)`
- Added canonical aliases in `config/arena_name_overrides.json`, `sources.js`, and `config/models.registry.json`.
- Catalog label updated to `GLM-5.3 Flash (Ox-Alpha AIHubMix)` with 1M context.

---

## 2. Verification Receipts

| Test Suite | Command | Result |
| :--- | :--- | :--- |
| **ModelRelay Unit Tests** | `npm test --prefix services/modelrelay-nexus` | **130/130 PASSED** |
| **Runtime Patch Verification** | `node services/modelrelay-nexus/src/verify-runtime.mjs` | **51/51 Markers OK (`"ok": true`)** |
| **Dashboard Arena Integrity** | `node tests/test_targeted_dashboard_arena_integrity.mjs` | **16/16 PASSED** |
| **Registry Drift Check** | `python scripts/gen_model_registry.py --check` | **In Sync (`code 0`)** |

---

## 3. Operator Service Reload (NEXUS-HR-004)

In accordance with `NEXUS-HR-004` (sessions are kill+verify+probe only; service launches are external only), please execute the following in an external PowerShell terminal to load the fresh code into the running daemons:

```powershell
# 1. Reload ModelRelay Primary (Port 7350)
pwsh -File scripts\restart_modelrelay_7350.ps1 -Force

# 2. Reload Dashboard / Model Arena (Port 7356)
pwsh -File scripts\restart_dashboard_7356.ps1
```
