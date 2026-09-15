// ─── PraisonAI Web · Shared Types ────────────────────────────────────────────

export type View = "chat" | "agents" | "workflows" | "settings";

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

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  task: string;
  status: "running" | "done" | "error" | "stopped";
  startedAt: number;
  finishedAt?: number;
  steps: WorkflowRunStep[];
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
