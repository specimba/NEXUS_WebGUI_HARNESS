// ─── NEXUS WebGUI · Shared Types ─────────────────────────────────────────────

import type { CortexConfig } from "./cortex-edge";
import type { ConstraintBlock } from "./constraint-block";

export type View = "chat" | "agents" | "workflows" | "settings" | "radar";

/** Accent theme variants (remap the violet/fuchsia accent scale via CSS vars). */
export type UiThemeId = "nexus" | "matrix" | "fallout" | "cyber";

export type ToolId =
  | "web_search"
  | "read_url"
  | "deep_scrape"
  | "cortex_memory"
  | "sandbox_exec"
  | "run_code"
  | "current_time"
  | "arxiv_search"
  | "wikipedia_search"
  | "hacker_news_search"
  | "github_repo_read"
  | "package_info"
  | "market_rates"
  | "uuid_hash"
  | "image_generate"
  | "tts_speak";

/** r575: the closed builtin set, as data — plugin manifests validate their
 *  base-tool references against THIS list (TASK-103 slice 1: a pack declares
 *  preset tools over builtin executors; it never ships its own executor). */
export const BUILTIN_TOOL_IDS = [
  "web_search",
  "read_url",
  "deep_scrape",
  "cortex_memory",
  "sandbox_exec",
  "run_code",
  "current_time",
  "arxiv_search",
  "wikipedia_search",
  "hacker_news_search",
  "github_repo_read",
  "package_info",
  "market_rates",
  "uuid_hash",
  "image_generate",
  "tts_speak",
] as const satisfies readonly ToolId[];

/** r615: open-world widening (TASK-103 slice 2, second half). Pack tools get
 *  LLM-safe snake names at the manifest boundary (TOOL_NAME_RE in
 *  plugin-manifest.ts, builtin-collision checked there) — the type system
 *  cannot enumerate them, so persisted/contract surfaces carry AnyToolId
 *  while ToolId stays CLOSED where executors dispatch on it. */
export type AnyToolId = ToolId | (string & {});

export type AgentColor = "violet" | "emerald" | "amber" | "rose" | "cyan" | "fuchsia";

export type ProviderMode = "auto" | "custom";

export type Framework = "sequential" | "conversational";

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: AgentColor;
  role: string;
  description: string;
  instructions: string;
  /** r511 Praison-style L1 — one-sentence objective this worker optimizes for.
   *  Optional: pre-existing agents stay valid (undefined = derived from role). */
  goal?: string;
  /** r511 Praison-style L1 — persona grounding shown in crew rosters. */
  backstory?: string;
  model: string; // "auto" for built-in, or a model id for custom providers
  temperature: number; // 0 – 1.5
  maxIterations: number; // 1 – 10
  tools: AnyToolId[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: string;
  result?: string;
  ok?: boolean;
  ms?: number;
}

export type MessageStatus = "streaming" | "done" | "error" | "stopped";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentId?: string;
  agentName?: string;
  createdAt: number;
  toolCalls: ToolCallInfo[];
  reasoning?: string;
  status: MessageStatus;
  error?: string;
  /** Wall-clock duration of the agent turn (assistant messages only). */
  durationMs?: number;
  /** Model id used for this reply ("auto" for the built-in engine). */
  model?: string;
  /** Which transport served this reply — v12 chat lane attribution
   * ("browser-direct" = key stayed in the browser; "server" = app relay). */
  transport?: "browser-direct" | "server";
  /** Files/images attached by the user (content inlined for context). */
  attachments?: MessageAttachment[];
  /** True when this reply was posted proactively by a conversation heartbeat. */
  heartbeat?: boolean;
  /** r27 route receipt: which serving path produced this answer (arXiv:2605.01710). */
  receipt?: RouteReceipt;
}

/** A message typed while the agent was streaming — auto-sent when it settles. */
export interface QueuedMessage {
  convId: string;
  text: string;
  attachments: MessageAttachment[];
  queuedAt: number;
}

/** A user-attached file: text body inline, or an image stored as a data URL. */
export interface MessageAttachment {
  name: string;
  size: number;
  /** Text file body, or a base64 data URL when kind = "image". */
  content: string;
  /** Defaults to "text" for attachments stored before images existed. */
  kind?: "text" | "image";
  /** MIME type for image attachments (e.g. image/jpeg after downscaling). */
  mime?: string;
}

/** Hermes-style first-person memory pinned into the conversation context. */
export interface ConversationMemory {
  text: string;
  updatedAt: number;
  /** "auto" = consolidation pass, "manual" = user-edited. */
  source: "auto" | "manual";
  /** Assistant-message count at the last consolidation (drives the auto trigger). */
  atMessageCount?: number;
}

/** Proactive heartbeat — the agent wakes an idle watched chat on an interval. */
export interface ConversationHeartbeat {
  enabled: boolean;
  intervalMs: number;
  lastBeatAt?: number;
}

export interface Conversation {
  id: string;
  title: string;
  agentId?: string;
  workflowId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** Pinned conversations stay grouped at the top of the chat list. */
  pinned?: boolean;
  /** Folded first-person memory (auto-consolidated or hand-written). */
  memory?: ConversationMemory;
  /** Opt-in proactive wake-up loop for this conversation. */
  heartbeat?: ConversationHeartbeat;
  /**
   * r27 per-chat model override — "providerId::model" (e.g. "zai::glm-5.3-flash")
   * or "auto::builtin". Empty/missing = follow the global provider setting.
   * Local-only; travels with the conversation in localStorage.
   */
  modelOverride?: string;
}

/**
 * Route Receipt (arXiv:2605.01710, adapted — consumer/developer tier): a compact
 * runtime record of the serving path that produced ONE answer. Model cards
 * document design time; receipts document runtime. Zero telemetry: the receipt
 * is created from the run the user already made and stored only in localStorage.
 *
 * v0.2 (r26-3): receipt_id / request_id / served_at / safety / context /
 * tools_allowed added ON TOP of v0.1 — all optional so receipts persisted by
 * older builds stay parseable. The `schema` marker keeps its "route-receipt.v0.1"
 * value: the version is semantic on the wire and field additions are additive
 * (canonical v0.1 requires these ids — routereceipt.org/schemas/route-receipt).
 */
export interface RouteReceipt {
  /** Schema marker so future field additions stay parseable. */
  schema: "route-receipt.v0.1";
  /** Unique id of THIS receipt (UUIDv4 at emit time; canonical required field). */
  receipt_id?: string;
  /** Correlates the receipts of one user request across engines/hops. */
  request_id?: string;
  /** ISO timestamp of when the answer was served (canonical required field). */
  served_at?: string;
  /** Model the request asked for ("auto" for the built-in engine). */
  requested_model: string;
  /** Model that actually answered. */
  resolved_model: string;
  /** Human label of the answering lane ("Provider · model"). */
  resolved_label: string;
  /** "fixed" = the exact requested id served the request; else unknown. */
  model_identifier_type: "fixed" | "router" | "unknown";
  fallback: {
    status: "none" | "occurred";
    /** Coarse reason class (never internals) — capacity / rate_limit / provider_error / unknown. */
    reason?: "rate_limit" | "provider_error" | "capacity" | "policy" | "unknown";
    from?: string;
    to?: string;
  };
  /**
   * Safety interventions on THIS turn (canonical required field): tool-output
   * injection scrubbing, closed-world tool-call rejections. "pass" = nothing
   * intervened; "blocked" is reserved for hard refusals (none emitted today).
   */
  safety?: { status: "pass" | "intervened" | "blocked"; visible_action?: string };
  /** Context economy facts — input_truncated = model-facing content was clipped. */
  context?: { input_truncated?: boolean };
  /** Tool ids the agent was ALLOWED this turn (granted registry, not usage). */
  tools_allowed?: string[];
  /** Tool classes used with invocation counts ("no tools" is information too). */
  tools_used: { name: string; invocation_count: number }[];
  completion_status: "complete" | "stopped" | "error" | "unknown";
  /** Explicit redaction record — we redact nothing today; the field is structural. */
  redactions: [];
}

/**
 * Pipeline depth (r26): how much extra rigor the runner injects at run time.
 * - "quick"    → run exactly as authored (no injection)
 * - "standard" → + synthetic verification pass at the end (unless a review gate exists)
 * - "deep"     → + 2 extra deep-research passes after step 1, then verification
 * Missing (old workflows) reads as "standard".
 */
export type PipelineDepth = "quick" | "standard" | "deep";

export interface WorkflowStep {
  id: string;
  agentId: string;
  label: string;
  /**
   * r180 (user directive item (a)): explicit role identity. Labels like
   * "[Strategic Planner] …" used to masquerade as routing while the real
   * worker is `agentId` — the UI now parses those tags and flags tag-vs-worker
   * disagreements; this field is the honest home for the role going forward.
   */
  roleId?: string;
  instruction?: string;
  /** "review" steps audit the previous step's output and can force a rework. */
  kind?: StepKind;
  /**
   * r503 (owner directive): per-step lane pin — "providerId::model" (e.g.
   * "aihubmix::minimax-m3.1-flash") or "auto::builtin". Empty/missing = the
   * pipeline default lane, then the agent's own model, then the global
   * provider. Lets a pipeline spread its steps across providers instead of
   * funneling every dial into one saturated connection.
   */
  lane?: string;
  /**
   * r644 (paper adaptation slice 2, arXiv 2610.31421): opt-in looped-depth
   * semantics for generate steps — after a Decision gate FAIL, the TIED
   * rework block (byte-identical prompt, the looped invariant) re-runs up
   * to N passes (hard cap 3, the RegBench plateau), each pass RE-JUDGED by
   * the same free gate; exit on pass / consecutive-fail exhausted / cap.
   * Absent = legacy single-rework behavior, byte-identical. The opt-in
   * deliberately extends the default max-two-rework budget (paper thesis:
   * reuse-shaped iteration buys the plateau, not more).
   */
  loopedPasses?: number;
}

export type StepKind = "generate" | "review";

export interface WorkflowRunStep {
  stepId: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  label: string;
  /** r182: materialized from WorkflowStep.roleId so run rows can prefer the
   * explicit role signal over the parsed "[Tag]" label prefix. */
  roleId?: string;
  output: string;
  toolCalls: ToolCallInfo[];
  /** "pending" = materialized but not yet reached by the engine loop (r80:
   * honest queue state — was previously all-"running" from t0, which made
   * every future step lie "Running…" for many minutes on deep pipelines).
   * "skipped" (r183) = the run ended before reaching this step — it never
   * ran, and the row must not read as if the user stopped it mid-flight. */
  status: "pending" | "running" | "done" | "error" | "stopped" | "skipped";
  ms?: number;
  /** Mirrors the step definition kind (missing = "generate"). */
  kind?: StepKind;
  /**
   * r503: the lane pin this step materialized with ("providerId::model" or
   * "auto::builtin") — displayed as a chip on the run row so the lane spread
   * of a pipeline is visible in the run panel, not just in the editor.
   */
  lane?: string;
  /**
   * Per-run instruction for SYNTHETIC steps injected by depth materialization
   * (deep-research / verification passes have no authored WorkflowStep def, so
   * the runner reads the appended focus instruction from here instead).
   */
  instruction?: string;
  /** Effective tool set for synthetic passes (merged at materialization). */
  tools?: AnyToolId[];
  /**
   * r644 looped-depth runtime outcome: set when the step ran with
   * loopedPasses >= 2 — { k } tied passes delivered of { r } planned,
   * exit { reason }; drives the "↻ looped k/r · label" chip on the run row —
   * r658: outcome-TONED via src/lib/looped-outcome.ts (pass-verdict emerald
   * converged, quality refusals amber, judge-down muted; unknown honest).
   */
  looped?: { k: number; r: number; reason: string };
  /** r644: the looped-depth opt-in materialized from WorkflowStep (absent = legacy). */
  loopedPasses?: number;
  /** Review-gate outcome for kind = "review" steps. */
  verdict?: "pass" | "rework";
  /** True when this generate step was redone after a review rework. */
  reworked?: boolean;
  /**
   * r29: the step ended on a tool-budget sentinel + auto-digest instead of a
   * synthesized answer — surfaces as an "auto-digest" chip so users (and
   * downstream instructions) know the material is degraded.
   */
  degraded?: boolean;
  /**
   * r128: epoch-ms until which this step is deliberately WAITING (provider
   * backoff / quota cooldown) instead of dialing. Set by the runner's
   * self-heal ladder, cleared when the retry dials. Powers the live
   * "⏳ backoff Ns" chip in the run panel — waits were toast-only and
   * invisible in the step row before.
   */
  backoffUntil?: number;
  /** Why the step is waiting — drives the chip's copy. */
  backoffKind?: "backoff" | "cooldown";
}

/** Classified cause of a failed run — drives the recovery card's copy. */
export type RunErrorKind = "network" | "auth" | "rate-limit" | "billing" | "timeout" | "model" | "region" | "unknown";

/**
 * Everything the user needs to understand WHY a run failed and what their
 * options are. Surfaced by the recovery card in the run panel (non-silent
 * fallback — the user decides: retry, resume, restart or export).
 */
export interface RunErrorInfo {
  /** Index of the step that failed (0-based, into run.steps). */
  stepIndex: number;
  stepId: string;
  stepLabel: string;
  agentName: string;
  /** Raw error message from the engine. */
  message: string;
  kind: RunErrorKind;
  /** Actionable next-step copy for this kind of failure. */
  hint: string;
  /** Tool calls that succeeded inside the failed step before it died. */
  toolCallsOk: number;
  /** Steps that fully completed before the failure. */
  stepsDone: number;
  /** LLM engine label that was active for the failed step. */
  llmLabel: string;
  /** Recovery attempts so far on this run (1 = first failure). */
  attempts: number;
  /** True when the runner already retried this step once automatically before surfacing. */
  autoRetried?: boolean;
}

/**
 * One LLM call attempt inside a run — harness rank-② "logging triad" first
 * slice: every engine call is recorded with engine/model/duration/outcome so
 * run diagnostics show exactly WHERE a pipeline died and what a retry fixed.
 */
export interface RunCallLogEntry {
  at: number;
  stepId?: string;
  stepLabel?: string;
  agentName?: string;
  engine: string;
  model?: string;
  ms: number;
  ok: boolean;
  error?: string;
  /** 1-based attempt number for this step call (auto-retries increment it). */
  attempt?: number;
  /** Relay rotation trace, e.g. "Model relay: Vyce · x failed → rotating to y". */
  note?: string;
  /**
   * r656: structured lane family, writer-stamped from res.transport — the
   * O1 evidence as data. The run surface (lane-health chips) reads this
   * instead of parsing the note's prose prefix; the prefix remains only as
   * laneOfEntry's back-compat fallback for pre-r656 rows. Absent when the
   * transport is neither browser-direct nor server — never guessed.
   */
  lane?: "server-relay" | "browser-direct";
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  task: string;
  /** r183 (directive item b): "partial" = ended early by user intent with
   * completed steps preserved (zero-progress stops stay "stopped");
   * "blocked" = parked by an external condition (gateway saturation /
   * network, r178 park ladder) — not a failure of the pipeline itself, and
   * it auto-resumes. Both keep run.error populated, so the recovery card
   * and the r171 breaker streak still see them. */
  status: "running" | "done" | "error" | "stopped" | "partial" | "blocked";
  startedAt: number;
  finishedAt?: number;
  steps: WorkflowRunStep[];
  /** r186: the depth this run ACTUALLY materialized with. Stamped by the
   * runner so a degraded fire (deep workflow, failStreak ≥ 2, scheduled —
   * r185/r186) is visible in the run row itself, not only in the audit
   * trail. Absent on pre-r186 runs — panels fall back to the workflow's
   * authored depth. */
  depth?: PipelineDepth;
  /**
   * r197 (directive d): what launched this run — the scheduler's recurring
   * tick ("scheduled") or a human click ("manual"). Event provenance: the
   * board's schedule-evidence chip cites real scheduled events instead of
   * the badge's promise. Absent on pre-r197 runs — the chip falls back to
   * schedule.lastRunAt for age-only evidence.
   */
  source?: "manual" | "scheduled";
  /** Populated when status = "error" or "blocked" — powers the recovery card. */
  error?: RunErrorInfo;
  /** How many times this run was resumed after a failure/stop. */
  resumeCount?: number;
  /**
   * r158: how many rate-limit parks this run used (separate budget from
   * resumeCount — stalls and manual resumes spend that one; parks spend this).
   */
  parkCount?: number;
  /**
   * r178: how many network/timeout parks this run used — its own budget,
   * separate from parkCount (quota parks), so a flaky-gateway deep run can
   * plausibly need both. 2m → 4m → 8m waits (see src/lib/park-policy.ts).
   */
  netParkCount?: number;
  /**
   * r654: honest run-level degradation — N SYNTHETIC deep passes were skipped
   * after transient-class failures (rate-limit / network / timeout) and the
   * run CONTINUED without them instead of dying. Structured, not prose: chips
   * and QA count it without parsing. Absent when every materialized deep pass
   * ran (or none exist) — no phantom field, visible zero not attributed.
   */
  degradedDeep?: { skipped: number; kinds: string[] };
  /** Chronological log of LLM calls made during this run (capped, oldest-dropped). */
  callLog?: RunCallLogEntry[];
  /** Evolution Layer (r68): novelty % vs this workflow's recent done runs (0-100; <35 = stall). */
  novelty?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  runs: WorkflowRun[];
  createdAt: number;
  updatedAt: number;
  /** r511 Tryable-experiment clone — one research cycle pinned to a fresh
   *  radar lane, compared in the Evolution ledger against its source. */
  experiment?: {
    sourceWorkflowId: string;
    lane: string;
    startedAt: number;
    label: string;
  };

  /** Pipeline depth (r26) — missing = "standard" for pre-existing workflows. */
  depth?: PipelineDepth;
  /**
   * r503 (owner directive): pipeline DEFAULT lane — "providerId::model" or
   * "auto::builtin". Every step dials it unless the step carries its own
   * `lane` pin. Missing = each step follows its agent's model + the global
   * provider (pre-r503 behavior, untouched).
   */
  lane?: string;
  /** Recurring in-app schedule (runs fire while the app tab is open). */
  schedule?: WorkflowSchedule;
  /**
   * r203: structured lineage for workflows spawned from an Evolution
   * proposal. Stamped at accept-time so the card's lineage chip keeps
   * citing the router's decision reason (r199) after the inbox row is
   * gone — claim (this workflow exists) stays linkable to its source
   * (why the router proposed it, with numbers). Absent on manually
   * authored workflows and pre-r203 spawns.
   */
  evolution?: {
    proposalId: string;
    sourceWorkflowId: string;
    sourceWorkflowName: string;
    reason: string;
    acceptedAt: number;
  };
}

/** Interval-based schedule for a workflow. Missed runs (app closed) are skipped. */
export interface WorkflowSchedule {
  enabled: boolean;
  intervalMs: number;
  /**
   * r29 autonomy: consecutive scheduled-run failures (reset on success).
   * 1-2 → quick backoff re-arm; ≥3 → breaker auto-pauses the schedule.
   */
  failStreak?: number;
  /**
   * r171 congestion auto-resume: epoch ms when a rate-limit-tripped breaker
   * re-arms itself. Set alongside enabled:false by the runner; the scheduler
   * clears it and re-enables when it elapses. Absent = a real (manual/breakage)
   * pause that stays off until the user resumes.
   */
  autoResumeAt?: number;
  /** r171: how many consecutive congestion trips have auto-resumed (cap → honest manual pause). Reset on success. */
  autoResumeTrips?: number;
  /** Task text used for each scheduled run (falls back to the description). */
  task: string;
  lastRunAt?: number;
  nextRunAt?: number;
}

/**
 * Evolution Layer: a pipeline-born suggestion for a NEW workflow (spawn
 * proposal). Surfaced in the Evolution Inbox; accepting it spawns a real
 * pipeline (Research→Draft scaffold + review gate), dismissing archives it.
 */
export interface SpawnProposal {
  /** r581 nexent constraint block — hard bounds the editor validates before
   *  spawning (stepCap/toolBudget/laneCaps/dialPolicy). Optional: proposals
   *  from before r581 (and rejections) carry none. */
  constraints?: ConstraintBlock;
  id: string;
  createdAt: number;
  status: "open" | "accepted" | "dismissed";
  /** One-line goal for the proposed pipeline (also becomes its name). */
  goal: string;
  /** Optional extra step lines (bullets/numbering stripped on accept). */
  planLines?: string[];
  // NOTE: the Constraints plan line (see buildVariationProposal) is prose —
  // the structured bounds live in `constraints` above.
  /** Why this was proposed — shown verbatim in the inbox row. */
  reason: string;
  /** r511 — set when a judged Frontier Scout item inspired the variation,
   *  so the inbox can show the source paper/repo beside the proposal. */
  frontierRef?: { title: string; url: string; kind: "paper" | "repo" | "model" };
  sourceWorkflowId: string;
  sourceWorkflowName: string;
  sourceRunId?: string;
  /** Set on accept: the id of the pipeline this proposal spawned. */
  spawnedWorkflowId?: string;
}

/** A user-saved API key + preferences for one registry provider (BYOK vault). */
export interface ProviderKeyEntry {
  key: string;
  /** Preferred model id for this provider (defaults to the registry's first). */
  model?: string;
  /** Cloudflare Workers AI needs the account id inside the endpoint URL. */
  accountId?: string;
  /** Last successful validation (ms epoch) — drives the "connected" dot. */
  validatedAt?: number;
}

export interface Settings {
  provider: ProviderMode; // auto = built-in SDK, custom = BYOK OpenAI-compatible
  apiKey: string;
  baseUrl: string;
  defaultModel: string; // used for custom provider
  temperature: number;
  framework: Framework;
  displayName: string;
  /** Voice id used by read-aloud (see TTS_VOICES). Missing = default. */
  voice?: string;
  /** Read-aloud playback rate (0.75 – 2). Missing = 1. */
  speechRate?: number;
  /** Accent theme (nexus violet / matrix green / fallout amber / cyber magenta). */
  uiTheme?: UiThemeId;
  /** Per-provider key vault (id → entry). Local-only, never leaves the browser. */
  providerKeys?: Record<string, ProviderKeyEntry>;
  /** r483: provider ids whose PRESEED key the user explicitly removed — the settings-store merge must never re-seed them. */
  clearedPreseedProviderIds?: string[];
  /** Which LLM source is active when provider = "custom": a registry id or "custom" (legacy endpoint). */
  activeProviderId?: string;
  /** Model Relay — automatic fallback rotation when the active model fails. Default true. */
  relayEnabled?: boolean;
  /** r108/v19 lane preference — workflow resumes/retries dial through the server relay by default. Default false (direct lane). */
  preferRelay?: boolean;
  /** Saved hop ordering (keys "providerId::model"); missing = recommended Generation-Era order. */
  relayOrder?: string[];
  /**
   * r504: failover ordering policy for the relay chain.
   *  - "smart" (default): Generation-Era tiers preserved, FREE lanes preferred
   *    within a tier — wallet-protected continuation during a provider outage.
   *  - "quality": classic tier → Elo order (free/paid not a factor).
   *  - "free": free frontiers across tiers — maximal cost protection.
   * The provider circuit breaker (nexus-relay-provider-breaker) sits ABOVE the
   * policy in every mode: 3 consecutive hard lane-fails dock a provider's
   * lanes until the quarantine lapses or a lane answers.
   */
  relayFailoverPolicy?: "smart" | "quality" | "free";
  /**
   * r516: per-step Decision Gates in workflow runs — after every regular
   * generate step, the free System-One ladder (Intern Decision-4B → fast
   * judge, never paid Jev by default) reviews the output against the step's
   * assignment. Confident PASS: accepted with a witness line. Confident FAIL:
   * ONE bounded free rework pass. Uncertain / no judge: accept unchanged
   * (the gate never blocks). Default ON; false = outputs accepted as before.
   */
  decisionGates?: boolean;
  /** r578: second, deliberately blind peer scorer on the free decision quota. */
  peerBlindScore?: boolean;
  /**
   * r506: utility fast-lane routing — the AI utility buttons (plan generation,
   * auto-assign, memory consolidation) dial a FAST above-moderate lane
   * (free-first) with an emergent substitution ladder and a 30s first-token
   * budget, instead of the global primary (often the largest reasoning model).
   * Default ON; false = utility buttons dial the global primary + standard
   * decision-fit ladder.
   */
  utilityFastLane?: boolean;
  /**
   * r503: radar→relay adoption pipeline — brand-new FREE lanes the tracker
   * sees (first seen) auto-join the relay chain with their provider tags.
   * Default ON (that is the point); false = manual Adopt actions only.
   */
  radarAutoAdopt?: boolean;
  /**
   * r27 System-One (Jev, typesafe.ai) API key for the decision tier —
   * classification / judging / routing at ~$0.042/Mtok. Optional: without it
   * the decision ladder falls back to a fast-model JSON judge via the vault.
   */
  typesafeKey?: string;
  /**
   * 2-a Cortex Edge — the server-side deep-web lane for agents (Hyperbrowser
   * at a Supabase Edge Function). url = the deployed edge-function URL (empty
   * = lane off); key = the x-nexus-cortex-key shared secret (the
   * CORTEX_SHARED_SECRET set in Supabase → Edge Functions → Secrets — NOT an
   * SSL/GPG key); hbKey = optional per-request Hyperbrowser key (BYOK
   * override used when HYPERBROWSER_API_KEY is not set as an edge secret).
   * BYOK doctrine: these live in browser localStorage and are forwarded PER
   * REQUEST only — the server never persists them.
   */
  cortex?: CortexConfig;
  /**
   * Evolution Layer: novelty % below which a finished run counts as a
   * near-duplicate and triggers a spawn proposal. 10–90; missing = 35
   * (NOVELTY_SPAWN_THRESHOLD). Surfaced in Settings → Evolution.
   */
  noveltySpawnThreshold?: number;
  seeded: boolean;
}

// ─── SSE event protocol emitted by /api/chat ────────────────────────────────

// ─── Workflow run comparison ─────────────────────────────────────────────────

export interface RunStepDelta {
  stepIndex: number;
  label: string;
  aAgent: string;
  bAgent: string;
  aStatus: WorkflowRunStep["status"] | "missing";
  bStatus: WorkflowRunStep["status"] | "missing";
  aMs?: number;
  bMs?: number;
  aOutputLen: number;
  bOutputLen: number;
  aToolCalls: number;
  bToolCalls: number;
  sameAgent: boolean;
}

export interface RunComparison {
  a: WorkflowRun;
  b: WorkflowRun;
  sameTask: boolean;
  totalAms?: number;
  totalBms?: number;
  /** Negative = B faster. */
  totalDeltaMs?: number;
  aDone: number;
  bDone: number;
  rows: RunStepDelta[];
}

export type ChatStreamEvent =
  | { type: "start" }
  | { type: "status"; message: string }
  | { type: "iteration"; n: number }
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; args: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; ms: number; content: string }
  | { type: "done"; content: string; toolCalls: ToolCallInfo[]; iterations: number }
  | { type: "error"; message: string };

// r479 RESTORE (lost in the r449 .git rollback; consumer: src/lib/suite-schedule.ts sanitizer;
// definition verbatim from the r40-era commit 415d248f2 — the last word on this type in history).
/** r37: interval-based bake-off schedule for a suite (app-open runners). */
export interface SuiteSchedule {
  enabled: boolean;
  /** Fire interval in ms (clamped to SUITE_SCHEDULE_MIN_MS — quota discipline). */
  intervalMs: number;
  /** Repeats per case for scheduled runs (1..SUITE_REPEATS_MAX). */
  repeats: number;
  /**
   * r39 auto-adoption: when a SCHEDULED round crowns a case winner, apply it
   * as the case workflow's default harness without asking. Opt-in — manual
   * board runs never auto-adopt (you clicked run, you keep control).
   */
  autoAdopt?: boolean;
  /**
   * Consecutive scheduled rounds with an overall done-rate of 0 (reset on any
   * completed case). ≥3 → the breaker auto-pauses the schedule (enabled=false).
   */
  failStreak?: number;
  /**
   * r40 sticky-adoption guard: each case workflow's winner from the PREVIOUS
   * scheduled round. A round's verdict only auto-applies when it AGREES with
   * the previous round's (2 consecutive agreeing rounds) — a single flipped
   * verdict is noise and is held, so one bad round can't flip a pipeline.
   */
  lastWinners?: Record<string, string>;
  lastRunAt?: number;
  nextRunAt?: number;
}
