import type {
  AgentColor,
  ChatMessage,
  Conversation,
  MessageAttachment,
  PipelineDepth,
  RunCallLogEntry,
  RunComparison,
  RunErrorInfo,
  ToolCallInfo,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
} from "./types";
import { IMAGE_MAX_DIMENSION, MAX_IMAGE_DATAURL_CHARS } from "./constants";
import { buildEvidenceLedger, formatCiters } from "./evidence-ledger";

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}

// First user-perceived character — flags (🇺🇸 is 2 code points / 4 UTF-16
// units) and ZWJ sequences survive; a plain 2-unit slice left half a flag.
// Shared doctrine (r75/r216, one implementation, zero copies): the agent
// form dialog (emoji input) and the import sanitizer (agents-view) both
// need it, and they must never disagree about what one emoji is.
export function firstGrapheme(s: string): string {
  const t = s.trim();
  if (!t) return "";
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return seg.segment(t)[Symbol.iterator]().next().value?.segment ?? "";
  } catch {
    return [...t][0] ?? "";
  }
}

export function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Local-calendar-day index for a timestamp (r267). DST-safe: uses the
 * per-timestamp UTC offset, so consecutive integers = consecutive LOCAL
 * calendar days even across DST transitions. The usage dashboard's activity
 * streak previously keyed days with the raw UTC index, which silently shifted
 * "a day" by the zone offset (a daily 02:30-local chatter in UTC+3 straddled
 * UTC midnight and showed a broken streak) and disagreed with the dashboard's
 * own 7-day chart, which buckets by local days.
 */
export function localDayKey(ts: number): number {
  return Math.floor((ts - new Date(ts).getTimezoneOffset() * 60_000) / 86_400_000);
}

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return truncate(clean, 42) || "New chat";
}

/**
 * Chat timestamp (r146): bare "14:32" is meaningless three days later, so
 * today keeps the bare time, yesterday gets a label, anything older gets a
 * real date. Pair with fmtChatTimeFull in a `title` for the exact moment.
 */
export function fmtChatTime(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  if (ts >= dayStart.getTime()) return time;
  if (ts >= dayStart.getTime() - 86_400_000) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** Full absolute timestamp for hover titles (date + time, locale-aware). */
export function fmtChatTimeFull(ts: number): string {
  return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Sidebar/list timestamp (r147): relative time reads well while fresh, but
 * "3d ago" under a "Previous 7 days" bucket header is vague — older chats get
 * a real short date ("Sep 21") instead. Pair with dateBucket headers.
 */
export function fmtListTime(ts: number): string {
  if (Date.now() - ts < 86_400_000) return fmtRel(ts);
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function fmtRel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function fmtMs(ms?: number): string {
  if (ms == null) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Compact duration for schedule labels: 5m · 1h · 6h · 1d. */
export function fmtIntervalShort(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 24 && Number.isInteger(h)) return `${h}h`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${Math.round(h / 24)}d`;
}

/** Human countdown for a future timestamp: "now" · "in 4m" · "in 2h". */
export function fmtIn(ts?: number): string {
  if (ts == null) return "—";
  const diff = ts - Date.now();
  if (diff <= 5_000) return "now";
  if (diff < 60_000) return `in ${Math.max(1, Math.round(diff / 1000))}s`;
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${(diff / 3_600_000).toFixed(1)}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

const COLORS: AgentColor[] = ["violet", "cyan", "emerald", "amber", "rose", "fuchsia"];

export function colorFor(seed: string): AgentColor {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Extract the first JSON array embedded in an LLM reply. */
export function extractJsonArray(text: string): unknown[] | null {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface PrevStepOutput {
  label: string;
  agentName: string;
  output: string;
  /** r29: the step ended on a tool-budget auto-digest (material is thin). */
  degraded?: boolean;
}

/**
 * r29 date anchoring: scheduled pipelines (Morning Briefing et al.) kept
 * asking about "today" with no idea what day it was — searches drifted to
 * stale or off-topic results. Every pipeline context now opens with the
 * run's real date so "latest/today" is always grounded.
 */
export function buildDateAnchor(): string {
  const now = new Date();
  const full = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `CONTEXT ANCHOR — today is ${full}. Treat "latest/today/this week" relative to this date.`;
}

/** Sequential (CrewAI-style) context: distilled handoff of previous outputs. */
export function buildSequentialContext(task: string, prev: PrevStepOutput[]): string {
  if (prev.length === 0) return `${buildDateAnchor()}\n\nTASK:\n${task}`;
  const handoffs = prev
    .map(
      (p, i) =>
        `--- Step ${i + 1}: ${p.label} (by ${p.agentName})${p.degraded ? " [ended on auto-digest]" : ""} ---\n${truncate(p.output, 4000)}`
    )
    .join("\n\n");
  return `${buildDateAnchor()}\n\nORIGINAL TASK:\n${task}\n\nOUTPUTS FROM PREVIOUS STEPS (use them as your input):\n${handoffs}\n\nContinue the pipeline: do YOUR step only, building on the outputs above.`;
}

/** Conversational (AutoGen-style) context: full transcript between agents. */
export function buildConversationalContext(task: string, prev: PrevStepOutput[]): string {
  if (prev.length === 0) return `${buildDateAnchor()}\n\nTASK:\n${task}`;
  const transcript = prev
    .map((p) => `${p.agentName} (step: ${p.label})${p.degraded ? " [ended on auto-digest]" : ""}:\n${truncate(p.output, 4000)}`)
    .join("\n\n");
  return `${buildDateAnchor()}\n\nTASK:\n${task}\n\nCONVERSATION SO FAR BETWEEN TEAM AGENTS:\n${transcript}\n\nYou are the next speaker in this conversation. React to what was said and do YOUR step.`;
}

/** Review-gate prompt: judge the previous step's output, return a strict JSON verdict. */
export function buildReviewContext(
  task: string,
  reviewed: { label: string; agentName: string; output: string }
): string {
  return [
    `ORIGINAL TASK:\n${task}`,
    `OUTPUT UNDER REVIEW — step "${reviewed.label}" by ${reviewed.agentName}:\n${truncate(reviewed.output, 4000)}`,
    `You are the quality gate for the step above. Judge it strictly against the original task (correctness, completeness, clarity).`,
    `Respond with ONLY a JSON object — no markdown fences, no commentary:`,
    `• Accept: {"verdict":"pass","note":"one-line justification"}`,
    `• Reject: {"verdict":"rework","feedback":"specific, actionable fixes for the step's agent"}`,
  ].join("\n\n");
}

/** Parse a review-gate reply into a verdict; malformed replies default to pass (never deadlock the pipeline). */
export function parseReviewVerdict(text: string): "pass" | "rework" {
  const m = /"verdict"\s*:\s*"(pass|rework)"/i.exec(text);
  if (m) return m[1].toLowerCase() === "rework" ? "rework" : "pass";
  return /\brework\b/i.test(text) ? "rework" : "pass";
}

// ─── r180: role-tag honesty (user directive item (a)) ──────────────────────
// Workflow step labels often carry a "[Role]" prefix ("[Strategic Planner] …")
// that MASQUERADES as routing while the actual worker is step.agentId. The
// user's failed-run directive (agent_workflow_upgrade_directive_v1.md, r179
// Drive retrieval): "Store role_id and agent_id as explicit fields. Do not
// encode routing in free-text titles." The run evidence: a title prefixed
// Strategic Planner was shown under Research Scout and nobody flagged it.
// parseRolePrefix extracts the tag for honest display; roleMatchesAgent
// decides whether the tag agrees with the assigned worker — callers render
// an amber mismatch chip when it does not. Display-only: labels stay
// authoring freedom, routing stays step.agentId (unchanged by design).

// ─── r343: plan-import text integrity (no mid-word amputation, no UI-chip fusion) ──
// The user's pasted plan arrived with step texts torn mid-word ("bounded
// recursive self-i…", "…delegation, memory, con") and fused with the run
// panel's own amber chip text ("tag [Strategic Planner] ≠ worker"). Two
// mechanical causes, both ours to fix at the border:
//  (1) import paths hard-slice label/name/goal at fixed widths (.slice(0, N))
//      — a >N line is amputated mid-word into PERSISTED text. Display may
//      truncate; storage must not tear words.
//  (2) text copied back out of our own UI interleaves the chip's rendered
//      text ("tag [X] ≠ worker", `role tag "X" ≠ worker "Y" (routing …)`)
//      into the copied plan; re-pasting that imports the chip as content.

/**
 * Word-boundary truncation: never returns a torn token. Text at or below
 * `max` passes through untouched; longer text is cut at the last space that
 * fits and gets an ellipsis. A single token longer than `max` (URLs, hashes)
 * cannot be word-split — it hard-slices with the ellipsis, still honest.
 */
export function truncateAtWord(text: string, max: number): string {
  const s = (text ?? "").trim();
  if (s.length <= max) return s;
  // lastIndexOf(" ", max - 1): the boundary space itself must fit inside the
  // cap, or slice(0, cut) + "…" lands one char OVER max (probe-caught).
  const cut = s.lastIndexOf(" ", max - 1);
  if (cut <= 0) return s.slice(0, Math.max(1, max - 1)) + "…";
  return s.slice(0, cut) + "…";
}

/**
 * Strip run-panel chip artifacts fused into copied plan text. Anchored on
 * the literal "≠ worker" — no legitimate plan line contains it. Handles the
 * two render shapes (bracket tag and quoted role) plus the summary suffix.
 */
export function stripUiChipArtifacts(text: string): string {
  return (text ?? "")
    .replace(
      /[ \t]*(?:role[ \t]tag|[ \t]?role|tag)?[ \t]*(?:\[[^\][\n]{0,80}\]|["“”][^"“”\n]{0,80}["“”])?[ \t]*≠[ \t]*worker(?:[ \t]*(?:["“”][^"“”\n]{0,80}["“”]|\([^)\n]{0,140}\)))*/g,
      ""
    )
    .replace(/[ \t]*⚠[ \t]*/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Extract a leading "[Role]" tag from a step label (tolerant: null when absent). */
export function parseRolePrefix(label: string): { role: string | null; cleanLabel: string } {
  const m = /^\s*\[([^\][\n]{1,80})\]\s*/.exec(label ?? "");
  if (!m) return { role: null, cleanLabel: (label ?? "").trim() };
  return { role: m[1].trim(), cleanLabel: label.slice(m[0].length).trim() };
}

/** Normalized identity: lowercase, letters/digits only (strips emoji, spacing, punctuation). */
function normIdentity(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Does a label's "[Role]" tag agree with the worker's agent name? Substring
 * match both ways on normalized identities — "Research Scout" tag on a
 * "Research Scout" agent agrees; "Strategic Planner" on "Research Scout"
 * does not. Empty/absent inputs never match (callers treat null role as no-signal). */
export function roleMatchesAgent(role: string, agentName: string): boolean {
  const r = normIdentity(role ?? "");
  const a = normIdentity(agentName ?? "");
  if (!r || !a) return false;
  return r === a || a.includes(r) || r.includes(a);
}

/** r182 (directive item (a) completion): the step's EFFECTIVE role signal.
 * An explicit step.roleId — now authorable in the workflow editor — is the
 * honest home and wins outright; the parsed "[Tag]" label prefix is only the
 * legacy fallback (old workflows keep their amber-chip coverage). `source`
 * lets callers phrase the chip honestly ("role" vs legacy "tag"). */
export function resolveStepRole(
  roleId: string | null | undefined,
  label: string
): { role: string | null; source: "explicit" | "parsed" | null } {
  const explicit = (roleId ?? "").trim();
  if (explicit) return { role: explicit, source: "explicit" };
  const parsed = parseRolePrefix(label ?? "").role;
  return parsed ? { role: parsed, source: "parsed" } : { role: null, source: null };
}

/** r311: per-surface role-tag noise policy. When EVERY step that carries a
 * role signal mismatches its worker (imported plans authored for a different
 * agent chain — the user's Continuous Research pipeline showed 9 identical
 * amber chips), per-step chips are repetition, not information: callers
 * render ONE summary note instead. A single mismatched step stays per-step
 * (it is actionable). Tagged = steps with an explicit roleId or a "[Tag]"
 * label prefix; a missing worker name counts as a mismatch (nothing to
 * agree with). */
export interface RoleTagMismatchSummary {
  tagged: number;
  mismatched: number;
  universal: boolean;
}

export function summarizeRoleTagMismatches(
  steps: { label?: string | null; roleId?: string | null; agentName?: string | null }[]
): RoleTagMismatchSummary {
  let tagged = 0;
  let mismatched = 0;
  for (const s of steps) {
    const roleInfo = resolveStepRole(s.roleId, s.label ?? "");
    if (roleInfo.role == null) continue;
    tagged += 1;
    const worker = (s.agentName ?? "").trim();
    if (!worker || !roleMatchesAgent(roleInfo.role, worker)) mismatched += 1;
  }
  return { tagged, mismatched, universal: tagged > 1 && mismatched === tagged };
}

/** Rough token estimate for the NEXT chat turn (4 chars ≈ 1 token). */
export function estimateNextTurnTokens(
  messages: ChatMessage[],
  systemPrompt: string,
  draft: string,
  cap = 40
): number {
  const history = messages
    .filter((m) => m.status === "done" || m.role === "user")
    .slice(-cap)
    .reduce((n, m) => n + msgContextText(m).length, 0);
  const chars = systemPrompt.length + history + draft.length + 200;
  return Math.ceil(chars / 4);
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path below (r270)
    }
  }
  // Clipboard API unavailable or denied (insecure origin, iframe without
  // clipboard-write permission, focus race). Legacy execCommand fallback so
  // copy buttons still work in blocked contexts — and callers' failure
  // feedback stays honest instead of firing on a silent no-op.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), "application/json");
}

// ─── Workflow export packs (r496) ────────────────────────────────────────────
// r496 (owner directive): the definitions-only batch export weighed LESS than
// one single run report (five pipelines ≈ 9.6 KB vs one run report ≈ 68 KB of
// step outputs). The export carried none of the run intelligence, so moving
// workflows between profiles meant losing every run, output and schedule.
// Two modes now:
//   "definitions" — the old portable shape (compatible with version-1 files).
//   "full"        — version 2: definitions + run history (outputs, tool
//                   calls, LLM call log, novelty, errors) + schedule intent,
//                   with agentName on every step so any profile can rebind
//                   workers (ids are profile-local uid()s and never survive).

/** Restored step-output cap — largest observed real output ≈ 20 KB; headroom without pathology. */
const EXPORT_OUTPUT_CAP = 60_000;
/** Cap for one tool-call args/result field inside a restored run step. */
const EXPORT_TOOL_FIELD_CAP = 4_000;
/** Imported run history per workflow — mirrors the live addRun() cap (12). */
export const IMPORT_RUNS_CAP = 12;
/** Restored LLM-call log entries per run. */
const IMPORT_CALLLOG_CAP = 200;

const TERMINAL_RUN_STATUSES: readonly string[] = ["done", "error", "stopped", "partial", "blocked"];

function capExportText(v: unknown, cap: number): string {
  if (typeof v !== "string") return "";
  return v.length <= cap ? v : v.slice(0, cap - 1) + "…[truncated]";
}

function isPipelineDepth(v: unknown): v is PipelineDepth {
  return v === "quick" || v === "standard" || v === "deep";
}

/**
 * Build the export payload for one or many workflows. Pure — the caller owns
 * filenames, byte counting and toasts.
 */
export function buildWorkflowExport(
  workflows: Workflow[],
  mode: "definitions" | "full",
  agentNameById: Map<string, string>
): Record<string, unknown> {
  return {
    kind: "nexus-workflows",
    version: 2,
    ...(mode === "full" ? { mode: "full" } : {}),
    exportedAt: new Date().toISOString(),
    workflows: workflows.map((w) => {
      const base: Record<string, unknown> = {
        name: w.name,
        description: w.description,
        // agentName rides on every step: step ids AND agent ids are
        // profile-local uid()s that never survive an export — the importer
        // rebinds workers by name (r495/r496).
        steps: w.steps.map((s) => ({ ...s, agentName: agentNameById.get(s.agentId) })),
        ...(w.depth ? { depth: w.depth } : {}),
      };
      if (mode !== "full") return base;
      // Schedule INTENT only (intervalMs + task) — runtime counters
      // (failStreak/lastRunAt/nextRunAt/autoResumeAt) are profile state.
      if (w.schedule) {
        base.schedule = { intervalMs: w.schedule.intervalMs, task: w.schedule.task };
      }
      // Inert provenance for human readers; the importer ignores unknown keys.
      if (w.evolution) base.lineage = w.evolution;
      base.createdAt = w.createdAt;
      base.updatedAt = w.updatedAt;
      base.runs = w.runs.map(({ id: _runId, workflowId: _wfId, ...rest }) => rest);
      return base;
    }),
  };
}

/**
 * Sanitize one untrusted run object from a full-pack import into a real
 * WorkflowRun. Returns null for junk rows. Live "running" runs are coerced to
 * "stopped" — nothing can still be executing on a fresh profile — and
 * never-started steps (pending/running) become "skipped" so the imported
 * history reads honestly instead of promising phantom work.
 */
export function sanitizeImportedRun(
  raw: unknown,
  workflowId: string,
  workflowName: string
): WorkflowRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

  let status = str(r.status) as WorkflowRun["status"];
  if (status === "running") status = "stopped";
  if (!TERMINAL_RUN_STATUSES.includes(status)) return null;

  const startedAt = num(r.startedAt) ?? Date.now();
  const rawSteps = Array.isArray(r.steps) ? r.steps : [];
  const steps: WorkflowRunStep[] = [];
  for (const rs of rawSteps) {
    if (!rs || typeof rs !== "object") continue;
    const s = rs as Record<string, unknown>;
    const st = str(s.status);
    steps.push({
      stepId: str(s.stepId) || uid("step"),
      agentId: str(s.agentId),
      agentName: str(s.agentName, "Agent"),
      agentEmoji: str(s.agentEmoji, "🤖"),
      label: truncateAtWord(stripUiChipArtifacts(str(s.label, "Step")), 200) || "Step",
      ...(typeof s.roleId === "string" && s.roleId.trim() ? { roleId: s.roleId } : {}),
      output: capExportText(s.output, EXPORT_OUTPUT_CAP),
      toolCalls: (Array.isArray(s.toolCalls) ? s.toolCalls : []).flatMap((t): ToolCallInfo[] => {
        if (!t || typeof t !== "object") return [];
        const tc = t as Record<string, unknown>;
        const ms = num(tc.ms);
        return [
          {
            id: str(tc.id) || uid("tool"),
            name: str(tc.name, "tool"),
            args: capExportText(tc.args, EXPORT_TOOL_FIELD_CAP),
            ...(typeof tc.result === "string" ? { result: capExportText(tc.result, EXPORT_TOOL_FIELD_CAP) } : {}),
            ...(tc.ok === false ? { ok: false } : {}),
            ...(ms != null ? { ms } : {}),
          },
        ];
      }),
      status:
        st === "done" || st === "error" || st === "stopped" || st === "skipped"
          ? (st as WorkflowRunStep["status"])
          : "skipped",
      ...(num(s.ms) != null ? { ms: num(s.ms) } : {}),
      ...(s.kind === "review" || s.kind === "generate" ? { kind: s.kind } : {}),
      ...(typeof s.instruction === "string" ? { instruction: capExportText(s.instruction, 2000) } : {}),
      ...(s.verdict === "pass" || s.verdict === "rework" ? { verdict: s.verdict } : {}),
      ...(s.reworked === true ? { reworked: true } : {}),
      ...(s.degraded === true ? { degraded: true } : {}),
    });
  }
  if (steps.length === 0) return null;

  const finishedAt = num(r.finishedAt);
  const callLog = (Array.isArray(r.callLog) ? r.callLog : [])
    .flatMap((c): RunCallLogEntry[] => {
      if (!c || typeof c !== "object") return [];
      const e = c as Record<string, unknown>;
      const ms = num(e.ms);
      if (typeof e.engine !== "string" || ms == null) return [];
      const attempt = num(e.attempt);
      return [
        {
          at: num(e.at) ?? startedAt,
          ...(typeof e.stepId === "string" ? { stepId: e.stepId } : {}),
          ...(typeof e.stepLabel === "string" ? { stepLabel: e.stepLabel } : {}),
          ...(typeof e.agentName === "string" ? { agentName: e.agentName } : {}),
          engine: e.engine,
          ...(typeof e.model === "string" ? { model: e.model } : {}),
          ms,
          ok: e.ok === true,
          ...(typeof e.error === "string" ? { error: capExportText(e.error, 1000) } : {}),
          ...(attempt != null ? { attempt } : {}),
          ...(typeof e.note === "string" ? { note: capExportText(e.note, 500) } : {}),
        },
      ];
    })
    .slice(0, IMPORT_CALLLOG_CAP);

  const rawErr = r.error;
  let error: RunErrorInfo | undefined;
  if (rawErr && typeof rawErr === "object" && typeof (rawErr as Record<string, unknown>).message === "string") {
    const e = rawErr as Record<string, unknown>;
    error = {
      stepIndex: num(e.stepIndex) ?? 0,
      stepId: str(e.stepId),
      stepLabel: str(e.stepLabel),
      agentName: str(e.agentName, "Agent"),
      message: capExportText(e.message, 4000),
      kind: str(e.kind, "unknown") as RunErrorInfo["kind"],
      hint: str(e.hint),
      toolCallsOk: num(e.toolCallsOk) ?? 0,
      stepsDone: num(e.stepsDone) ?? 0,
      llmLabel: str(e.llmLabel),
      attempts: num(e.attempts) ?? 1,
      ...(e.autoRetried === true ? { autoRetried: true } : {}),
    };
  }

  const novelty = num(r.novelty);
  const resumeCount = num(r.resumeCount);
  const parkCount = num(r.parkCount);
  const netParkCount = num(r.netParkCount);

  return {
    id: uid("run"),
    workflowId,
    workflowName,
    task: capExportText(r.task, 2000) || "(untitled run)",
    status,
    startedAt,
    ...(finishedAt != null ? { finishedAt } : {}),
    steps,
    ...(isPipelineDepth(r.depth) ? { depth: r.depth } : {}),
    ...(r.source === "manual" || r.source === "scheduled" ? { source: r.source } : {}),
    ...(error ? { error } : {}),
    ...(novelty != null ? { novelty: Math.max(0, Math.min(100, Math.round(novelty))) } : {}),
    ...(resumeCount != null ? { resumeCount } : {}),
    ...(parkCount != null ? { parkCount } : {}),
    ...(netParkCount != null ? { netParkCount } : {}),
    ...(callLog.length > 0 ? { callLog } : {}),
  };
}

/** Filesystem-safe slug for exported filenames. */
export function slugify(s: string, max = 40): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "chat"
  );
}

/** Render a conversation as a portable Markdown document (chat export). */
export function conversationToMarkdown(conv: Conversation): string {
  const lines: string[] = [
    `# ${conv.title}`,
    "",
    `> Exported from NEXUS WebGUI · ${conv.messages.length} message${
      conv.messages.length === 1 ? "" : "s"
    } · ${new Date().toLocaleString()}`,
  ];
  for (const m of conv.messages) {
    const who = m.role === "user" ? "You" : m.agentName ?? "Assistant";
    lines.push(
      "",
      `### ${m.role === "user" ? "🧑" : "🤖"} ${who} · ${fmtChatTimeFull(m.createdAt)}`,
      "",
      m.content.trim() || "_(no content)_"
    );
    if (m.attachments?.length) {
      lines.push(
        "",
        "<details><summary>Attachments</summary>",
        "",
        ...m.attachments.map((a) => `- 📎 **${a.name}** (${fmtBytes(a.size)})`),
        "",
        "</details>"
      );
    }
    if (m.toolCalls.length > 0) {
      lines.push("", "<details><summary>Tool calls</summary>", "");
      for (const t of m.toolCalls) {
        lines.push(
          `- ${t.name}${t.ms != null ? ` (${fmtMs(t.ms)})` : ""}${t.ok === false ? " ✗" : " ✓"}`
        );
      }
      lines.push("", "</details>");
    }
    if (m.role === "assistant" && m.transport) {
      lines.push(
        "",
        `> ⇚ lane: ${
          m.transport === "server"
            ? "server relay ⇄ — routed through the app's vault chain"
            : "browser-direct ⊙ — key stayed local"
        }`
      );
    }
    if (m.error) lines.push("", `> ⚠️ Error: ${m.error}`);
  }
  lines.push("", "---", "", "_Generated locally by NEXUS WebGUI — agentic workflow automation platform._");
  return lines.join("\n");
}

// ─── Chat attachments ────────────────────────────────────────────────────────

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Serialize text attachments into a context block appended to the user turn. */
export function attachmentContextBlock(atts: MessageAttachment[] | undefined): string {
  if (!atts || atts.length === 0) return "";
  const blocks = atts
    .filter((a) => a.kind !== "image") // images travel as content parts, not text
    .map(
      (a) =>
        `--- Attached file: ${a.name} (${fmtBytes(a.size)}) ---\n${a.content}\n--- end of ${a.name} ---`
    );
  if (blocks.length === 0) return "";
  return `\n\n${blocks.join("\n\n")}`;
}

/** Short placeholder used in HISTORY for image attachments (no base64 blobs). */
export function imageAttachmentNote(atts: MessageAttachment[] | undefined): string {
  const imgs = atts?.filter((a) => a.kind === "image") ?? [];
  if (imgs.length === 0) return "";
  const list = imgs.map((a) => a.name).join(", ");
  return `\n\n[Image(s) attached with this message: ${list}]`;
}

/**
 * Full text for the LLM from a stored message: the visible content plus any
 * attachment file bodies (images become short placeholder notes). Used
 * everywhere chat history is rebuilt.
 */
export function msgContextText(m: Pick<ChatMessage, "content" | "attachments">): string {
  return m.content + imageAttachmentNote(m.attachments) + attachmentContextBlock(m.attachments);
}

// ─── Read-aloud (TTS) ────────────────────────────────────────────────────────

/**
 * Convert a markdown reply into speakable plain text: strips code fences,
 * images, links, emphasis, headers, tables and HTML tags.
 */
export function mdToSpeakable(md: string): string {
  return md
    .replace(/```[\s\S]*?(?:```|$)/g, " Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*_]\s*){3,}$/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*\|?[\s:-]+\|?\s*$/gm, "") // table separator rows
    .replace(/^\s*\|(.*)\|\s*$/gm, (_m, row: string) => row.replace(/\|/g, ", "))
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

// ─── Image attachments ───────────────────────────────────────────────────────

/** Approximate byte size of a base64 data URL payload. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.round(b64.length * 0.75);
}

/**
 * Read an image File, downscale it to fit within IMAGE_MAX_DIMENSION and
 * re-encode as JPEG (progressively lower quality until it fits the data-URL
 * budget). Returns a `data:image/jpeg;base64,…` URL ready for vision models.
 */
export async function downscaleImageFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the image file"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Unsupported or corrupt image"));
    el.src = dataUrl;
  });

  const w0 = img.naturalWidth || 1;
  const h0 = img.naturalHeight || 1;
  const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl; // canvas unavailable — pass the original through
  ctx.drawImage(img, 0, 0, w, h);

  let best = canvas.toDataURL("image/jpeg", 0.5);
  for (const q of [0.82, 0.68, 0.55]) {
    const out = canvas.toDataURL("image/jpeg", q);
    best = out;
    if (out.length <= MAX_IMAGE_DATAURL_CHARS) return out;
  }
  return best;
}

// ─── Workflow run reports (Markdown export) ──────────────────────────────────

const STATUS_LABEL: Record<WorkflowRun["status"], string> = {
  running: "⏳ Running",
  done: "✅ Completed",
  error: "❌ Failed",
  stopped: "⛔ Stopped",
  // r183 (directive item b): honest outcomes instead of stopped-with-empty.
  partial: "🟡 Partial — ended early, completed steps preserved",
  blocked: "⏸ Blocked — parked, auto-resumes",
};

/** Render one workflow run as a portable Markdown report. */
export function runToMarkdown(workflow: Pick<Workflow, "name">, run: WorkflowRun): string {
  const lines: string[] = [
    `# Run report — ${workflow.name}`,
    "",
    `> Exported from NEXUS WebGUI · ${new Date().toLocaleString()}`,
    "",
    `- **Status:** ${STATUS_LABEL[run.status]}`,
    `- **Started:** ${new Date(run.startedAt).toLocaleString()}${
      run.finishedAt ? ` · finished in **${fmtMs(run.finishedAt - run.startedAt)}**` : ""
    }`,
    "",
    "## Task",
    "",
    run.task,
    "",
    "## Steps",
  ];
  run.steps.forEach((s, i) => {
    lines.push(
      "",
      `### ${i + 1}. ${s.label} — ${s.agentEmoji} ${s.agentName}`,
      "",
      `\`${s.status}\`${s.ms != null ? ` · ${fmtMs(s.ms)}` : ""} · ${fmtBytes(s.output.length)} of output${
        s.toolCalls.length ? ` · ${s.toolCalls.length} tool call${s.toolCalls.length === 1 ? "" : "s"}` : ""
      }`,
      "",
      s.output.trim() || "_(no output)_"
    );
    if (s.toolCalls.length > 0) {
      lines.push("", "<details><summary>Tool calls</summary>", "");
      for (const t of s.toolCalls) {
        lines.push(`- ${t.name}${t.ms != null ? ` (${fmtMs(t.ms)})` : ""}${t.ok === false ? " ✗" : " ✓"}`);
      }
      lines.push("", "</details>");
    }
  });
  // r184 (directive item c): claim-to-source evidence ledger — every external
  // URL the run's outputs and tool calls referenced, with the citing steps.
  const ledger = buildEvidenceLedger(run.steps);
  if (ledger.length > 0) {
    lines.push(
      "",
      "## Evidence ledger",
      "",
      `${ledger.length} distinct source${ledger.length === 1 ? "" : "s"} referenced by this run:`,
      ""
    );
    for (const e of ledger) {
      lines.push(`- ${e.url} — cited by ${formatCiters(e)}`);
    }
    lines.push("", "_Each claim above can be checked against the source the run actually fetched or cited._");
  }
  if (run.callLog && run.callLog.length > 0) {
    lines.push("", "## LLM calls", "");
    run.callLog.forEach((c, i) => {
      lines.push(
        `- #${i + 1} ${c.ok ? "✓" : "✗"} ${c.engine}${c.model ? ` · ${c.model}` : ""} · ${fmtMs(c.ms)}${
          c.attempt && c.attempt > 1 ? ` · attempt ${c.attempt}` : ""
        }${c.note ? ` · _${c.note}_` : ""}`
      );
    });
  }
  lines.push("", "---", "", "_Generated locally by NEXUS WebGUI — agentic workflow automation platform._");
  return lines.join("\n");
}

/**
 * Technical diagnostics block for a failed/stopped run — copied to the
 * clipboard from the recovery card so users can report issues precisely.
 */
export function runDiagnostics(
  workflow: Pick<Workflow, "name">,
  run: WorkflowRun
): string {
  const lines: string[] = [
    "NEXUS WebGUI — run diagnostics",
    "===============================",
    `workflow : ${workflow.name} (${run.workflowId})`,
    `run      : ${run.id}`,
    `status   : ${run.status}`,
    `started  : ${new Date(run.startedAt).toISOString()}`,
    run.finishedAt
      ? `finished : ${new Date(run.finishedAt).toISOString()} (${fmtMs(run.finishedAt - run.startedAt)})`
      : "finished : —",
    `task     : ${run.task.slice(0, 200)}`,
  ];
  const e = run.error;
  if (e) {
    // r84: live recovery math (same fix as the run panel) — the frozen snapshot
    // carried the resumed loop's LOCAL index, so resumed runs reported 0 done.
    const failIdx = run.steps.findIndex((s) => s.status === "error");
    const doneN = run.steps.filter((s) => s.status === "done").length;
    lines.push(
      "",
      "[failure]",
      `step     : #${(failIdx === -1 ? e.stepIndex : failIdx) + 1} "${e.stepLabel}" (${e.stepId})`,
      `agent    : ${e.agentName}`,
      `kind     : ${e.kind}`,
      `engine   : ${e.llmLabel}`,
      `stepsDone: ${doneN}/${run.steps.length}`,
      `toolsOk  : ${e.toolCallsOk} (inside the failed step)`,
      `attempts : ${e.attempts}`,
      `autoRetry: ${e.autoRetried ? "1 (the runner retried this step automatically before surfacing)" : "none"}`,
      `message  : ${e.message}`
    );
  }
  if (run.callLog?.length) {
    lines.push("", "[llm calls]");
    run.callLog.forEach((c, i) => {
      const stepRef = c.stepLabel ? `step "${c.stepLabel}"` : "step";
      lines.push(
        `- #${i + 1} ${stepRef} · ${c.engine}${c.model ? ` · ${c.model}` : ""} · ${fmtMs(c.ms)} · ${c.ok ? "✓" : `✗ ${c.error ?? "failed"}`}${c.attempt && c.attempt > 1 ? ` (attempt ${c.attempt})` : ""}${c.note ? ` · ${c.note}` : ""}`
      );
    });
    const relayN = run.callLog.filter((c) => c.note?.startsWith("server relay")).length;
    const directN = run.callLog.filter((c) => c.note?.startsWith("browser-direct")).length;
    if (relayN + directN > 0) {
      lines.push(
        `lanes    : ⇄ ${relayN} server-relay · ⊙ ${directN} browser-direct · unnoted ${run.callLog.length - relayN - directN}`
      );
    }
  }
  if (run.resumeCount) lines.push(`resumes  : ${run.resumeCount}`);
  lines.push("", "[steps]");
  run.steps.forEach((s, i) => {
    lines.push(
      `- #${i + 1} ${s.label} · ${s.status}${s.ms != null ? ` · ${fmtMs(s.ms)}` : ""} · tools ${s.toolCalls.length} · out ${s.output.length}B${s.kind === "review" ? ` · verdict ${s.verdict ?? "—"}` : ""}`
    );
  });
  return lines.join("\n");
}

/** Render a two-run comparison (from the compare dialog) as a Markdown report. */
export function comparisonToMarkdown(
  workflow: Pick<Workflow, "name">,
  cmp: RunComparison
): string {
  const delta = cmp.totalDeltaMs;
  const deltaTxt =
    delta == null
      ? "n/a (a run has not finished)"
      : Math.abs(delta) < 50
        ? "~same speed"
        : delta < 0
          ? `Run B faster by ${fmtMs(-delta)}`
          : `Run A faster by ${fmtMs(delta)}`;
  const lines: string[] = [
    `# Comparison report — ${workflow.name}`,
    "",
    `> Exported from NEXUS WebGUI · ${new Date().toLocaleString()}`,
    "",
    "| | Run A | Run B |",
    "| --- | --- | --- |",
    `| Task | ${cmp.a.task.replace(/\|/g, "\\|")} | ${cmp.b.task.replace(/\|/g, "\\|")} |`,
    `| Started | ${new Date(cmp.a.startedAt).toLocaleString()} | ${new Date(cmp.b.startedAt).toLocaleString()} |`,
    `| Total | ${cmp.totalAms != null ? fmtMs(cmp.totalAms) : "—"} | ${cmp.totalBms != null ? fmtMs(cmp.totalBms) : "—"} |`,
    `| Steps done | ${cmp.aDone}/${cmp.rows.length} | ${cmp.bDone}/${cmp.rows.length} |`,
    `| Tool calls | ${cmp.rows.reduce((n, r) => n + r.aToolCalls, 0)} | ${cmp.rows.reduce((n, r) => n + r.bToolCalls, 0)} |`,
    "",
    `**Duration delta:** ${deltaTxt}`,
    ...(cmp.sameTask ? [] : ["", `⚠️ Note: the two runs had different tasks.`]),
    "",
    "## Per-step deltas",
  ];
  for (const r of cmp.rows) {
    const msDelta =
      r.aStatus === "done" && r.bStatus === "done" && r.aMs != null && r.bMs != null
        ? r.bMs - r.aMs
        : null;
    const stepDelta =
      msDelta == null
        ? ""
        : Math.abs(msDelta) < 50
          ? " · ~same"
          : msDelta < 0
            ? ` · B faster by ${fmtMs(-msDelta)}`
            : ` · B slower by ${fmtMs(msDelta)}`;
    lines.push(
      "",
      `### ${r.stepIndex + 1}. ${r.label}`,
      "",
      `| | Run A | Run B |`,
      `| --- | --- | --- |`,
      `| Agent | ${r.aAgent} | ${r.bAgent} |`,
      `| Status | ${r.aStatus} | ${r.bStatus} |`,
      `| Duration | ${r.aMs != null ? fmtMs(r.aMs) : "—"} | ${r.bMs != null ? fmtMs(r.bMs) : "—"} |`,
      `| Output | ${fmtBytes(r.aOutputLen)} | ${fmtBytes(r.bOutputLen)} |`,
      `| Tool calls | ${r.aToolCalls} | ${r.bToolCalls} |`,
      stepDelta ? `\`${stepDelta.replace(" · ", "")}\`` : ""
    );
  }
  lines.push("", "---", "", "_Generated locally by NEXUS WebGUI — agentic workflow automation platform._");
  return lines.join("\n");
}

/**
 * r177 (user report): recurring workflow runs used to export to the SAME
 * filename (`nexus-run-<slug>.md`) — every new run overwrote the previous
 * report in the user's Downloads. Convention (r177 research: GitHub Actions
 * run_number × ISO-stamp hybrid, honoring the user's own a/b/c habit):
 *   nexus-run-<slug>-run<NNN>-<YYYYMMDD-HHMM>[a|b|c].md
 * NNN = the run's 1-based ordinal inside the workflow's own run list (sorted
 * by startedAt — stable as long as the run exists); stamp = the run's local
 * start time; the letter is appended ONLY when sibling runs share the same
 * start minute — collision-free without probing the filesystem.
 */
export function runReportFileName(
  workflowName: string,
  run: { id: string; startedAt: number },
  runs: { id: string; startedAt: number }[]
): string {
  const slug = slugify(workflowName) || "workflow";
  const ordered = [...runs].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)
  );
  const idx = ordered.findIndex((r) => r.id === run.id);
  const nnn = String((idx >= 0 ? idx : ordered.length) + 1).padStart(3, "0");
  const d = new Date(run.startedAt);
  const p = (x: number) => String(x).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const minute = Math.floor(run.startedAt / 60_000);
  const siblings = ordered.filter((r) => Math.floor(r.startedAt / 60_000) === minute);
  let letter = "";
  if (siblings.length > 1) {
    const li = siblings.findIndex((r) => r.id === run.id);
    letter = String.fromCharCode(97 + Math.min(Math.max(li, 0), 25));
  }
  return `nexus-run-${slug}-run${nnn}-${stamp}${letter}.md`;
}
