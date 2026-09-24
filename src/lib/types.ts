// ─── PraisonAI Web · Shared Types ────────────────────────────────────────────

export type View = "chat" | "agents" | "workflows" | "settings" | "radar";

/** Accent theme variants (remap the violet/fuchsia accent scale via CSS vars). */
export type UiThemeId = "nexus" | "matrix" | "fallout" | "cyber";

export type ToolId =
  | "web_search"
  | "read_url"
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
  | "tts_speak"
  | "deep_scrape";

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
  model: string; // "auto" for built-in, or a model id for custom providers
  temperature: number; // 0 – 1.5
  maxIterations: number; // 1 – 10
  tools: ToolId[];
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
  /** Files/images attached by the user (content inlined for context). */
  attachments?: MessageAttachment[];
  /** True when this reply was posted proactively by a conversation heartbeat. */
  heartbeat?: boolean;
  /** r27 route receipt: which serving path produced this answer (arXiv:2605.01710). */
  receipt?: RouteReceipt;
  /** r34 gateway-router receipt (AIHubMix LLM Router headers) — which model
   *  the gateway's auto policy actually picked for this reply. */
  router?: RouterReceipt;
}

/**
 * r34: what an LLM gateway's request-level router decided, taken from its
 * response headers (AIHubMix `x-aihubmix-router-*`). Honest traceability: the
 * chip always shows the REAL resolved model, never the "auto" alias.
 */
export interface RouterReceipt {
  /** The model that actually answered (e.g. "xiaomi-mimo-v2.6-pro"). */
  resolved: string;
  /** Routing policy applied (e.g. "quality_first"). */
  policy?: string;
  /** Short human decision summary from the gateway. */
  reason?: string;
  /** True when the gateway reused the session's previous model. */
  sticky?: boolean;
  at: number;
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
  instruction?: string;
  /** "review" steps audit the previous step's output and can force a rework. */
  kind?: StepKind;
  /**
   * r35 GEPA-inspired prompt evolution: instruction variants for this step
   * with empirical win rates. The runner picks pinned → best-scoring →
   * authored; rework/failure outcomes evolve new variants automatically.
   */
  promptVariants?: PromptVariant[];
  /** Explicitly pinned variant (beats score-based selection). */
  pinnedVariantId?: string;
  /**
   * r35 reasoning-effort for this step, forwarded to OpenAI-compatible
   * custom lanes as `reasoning_effort` (the built-in lane ignores it).
   * Missing = provider default.
   */
  reasoningEffort?: ReasoningEffort;
}

export type StepKind = "generate" | "review";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * r35 prompt-evolution variant (GEPA doctrine, local-first): one concrete
 * instruction candidate for a step plus its empirical record. Wins = the
 * step finished without a rework verdict; reworks/fails count against it.
 */
export interface PromptVariant {
  id: string;
  instruction: string;
  /** "authored" = the user's original text · "evolved" = generated from feedback. */
  origin: "authored" | "evolved";
  /** For evolved variants: what changed and why (≤160 chars, shown in the editor). */
  note?: string;
  runs: number;
  wins: number;
  reworks: number;
  fails: number;
  createdAt: number;
  /** Run/review feedback that produced this variant (evolved only). */
  from?: string;
}

export interface WorkflowRunStep {
  stepId: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  label: string;
  output: string;
  toolCalls: ToolCallInfo[];
  status: "running" | "done" | "error" | "stopped";
  ms?: number;
  /** Mirrors the step definition kind (missing = "generate"). */
  kind?: StepKind;
  /**
   * Per-run instruction for SYNTHETIC steps injected by depth materialization
   * (deep-research / verification passes have no authored WorkflowStep def, so
   * the runner reads the appended focus instruction from here instead).
   */
  instruction?: string;
  /** Effective tool set for synthetic passes (merged at materialization). */
  tools?: ToolId[];
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
   * r31 harness rank-②: per-iteration trace recorded at each engine loop
   * boundary (see LlmCallTrace). Absent on pre-r31 runs and synthetic
   * gate-skips.
   */
  llmCalls?: LlmCallTrace[];
  /** r35: prompt variant used for this step (outcome attribution). */
  variantId?: string;
  /** r35: reasoning effort requested for this step (mirrors the definition). */
  reasoningEffort?: ReasoningEffort;
}

/** Classified cause of a failed run — drives the recovery card's copy. */
export type RunErrorKind =
  | "network"
  | "auth"
  | "rate-limit"
  | "timeout"
  | "model"
  | "region"
  /** r43: the provider account is out of credits (HTTP 402) — actionable: top up or let the relay step over. */
  | "credits"
  | "unknown";

/**
 * Reflexion lesson (harness rank-③): a ≤300-char verbal lesson written back
 * from a failed run (or a rework verdict) into the workflow's living memory,
 * injected into the context of the next run / resume so failed episodes stop
 * being wasted. Visible + deletable in the editor — a model-written doc the
 * user can't inspect would erode trust.
 */
export interface RunLesson {
  text: string;
  at: number;
  /** Run that produced it (if any) — links to the recovery card. */
  runId?: string;
  /**
   * Classified failure kind, "rework" when a review gate wrote it, or
   * "dream" when the background consolidation pass distilled it (r33).
   */
  kind: RunErrorKind | "rework" | "dream";
}

/**
 * r33 dreaming-lite (Letta-inspired): state of the background lesson
 * consolidation pass — recorded so the editor can show WHEN the workflow
 * last dreamed and what it learned, and so the scheduler rate-limits itself.
 */
export interface DreamState {
  lastDreamAt: number;
  /** How many runs the last dream looked at. */
  runsConsidered: number;
  /** Lessons actually added by the last dream (0 = nothing new learned). */
  added: number;
  /** One-line summary of the consolidation (editor note). */
  note?: string;
}

/**
 * One per-iteration trace row (harness rank-② second slice). Recorded at each
 * engine iteration boundary from the existing `iteration` SSE events:
 * honest about what the runner can see — promptChars only on iteration 1
 * (the assembled context), contentChars = streamed draft length so far,
 * msAt = elapsed since the step started.
 */
export interface LlmCallTrace {
  iter: number;
  msAt: number;
  contentChars: number;
  promptChars?: number;
}

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
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  task: string;
  status: "running" | "done" | "error" | "stopped";
  startedAt: number;
  finishedAt?: number;
  steps: WorkflowRunStep[];
  /** Populated when status = "error" — powers the recovery card. */
  error?: RunErrorInfo;
  /** How many times this run was resumed after a failure/stop. */
  resumeCount?: number;
  /** Chronological log of LLM calls made during this run (capped, oldest-dropped). */
  callLog?: RunCallLogEntry[];
  /**
   * Trace schema version (harness rank-①): lets the suite/trace shape evolve
   * without silently breaking old runs. Absent = v1 (pre-r31).
   */
  schemaVersion?: number;
  /** Set when the run was executed by a task-suite case (rank-①). */
  suiteCaseId?: string;
  /** Suite result row this run belongs to (groups repeats together). */
  suiteRunId?: string;
  /**
   * r35 branch-from-step-k: set when this run was branched from an earlier
   * run — the original row stays untouched, steps before the branch point
   * are copied verbatim. Powers the “branched” chip + compare flows.
   */
  branchOf?: { runId: string; fromStepIndex: number };
  /**
   * r36: which harness preset actually drove this run — explicit override
   * (suite A/B lab) > workflow editor selection > global active harness.
   * Powers the harness chip on run rows; absent = pre-r36 run.
   */
  harness?: string;
  /**
   * r40 tool-def audit receipt: exactly which tools were offered to this run
   * (built-in ids + mcp__server__tool def names) and how many MCP tools the
   * per-run cap dropped. Run rows become honest about the model's tool surface.
   */
  toolsOffered?: string[];
  mcpToolsDropped?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  runs: WorkflowRun[];
  createdAt: number;
  updatedAt: number;
  /** Pipeline depth (r26) — missing = "standard" for pre-existing workflows. */
  depth?: PipelineDepth;
  /** Recurring in-app schedule (runs fire while the app tab is open). */
  schedule?: WorkflowSchedule;
  /**
   * r31 harness rank-③: Reflexion lessons from failed runs / rework verdicts
   * (cap 5, ≤300 chars each). Injected into the next run's first-step context;
   * visible + deletable in the workflow editor.
   */
  lessons?: RunLesson[];
  /**
   * r33 dreaming-lite: last background consolidation pass (Letta doctrine —
   * idle time distills run history into durable lessons). Set after the first
   * dream; drives the "due for a dream" heuristic + editor note.
   */
  dream?: DreamState;
  /** r34 harness selection — missing ⇒ inherit the global active harness. */
  harness?: string;
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
  /** Task text used for each scheduled run (falls back to the description). */
  task: string;
  lastRunAt?: number;
  nextRunAt?: number;
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

// ─── r38 MCP (Model Context Protocol) — stateless-first client ──────────────
// Doctrine (r31-2 research, spec 2026-07-28): NO sessions, NO handshake
// persistence, NO SSE resumability — every request is self-contained JSON-RPC
// over HTTP POST. Transport is browser-direct (CORS-verified servers: keys
// never touch the app server) with an opt-in SSRF-guarded proxy fallback.

/** One tool offered by an MCP server, cached from the last discovery. */
export interface McpToolInfo {
  /** Raw tool name on the server (e.g. "ask_wiki_question"). */
  name: string;
  /** Prefixed server name — shown to the model for provenance. */
  serverName: string;
  /** Tool description (trimmed). */
  description?: string;
  /** Sanitized JSON Schema for the LLM function definition. */
  inputSchema?: Record<string, unknown>;
  /** Per-tool switch (default true on discovery). */
  enabled: boolean;
}

/**
 * r40 MRTR (Multi Round-Trip Requests, MCP 2026-07-28 spec): one piece of
 * input the server demands before it can finish a tools/call. Parsed
 * defensively — the spec fixes the RESULT shape (`InputRequiredResult` with
 * `resultType: "input_required"` + `inputRequests[]`) but request field names
 * vary; we keep the raw object for honest display and echo.
 */
export interface McpInputRequest {
  /** Server-minted request id when present (echoed back in inputResponses). */
  id?: string;
  /** Declared request kind when present (e.g. "text" / "confirm"). */
  type?: string;
  /** Best-effort human prompt extracted from common field shapes. */
  message?: string;
  /** The untouched request object — displayed and echoed verbatim. */
  raw: Record<string, unknown>;
}

/** r40: the user's answer to one McpInputRequest (sent as `inputResponses`). */
export interface McpInputResponse {
  id?: string;
  value?: string;
}

/** A user-registered MCP server (Streamable-HTTP POST endpoint). */
export interface McpServer {
  id: string;
  name: string;
  /** Endpoint URL (POST target), e.g. https://mcp.deepwiki.com/mcp. */
  url: string;
  /** BYOK auth headers sent browser→server directly. Never synced anywhere. */
  headers?: Record<string, string>;
  enabled: boolean;
  /**
   * Fallback route through /api/mcp (SSRF-guarded) when the server blocks
   * browser CORS. OFF by default — when on, headers transit the app server
   * (honest tradeoff, surfaced in the UI).
   */
  useProxy?: boolean;
  /**
   * r42 per-server MRTR kill switch: when a tool on this server answers
   * `input_required`, may an interactive lane (chat / playground) open the
   * human-gate dialog? Missing/true = allowed (r40 behavior); false = the
   * tool gets an honest "input unavailable" decline naming this switch.
   * Headless lanes never open gates regardless of this flag.
   */
  allowInputGates?: boolean;
  /** Protocol version that answered in the last discovery (ladder top first). */
  protocolVersion?: string;
  /** Cached catalog from the last successful discovery. */
  tools?: McpToolInfo[];
  discoveredAt?: number;
  /** Last discovery/call error (honest surfacing, cleared on success). */
  lastError?: string;
  /** Which transport last succeeded. */
  lastVia?: "browser" | "proxy";
  addedAt: number;
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
  /** Which LLM source is active when provider = "custom": a registry id or "custom" (legacy endpoint). */
  activeProviderId?: string;
  /**
   * r41-c — last successful provider-vault import (ISO timestamp). Audit trail
   * for the Settings → Your Data card; set only by the vault-import path.
   */
  vaultImportedAt?: string;
  /** Model Relay — automatic fallback rotation when the active model fails. Default true. */
  relayEnabled?: boolean;
  /** Saved hop ordering (keys "providerId::model"); missing = recommended Generation-Era order. */
  relayOrder?: string[];
  /**
   * r27 System-One (Jev, typesafe.ai) API key for the decision tier —
   * classification / judging / routing at ~$0.042/Mtok. Optional: without it
   * the decision ladder falls back to a fast-model JSON judge via the vault.
   */
  typesafeKey?: string;
  /**
   * r41 Hyperbrowser API key (BYOK tool key) — powers the deep_scrape tool
   * (headless cloud browser). Stays in the browser's localStorage and rides a
   * tool-execution request ONLY when deep_scrape actually runs. Missing = "".
   */
  hyperbrowserKey?: string;
  /** r34 harness selection (see lib/harness.ts) — retunes relay ordering,
   *  tool budget, stall resilience, lessons and dreams in one pick.
   *  Missing ⇒ "balanced". */
  activeHarness?: string;
  /**
   * r36 Skills gallery (PraisonAI SKILL.md doctrine) — parsed skill documents
   * injected into agent context when enabled. Instructions-only; scripts never
   * executed. Missing = no skills imported yet.
   */
  skills?: AgentSkill[];
  /**
   * r38 MCP registry — user-registered stateless MCP servers whose enabled
   * tools join chat + pipeline tool registries (capped). Missing = none yet.
   */
  mcpServers?: McpServer[];
  seeded: boolean;
}

// ─── SSE event protocol emitted by /api/chat ────────────────────────────────

/**
 * r36 Skills (PraisonAI-repo doctrine): a SKILL.md document parsed into a
 * reusable agent capability. v1 is INSTRUCTIONS-ONLY by design — the body is
 * plain guidance injected into agent context; a skill's scripts/ folder is
 * never executed (the node:vm sandbox discipline holds).
 */
export interface AgentSkill {
  id: string;
  /** Frontmatter `name` (or first heading / filename fallback). */
  name: string;
  /** Frontmatter `description` — what the skill teaches, shown in the gallery. */
  description: string;
  /** Markdown body below the frontmatter (the actual instructions). */
  body: string;
  /** Enabled skills ride along in chat + pipeline context (budgeted). */
  enabled: boolean;
  /** Body length in chars — shown honestly in the gallery, drives the budget. */
  chars: number;
  addedAt: number;
}

// ─── Task suite (harness rank-①): replayable cases over workflows ───────────

/** One suite case: a fixed task executed against a workflow pipeline. */
export interface SuiteCase {
  id: string;
  /** Target workflow id — resolved at execution time (missing → skipped). */
  workflowId: string;
  /** Frozen task text so repeated runs are comparable. */
  task: string;
  /** Human expectation note (e.g. "done · 0 tool calls · output OK"). */
  expect?: string;
  /** Optional machine expectation: run should finish with ≤ this many tool calls. */
  maxToolCalls?: number;
  /**
   * r36 Harness A/B lab: ordered harness ids this case rotates through
   * (e.g. ["balanced","free-frontier"]) so the SAME task runs under EACH
   * preset and the board can crown an empirical winner. Missing/empty = a
   * single pass under the workflow's own harness inheritance.
   */
  harnesses?: string[];
}

/** Metrics collected from one executed suite run (aggregates only — no outputs). */
export interface SuiteCaseRun {
  runId: string;
  status: WorkflowRun["status"];
  stepsDone: number;
  stepsTotal: number;
  ms: number;
  degraded: number;
  reworked: number;
  toolCallsOk: number;
  /** r36 A/B lab: which harness preset drove this run (missing = inherited). */
  harness?: string;
}

/** r36 A/B lab: per-harness aggregate for one case. */
export interface SuiteHarnessAggregate {
  harness: string;
  doneRate: number;
  runs: number;
  meanMs: number;
  reworks: number;
  toolCallsOk: number;
}

export interface SuiteCaseResult {
  caseId: string;
  workflowId: string;
  workflowName: string;
  task: string;
  expect?: string;
  /** "skipped" = workflow missing/deleted at execution time. */
  runs: SuiteCaseRun[] | "skipped";
  /** Mean share of repeats that finished done (0..1); 0 for skipped. */
  doneRate: number;
  /** r36 A/B lab: per-harness breakdown (present only for multi-harness cases). */
  byHarness?: SuiteHarnessAggregate[];
  /** r36 A/B lab: best harness id — highest doneRate, ties broken by latency. */
  winner?: string;
}

export interface SuiteResult {
  id: string;
  suiteId: string;
  startedAt: number;
  finishedAt?: number;
  repeats: number;
  results: SuiteCaseResult[];
  /** "stopped" = user aborted mid-suite; partial results kept. */
  status: "complete" | "stopped";
}

export interface Suite {
  id: string;
  name: string;
  description: string;
  cases: SuiteCase[];
  createdAt: number;
  updatedAt: number;
  lastResult?: SuiteResult;
  /** Result history (aggregates only), oldest first, capped. */
  history?: SuiteResult[];
  /**
   * r37 scheduled bake-offs: re-run this suite on a cadence (while the app
   * tab is open) so the A/B verdicts stay fresh instead of being one-off
   * experiments. Same doctrine as WorkflowSchedule — misses are skipped,
   * re-arm happens BEFORE the work starts, and a failure breaker auto-pauses
   * after repeated all-fail rounds to protect quota.
   */
  schedule?: SuiteSchedule;
  /** r39: what the scheduled auto-adoption last changed (honest audit, may be empty). */
  lastAdoption?: SuiteAdoption;
}

/**
 * r39: what a scheduled bake-off's auto-adoption actually changed (audit trail).
 */
export interface SuiteAdoption {
  at: number;
  entries: {
    workflowId: string;
    workflowName: string;
    from?: string;
    to: string;
    /** r40 sticky guard: verdict was NOT applied this round (held for agreement). */
    held?: boolean;
    /** Why this entry was held / skipped — honest audit even when nothing moved. */
    reason?: string;
  }[];
}

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
