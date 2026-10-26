# Harness-Agnostic Lane-Adapter Spec

**Task ID:** TASKS.md P2 "Harness-agnostic lane-adapter spec" row (HarnessRouter 3,290★) · **Shipped:** r580
**Lineage:** `docs/harness-adaptation-roadmap.md` (phase-5 research-only) → this is its first engineering step.
**Reference implementation:** `src/lib/harness-adapter.ts` · **Fixture evidence:** `scripts/qa-harness-adapter.ts`

---

## 1. Problem

NEXUS's lanes (relay, engine, utility, retrieval, …) are reachable only through NEXUS's own
surfaces (UI views, internal routes). A foreign harness — e.g. HarnessRouter, or any external
agent loop — that wants to *serve itself from* a NEXUS lane currently has no contract to code
against. Without one, every integration becomes bespoke glue that bypasses the house doctrines
(provenance, redaction, caps, budgets).

## 2. The contract

A **harness** sends a `HarnessRequest`; a **lane adapter** translates it to one lane capability
and returns a `HarnessResponse`. Six rules, each mirroring an existing house doctrine:

| # | Rule | Lineage |
|---|------|---------|
| R1 | **Never-throw** — every failure is a `{ok:false, error:{code,message}}` envelope, including adapter-level `ok:false` returns; no exception crosses the boundary | route error-envelope pattern |
| R2 | **Provenance** — every response carries `harness-adapter:<harness>/<adapterId>`; unroutable requests get `…/none` | the engine's `[plugin:` provenance stamp |
| R3 | **Capability gate** — `supports()` decides; unsupported capability → `CAPABILITY_UNSUPPORTED`, never silent best-effort | registry drift-flag spirit (r577) |
| R4 | **No credentials** — adapters receive payloads only; no vault/env access in the contract | redaction-choke doctrine (r524) |
| R5 | **Payload cap** — bodies above the adapter's `payloadCap` → `PAYLOAD_TOO_LARGE` | peer-blind 5000-cap / dial caps |
| R6 | **Timeout budget** — registry enforces the adapter's `timeoutMs` → `TIMEOUT` | durable-step never-blocks lineage |

R1/R2/R3/R5/R6 are enforced by the **registry** (`createHarnessRegistry`) — the single choke
point. An adapter author cannot forget them; they can only supply the capability itself.

## 3. Interfaces (verbatim from the module)

```ts
interface HarnessRequest  { harness: string; lane: string; capability: string; payload: unknown; meta?: Record<string,string> }
interface HarnessResponse { ok: boolean; result?: unknown; error?: { code: string; message: string }; lane: string; provenance: string }
interface LaneAdapter     { id; lanes[]; capabilities[]; timeoutMs; payloadCap; supports(cap); execute(req): Promise<AdapterResult> }
```

Error-code vocabulary (closed set unless an adapter declares its own, which must be
`SCREAMING_SNAKE`): `ADAPTER_NOT_FOUND` · `CAPABILITY_UNSUPPORTED` · `PAYLOAD_TOO_LARGE` ·
`TIMEOUT` · `ADAPTER_FAILURE` · adapter-local codes like `INVALID_PAYLOAD`.

## 4. Reference adapter (shipped, fixture-tested)

`createRetrievalAdapter(corpus)` — serves capability **`retrieval.hybrid`** on lane
**`retrieval`**: payload `{ query, topN? }` → `{ query, corpus, hits: [{ id, bm25Rank,
vecRank, rrfScore }] }`, backed by the r579 RRF shim (`src/lib/rrf-retrieval.ts`).
Dial-free; the fixture test walks all error codes plus happy path and determinism.
Fixture-caught bug (kept on the record): the registry initially wrapped adapter-level
`ok:false` as `ok:true` with `result:undefined` — the INVALID_PAYLOAD fixture caught it and
the registry now propagates adapter envelopes verbatim (R1 end to end).

## 5. Onboarding a foreign harness (the recipe)

1. Pick the lane capability to expose; confirm it is pure/isomorphic or explicitly
   server-side WITH its own credential handling (R4 — the adapter never touches vault).
2. `createLaneAdapter({ id, lanes, capabilities, payloadCap?, timeoutMs?, execute })`.
3. Register it in `createHarnessRegistry([...])`.
4. Extend the fixture script with the new capability's happy path + one error path.
5. Only then consider an HTTP surface (below).

## 6. Non-goals / boundaries

- **No HTTP route yet** — exposing the registry over a route needs a CSRF gate + an auth
  decision (foreign harnesses are untrusted by default). That is the NEXT slice and needs an
  Owner nod; this spec deliberately stops at the in-process contract.
- **No credential path** — an adapter that needs a keyed lane (relay/engine dials) must not
  be registered until R4's enforcement point (a keys-never-cross test) exists for it.
- **No auto-discovery** — `list()` is opt-in introspection, not a capability advertisement
  broadcast.

## 7. Acceptance (witnessed)

- Spec doc: this file.
- Reference adapter passing a fixture test: `bun scripts/qa-harness-adapter.ts` → ALL PASS
  (12 checks: contract shape, provenance, lane echo, capability works, determinism,
  CAPABILITY_UNSUPPORTED, provenance-on-errors, ADAPTER_NOT_FOUND, PAYLOAD_TOO_LARGE,
  ADAPTER_FAILURE, TIMEOUT, INVALID_PAYLOAD, list()).
