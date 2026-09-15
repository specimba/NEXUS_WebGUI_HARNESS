import type {
  AgentColor,
  ChatMessage,
  Conversation,
  MessageAttachment,
  RunComparison,
  Workflow,
  WorkflowRun,
} from "./types";
import { IMAGE_MAX_DIMENSION, MAX_IMAGE_DATAURL_CHARS } from "./constants";

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}

export function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return truncate(clean, 42) || "New chat";
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
}

/** Sequential (CrewAI-style) context: distilled handoff of previous outputs. */
export function buildSequentialContext(task: string, prev: PrevStepOutput[]): string {
  if (prev.length === 0) return `TASK:\n${task}`;
  const handoffs = prev
    .map(
      (p, i) =>
        `--- Step ${i + 1}: ${p.label} (by ${p.agentName}) ---\n${truncate(p.output, 4000)}`
    )
    .join("\n\n");
  return `ORIGINAL TASK:\n${task}\n\nOUTPUTS FROM PREVIOUS STEPS (use them as your input):\n${handoffs}\n\nContinue the pipeline: do YOUR step only, building on the outputs above.`;
}

/** Conversational (AutoGen-style) context: full transcript between agents. */
export function buildConversationalContext(task: string, prev: PrevStepOutput[]): string {
  if (prev.length === 0) return `TASK:\n${task}`;
  const transcript = prev
    .map((p) => `${p.agentName} (step: ${p.label}):\n${truncate(p.output, 4000)}`)
    .join("\n\n");
  return `TASK:\n${task}\n\nCONVERSATION SO FAR BETWEEN TEAM AGENTS:\n${transcript}\n\nYou are the next speaker in this conversation. React to what was said and do YOUR step.`;
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
  try {
    await navigator.clipboard.writeText(text);
    return true;
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
    `> Exported from PraisonAI Web · ${conv.messages.length} message${
      conv.messages.length === 1 ? "" : "s"
    } · ${new Date().toLocaleString()}`,
  ];
  for (const m of conv.messages) {
    const who = m.role === "user" ? "You" : m.agentName ?? "Assistant";
    lines.push(
      "",
      `### ${m.role === "user" ? "🧑" : "🤖"} ${who} · ${fmtTime(m.createdAt)}`,
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
    if (m.error) lines.push("", `> ⚠️ Error: ${m.error}`);
  }
  lines.push("", "---", "", "_Generated locally by PraisonAI Web — multi-agent platform._");
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
};

/** Render one workflow run as a portable Markdown report. */
export function runToMarkdown(workflow: Pick<Workflow, "name">, run: WorkflowRun): string {
  const lines: string[] = [
    `# Run report — ${workflow.name}`,
    "",
    `> Exported from PraisonAI Web · ${new Date().toLocaleString()}`,
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
  lines.push("", "---", "", "_Generated locally by PraisonAI Web — multi-agent platform._");
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
    `> Exported from PraisonAI Web · ${new Date().toLocaleString()}`,
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
  lines.push("", "---", "", "_Generated locally by PraisonAI Web — multi-agent platform._");
  return lines.join("\n");
}
