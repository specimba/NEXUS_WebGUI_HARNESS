// ─── PraisonAI Web · Shared Types ────────────────────────────────────────────

export type View = "chat" | "agents" | "workflows" | "settings";

/** Accent theme variants (remap the violet/fuchsia accent scale via CSS vars). */
export type UiThemeId = "nexus" | "matrix" | "fallout" | "cyber";

export type ToolId = "web_search" | "read_url" | "run_code" | "current_time";

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
}

export interface WorkflowStep {
  id: string;
  agentId: string;
  label: string;
  instruction?: string;
  /** "review" steps audit the previous step's output and can force a rework. */
  kind?: StepKind;
}

export type StepKind = "generate" | "review";

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
  /** Review-gate outcome for kind = "review" steps. */
  verdict?: "pass" | "rework";
  /** True when this generate step was redone after a review rework. */
  reworked?: boolean;
}

/** Classified cause of a failed run — drives the recovery card's copy. */
export type RunErrorKind = "network" | "auth" | "rate-limit" | "timeout" | "unknown";

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
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  runs: WorkflowRun[];
  createdAt: number;
  updatedAt: number;
  /** Recurring in-app schedule (runs fire while the app tab is open). */
  schedule?: WorkflowSchedule;
}

/** Interval-based schedule for a workflow. Missed runs (app closed) are skipped. */
export interface WorkflowSchedule {
  enabled: boolean;
  intervalMs: number;
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
