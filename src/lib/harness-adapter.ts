/**
 * Harness-agnostic lane-adapter contract (P2 — TASKS.md HarnessRouter row, r580).
 * Spec: docs/specs/harness-adapter-spec.md. Roadmap lineage: docs/harness-adaptation-roadmap.md.
 *
 * A foreign harness speaks HarnessRequest; a LaneAdapter translates it into one
 * NEXUS lane capability and wraps the answer in a HarnessResponse. The contract
 * encodes six house doctrines so a foreign harness can never degrade the house:
 *
 *   R1 never-throw      — every failure is a HarnessResponse envelope, never an
 *                         exception crossing the boundary (route error-envelope doctrine).
 *   R2 provenance       — every response carries "harness-adapter:<harness>/<adapter>"
 *                         (the provenance-tag doctrine, cf. the engine's "[plugin:" stamp).
 *   R3 capability gate  — supports() decides; an unsupported capability is an error,
 *                         never a silent best-effort (registry drift-flag spirit).
 *   R4 no credentials   — adapters receive payloads ONLY, never vault/env access
 *                         (the redaction-choke doctrine: keys stay behind the wall).
 *   R5 payload cap      — unbounded bodies are rejected PAYLOAD_TOO_LARGE
 *                         (peer-blind 5000-cap / dial-cap lineage).
 *   R6 timeout budget   — the registry enforces the adapter-declared timeoutMs
 *                         (durable-step / never-blocks lineage).
 *
 * The registry (createHarnessRegistry) is the single choke point that enforces
 * R1/R2/R3/R5/R6 — an adapter author cannot forget them.
 *
 * Reference adapter shipped: createRetrievalAdapter — exposes the r579 hybrid
 * retrieval shim (BM25 × trigram-cosine, RRF-fused) as capability
 * "retrieval.hybrid", dial-free and fixture-tested (scripts/qa-harness-adapter.ts).
 */

import { HybridRetriever } from "./rrf-retrieval";

export interface HarnessRequest {
  /** Foreign harness id (e.g. "harnessrouter"). Namespaced provenance only. */
  harness: string;
  /** Target NEXUS lane ("relay" | "engine" | "utility" | "retrieval" | …). */
  lane: string;
  /** Capability inside the lane, e.g. "retrieval.hybrid". */
  capability: string;
  /** Adapter-defined payload. Subject to the adapter's payloadCap. */
  payload: unknown;
  /** Optional trace metadata (never credentials). */
  meta?: Record<string, string>;
}

export interface HarnessError {
  code: string;
  message: string;
}

export interface HarnessResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: HarnessError;
  lane: string;
  provenance: string;
}

/** What an adapter implementation returns — the registry completes the envelope. */
export interface AdapterResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: HarnessError;
}

export interface LaneAdapter {
  id: string;
  lanes: string[];
  capabilities: string[];
  /** Registry-enforced execution budget (R6). */
  timeoutMs: number;
  /** Registry-enforced payload ceiling (R5), in chars of stringified body. */
  payloadCap: number;
  supports(capability: string): boolean;
  execute(req: HarnessRequest): Promise<AdapterResult>;
}

export const DEFAULT_PAYLOAD_CAP = 20_000;
export const DEFAULT_TIMEOUT_MS = 5_000;

export function createLaneAdapter(
  spec: Pick<LaneAdapter, "id" | "lanes" | "capabilities" | "execute"> &
    Partial<Pick<LaneAdapter, "supports" | "timeoutMs" | "payloadCap">>,
): LaneAdapter {
  const caps = new Set(spec.capabilities);
  return {
    ...spec,
    timeoutMs: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    payloadCap: spec.payloadCap ?? DEFAULT_PAYLOAD_CAP,
    supports: spec.supports ?? ((capability: string) => caps.has(capability)),
  };
}

function payloadSize(payload: unknown): number {
  if (payload == null) return 0;
  if (typeof payload === "string") return payload.length;
  if (typeof payload === "object") {
    try {
      return JSON.stringify(payload).length;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }
  return String(payload).length;
}

export interface RegisteredAdapter {
  id: string;
  lanes: string[];
  capabilities: string[];
  timeoutMs: number;
  payloadCap: number;
}

export function createHarnessRegistry(adapters: LaneAdapter[]): {
  execute(req: HarnessRequest): Promise<HarnessResponse>;
  list(): RegisteredAdapter[];
} {
  return {
    async execute(req: HarnessRequest): Promise<HarnessResponse> {
      const harness = String(req.harness ?? "unknown").slice(0, 64);
      const lane = String(req.lane ?? "");
      const adapter = adapters.find((a) => a.lanes.includes(lane));
      if (!adapter) {
        // R1/R2 even for unroutable requests — provenance names the miss.
        return {
          ok: false,
          lane,
          provenance: `harness-adapter:${harness}/none`,
          error: { code: "ADAPTER_NOT_FOUND", message: `no adapter serves lane "${lane}"` },
        };
      }
      const provenance = `harness-adapter:${harness}/${adapter.id}`;
      if (!adapter.supports(String(req.capability ?? ""))) {
        return {
          ok: false,
          lane,
          provenance,
          error: {
            code: "CAPABILITY_UNSUPPORTED",
            message: `adapter "${adapter.id}" does not support capability "${String(req.capability ?? "")}" (supports: ${adapter.capabilities.join(", ")})`,
          },
        };
      }
      const size = payloadSize(req.payload);
      if (size > adapter.payloadCap) {
        return {
          ok: false,
          lane,
          provenance,
          error: { code: "PAYLOAD_TOO_LARGE", message: `payload ${size} chars > cap ${adapter.payloadCap}` },
        };
      }
      try {
        const result = await Promise.race([
          adapter.execute(req),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), adapter.timeoutMs)),
        ]);
        // Adapter-level failures are envelopes too (R1 end to end): an adapter
        // returning ok=false must surface as ok=false, never as ok:true with
        // result:undefined (the qa-harness-adapter INVALID_PAYLOAD catch).
        if (!result.ok) {
          return {
            ok: false,
            lane,
            provenance,
            error: result.error ?? { code: "ADAPTER_FAILURE", message: "adapter returned ok=false without an error" },
          };
        }
        return { ok: true, result: result.result, lane, provenance };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          lane,
          provenance,
          error: { code: message === "timeout" ? "TIMEOUT" : "ADAPTER_FAILURE", message },
        };
      }
    },
    list(): RegisteredAdapter[] {
      return adapters.map((a) => ({
        id: a.id,
        lanes: [...a.lanes],
        capabilities: [...a.capabilities],
        timeoutMs: a.timeoutMs,
        payloadCap: a.payloadCap,
      }));
    },
  };
}

// ─── Reference adapter: NEXUS hybrid retrieval as a served capability ────────

export interface RetrievalCorpusDoc {
  id: string;
  label?: string;
  text: string;
}

export interface HybridHit {
  id: string;
  bm25Rank: number | null;
  vecRank: number | null;
  rrfScore: number;
}

export interface RetrievalResult {
  query: string;
  corpus: number;
  hits: HybridHit[];
}

/** Wraps the r579 RRF shim so a foreign harness can rank a corpus it uploads
 * (or a house corpus it is granted) without knowing NEXUS internals. Dial-free. */
export function createRetrievalAdapter(corpus: RetrievalCorpusDoc[]): LaneAdapter {
  const retriever = new HybridRetriever(corpus.map((d) => ({ id: d.label ?? d.id, text: d.text })));
  return createLaneAdapter({
    id: "retrieval",
    lanes: ["retrieval"],
    capabilities: ["retrieval.hybrid"],
    execute: async (req) => {
      const p = (req.payload ?? {}) as { query?: unknown; topN?: unknown };
      const query = String(p.query ?? "").trim();
      if (!query) {
        return { ok: false, error: { code: "INVALID_PAYLOAD", message: "payload.query (non-empty string) required" } };
      }
      const topN = Math.min(10, Math.max(1, Number(p.topN ?? 5) || 5));
      return { ok: true, result: { query, corpus: retriever.size, hits: retriever.hybrid(query, topN) } };
    },
  });
}
