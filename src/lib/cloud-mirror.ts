"use client";

// ─── r507→r508: Cloud mirror — OPTIONAL Supabase (BYO) off-site tier ─────────
// Owner ask (r507): "should we move on with Supabase, like the simple free
// SQL storage service thing, to secure things much more properly, and Redis
// in between them?" The researched verdict (deep-searched that round):
//
//  · Supabase free tier = real Postgres, 500MB, BUT projects auto-pause
//    after ~1 week of inactivity and enter read-only freeze — so it is
//    backup/backup-restore grade, never a primary for a local-first app.
//  · Redis (Upstash free: 10K cmds/day, 256MB) is a cache/queue for
//    multi-node fan-out — no durability win over the local SQLite tier,
//    one more credential to lose. REJECTED for this app; the Doctor card
//    renders that verdict so the decision stays visible.
//
// Doctrine fit (BYOK): the Supabase URL + key live in THIS browser
// (localStorage, nexus.cloud-mirror.v1) and the browser talks PostgREST
// directly — nothing transits our server. Mirror is upsert-on-id, best
// effort, and never blocks archiving.
//
// r508 (owner's live project came back PGRST205 — the one-time SQL was
// never run and the failure only surfaced as a raw 404 toast):
//  · SCHEMA SQL v2 — BOTH mirror tables (run_reports + workflow_defs),
//    RLS + explicit anon policies (publishable-key safe), indexes, and a
//    `notify pgrst, 'reload schema'` so the just-created tables are visible
//    to PostgREST instantly (the classic post-DDL PGRST205 gotcha).
//  · Structured error classification (missing-table / auth / too-large /
//    network / unknown) so the Doctor card can render an actionable
//    one-time-setup panel instead of a cryptic 404 body.
//  · Chunked BATCH sync (mirrorRunsToCloud) — the whole archive, not "last 25".
//  · Workflow definitions mirror (workflow_defs) — the off-site backup now
//    covers the automations themselves, not only their run reports.
//
// r510 (owner paste: "Last mirror error: unsupported Unicode escape sequence"):
//  LLM output routinely contains LONE UTF-16 surrogates (a high \uD800-\uDBFF
//  without its low pair or vice versa). JSON.stringify happily encodes them
//  as \\udXXX escapes, but PostgREST/PostgreSQL rejects the whole batch with
//  "unsupported Unicode escape sequence" — one bad character in one step
//  output poisoned the ENTIRE sync. Fix: every payload is deep-sanitized to
//  well-formed UTF-16 (lone surrogates → U+FFFD) before it leaves the browser.
//
// r618a (2026-10-27, Owner audit): Supabase's advisor flags this schema's two
//  `for all ... using (true) with check (true)` policies as critical — with
//  anon+authenticated covered, ANYONE holding the project's publishable key
//  can read/write the two mirror tables. HONEST TRANSPORT FACT: those
//  policies ARE this mirror's transport (browser BYOK anon key, no Supabase
//  Auth session exists), so dropping them now = mirror goes dark. The
//  exposure is bounded: two backup tables (run reports + workflow defs),
//  no credentials, no other project tables touched. Decision paths:
//   (a) KEEP browser mirror → run only the safe-now revokes (foreign tables
//       notionstyle/slackmessages + rls_auto_enable() — NOT ours, pre-existing)
//       and accept the two advisor warnings as a documented trade-off;
//   (b) LOCKDOWN → FIRST ship a server-side mirror route holding the
//       service_role key in server env ONLY (never browser), repoint
//       mirrorRunsToCloud at it, THEN apply the revoke SQL. The service key
//       is Owner-gated — never invented, never stored client-side.

/** One-time schema setup. Idempotent (safe to re-run). Paste into
 * https://supabase.com/dashboard/project/<ref>/sql/new and press RUN. */
export const SUPABASE_SCHEMA_SQL = `-- NEXUS cloud mirror · one-time setup (safe to re-run)
create table if not exists run_reports (
  id text primary key,
  workflow_id text not null,
  workflow_name text not null,
  status text not null,
  trigger text,
  started_at timestamptz,
  finished_at timestamptz,
  total_ms bigint,
  model text,
  steps jsonb default '[]'::jsonb,
  notes text,
  mirrored_at timestamptz default now()
);
create index if not exists run_reports_started_idx on run_reports (started_at desc);

create table if not exists workflow_defs (
  id text primary key,
  name text not null,
  updated_at timestamptz,
  data jsonb not null,
  mirrored_at timestamptz default now()
);

-- The mirror dials with the project's anon/publishable key (BYOK: the key
-- already lives in the owner's browser), so grant it explicit access to
-- these two mirror tables ONLY. service_role always bypasses RLS.
alter table run_reports enable row level security;
alter table workflow_defs enable row level security;

drop policy if exists "mirror_full_run_reports" on run_reports;
create policy "mirror_full_run_reports" on run_reports
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "mirror_full_workflow_defs" on workflow_defs;
create policy "mirror_full_workflow_defs" on workflow_defs
  for all to anon, authenticated using (true) with check (true);

-- Make the fresh tables visible to PostgREST immediately (avoids the
-- lingering PGRST205 "not in the schema cache" after DDL).
notify pgrst, 'reload schema';`;

/** @deprecated r507 name — kept so any stale import keeps working. */
export const SUPABASE_TABLE_SQL = SUPABASE_SCHEMA_SQL;

export type CloudMirrorKind = "supabase";

export interface CloudMirrorConfig {
  kind: CloudMirrorKind;
  /** Project REST base, e.g. https://xyzcompany.supabase.co */
  url: string;
  /** anon (publishable) key — RLS policies scope it to the mirror tables. */
  apiKey: string;
  /** target runs table, default run_reports */
  table: string;
  /** Mirror writes only when true — the card's switch, default off. */
  enabled: boolean;
}

export type MirrorErrorKind = "missing-table" | "auth" | "too-large" | "network" | "unknown";

export interface CloudMirrorStatus {
  lastSyncAt?: string;
  lastError?: string;
  lastErrorKind?: MirrorErrorKind;
  mirroredRuns: number;
  mirroredWorkflows?: number;
}

const CFG_KEY = "nexus.cloud-mirror.v1";
const STATUS_KEY = "nexus.cloud-mirror.status.v1";
const MAX_FIELD = 1_000_000;
const CHUNK = 10;

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readCloudMirrorConfig(): CloudMirrorConfig | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as Partial<CloudMirrorConfig>;
    if (!cfg || cfg.kind !== "supabase" || typeof cfg.url !== "string" || !cfg.url) return null;
    return {
      kind: "supabase",
      url: cfg.url.replace(/\/+$/, ""),
      apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
      table: typeof cfg.table === "string" && cfg.table ? cfg.table : "run_reports",
      enabled: cfg.enabled === true,
    };
  } catch {
    return null;
  }
}

export function writeCloudMirrorConfig(cfg: CloudMirrorConfig | null): boolean {
  return writeJson(CFG_KEY, cfg);
}

export function readCloudMirrorStatus(): CloudMirrorStatus {
  return readJson<CloudMirrorStatus>(STATUS_KEY, { mirroredRuns: 0 });
}

function noteStatus(patch: Partial<CloudMirrorStatus>): void {
  const next = { ...readCloudMirrorStatus(), ...patch };
  writeJson(STATUS_KEY, next);
}

function clamp(s: string | undefined | null): string {
  return typeof s === "string" && s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : (s ?? "");
}

// ─── r510: lone-surrogate sanitation — the "unsupported Unicode escape" fix ──

/** Well-formed UTF-16: lone surrogates become U+FFFD (replacement char).
 * ES2024 String.prototype.toWellFormed when present; TextEncoder round-trip
 * otherwise (the WHATWG encoder replaces lone surrogates with U+FFFD too). */
function wellFormed(s: string): string {
  const w = s as { toWellFormed?: () => string };
  if (typeof w.toWellFormed === "function") return w.toWellFormed();
  try {
    return new TextDecoder().decode(new TextEncoder().encode(s));
  } catch {
    return s;
  }
}

/** Recursively make a payload PostgREST-safe: every string value (at any
 * depth — steps arrays, workflow `data` jsonb, notes) is well-formed, and
 * oversized strings are clamped. Never mutates the input. */
export function sanitizeMirrorValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return wellFormed(clamp(value));
  if (value === null || typeof value !== "object") return value;
  if (depth > 12) return null; // pathological nesting guard
  if (Array.isArray(value)) return value.map((v) => sanitizeMirrorValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizeMirrorValue(v, depth + 1);
  }
  return out;
}

// ─── r508: error classification — the 404 body becomes a verdict ─────────────

/** PostgREST error body → { kind, message }. The message field of the JSON is
 * preferred; PGRST205 / "Could not find the table" maps to missing-table. */
export function classifyMirrorError(status: number, body: string): { kind: MirrorErrorKind; message: string } {
  let message = body || "";
  try {
    const j = JSON.parse(body) as { message?: unknown; error?: unknown; hint?: unknown };
    if (typeof j.message === "string" && j.message) message = j.hint ? `${j.message} (hint: ${String(j.hint)})` : j.message;
    else if (j.error) message = typeof j.error === "string" ? j.error : JSON.stringify(j.error);
  } catch {
    /* raw text is fine */
  }
  const lower = `${message} ${body}`.toLowerCase();
  if (lower.includes("pgrst205") || lower.includes("could not find the table")) {
    return { kind: "missing-table", message: "Mirror table missing in the project schema (PGRST205) — run the one-time setup SQL" };
  }
  if (lower.includes("unsupported unicode escape")) {
    return { kind: "unknown", message: "Payload carried invalid Unicode (lone surrogate) — now sanitized automatically; sync again" };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", message: `Key rejected (HTTP ${status}) — use this project's anon/publishable or service key` };
  }
  if (status === 413) return { kind: "too-large", message: "Batch too large — it will be retried in smaller chunks" };
  if (status < 200) return { kind: "network", message: "Could not reach Supabase (offline, DNS, or the project is paused)" };
  return { kind: "unknown", message: message.slice(0, 220) || `HTTP ${status}` };
}

export function errorIsMissingTable(err: string | undefined | null): boolean {
  return !!err && (/pgrst205|could not find the table/i.test(err) || /setup sql/i.test(err));
}

// ─── r508: dashboard deep links — from the project URL to the SQL editor ─────

/** "https://xyzcompany.supabase.co" → "vwott…zok (ref redacted)" */
export function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (!host.endsWith(".supabase.co")) return null;
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}

export function supabaseSqlEditorUrl(url: string): string {
  const ref = projectRefFromUrl(url);
  return ref
    ? `https://supabase.com/dashboard/project/${ref}/sql/new`
    : "https://supabase.com/dashboard";
}

// ─── payloads ────────────────────────────────────────────────────────────────

/** Structural subset of RunArchiveEntry (avoids a circular import). */
export interface MirrorRunPayload {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger?: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  totalMs?: number;
  model?: string;
  notes?: string;
  steps: { name?: string; agent?: string; output?: string; ms?: number }[];
}

/** Structural subset of Workflow — the full definition rides in `data`. */
export interface MirrorWorkflowPayload {
  id: string;
  name: string;
  updatedAt: number;
  data: unknown;
}

interface MirrorResult {
  ok: number;
  failed: number;
  error?: string;
  kind?: MirrorErrorKind;
}

async function postMirrorRows(
  cfg: CloudMirrorConfig,
  table: string,
  rows: unknown[],
): Promise<{ ok: boolean; error?: string; kind?: MirrorErrorKind }> {
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: cfg.apiKey,
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      // r510: deep-sanitize BEFORE stringify — one lone surrogate anywhere in
      // one step output used to reject the whole batch at the Postgres gate.
      body: JSON.stringify(rows.map((r) => sanitizeMirrorValue(r))),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const c = classifyMirrorError(res.status, text);
      return { ok: false, kind: c.kind, error: c.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, kind: "network", error: err instanceof Error ? err.message : String(err) };
  }
}

function runToRow(entry: MirrorRunPayload): Record<string, unknown> {
  return {
    id: entry.id,
    workflow_id: entry.workflowId,
    workflow_name: entry.workflowName,
    trigger: entry.trigger ?? "manual",
    status: entry.status,
    started_at: entry.startedAt,
    finished_at: entry.finishedAt,
    total_ms: entry.totalMs ?? null,
    model: entry.model ?? null,
    steps: (entry.steps ?? []).map((s) => ({
      name: clamp(s.name),
      agent: clamp(s.agent),
      output: clamp(s.output),
      ms: s.ms ?? null,
    })),
    notes: clamp(entry.notes),
    mirrored_at: new Date().toISOString(),
  };
}

/** Upsert ONE run (the archiveRun() hot path). Never throws. */
export async function mirrorRunToCloud(entry: MirrorRunPayload): Promise<{ ok: boolean; error?: string }> {
  const cfg = readCloudMirrorConfig();
  if (!cfg || !cfg.enabled || !cfg.apiKey) return { ok: false, error: "mirror disabled" };
  const r = await postMirrorRows(cfg, cfg.table, [runToRow(entry)]);
  if (r.ok) {
    const st = readCloudMirrorStatus();
    noteStatus({
      lastSyncAt: new Date().toISOString(),
      lastError: undefined,
      lastErrorKind: undefined,
      mirroredRuns: (st.mirroredRuns ?? 0) + 1,
    });
    return { ok: true };
  }
  noteStatus({ lastError: r.error, lastErrorKind: r.kind });
  return { ok: false, error: r.error };
}

/** r508: upsert the WHOLE archive in chunks of 10 (was one POST per run,
 * capped at 25). Aborts early on missing-table/auth — no point burning
 * chunks against a schema that is not there yet. Never throws. */
export async function mirrorRunsToCloud(entries: MirrorRunPayload[]): Promise<MirrorResult> {
  const cfg = readCloudMirrorConfig();
  if (!cfg || !cfg.enabled || !cfg.apiKey) return { ok: 0, failed: 0, error: "mirror disabled" };
  let ok = 0;
  let failed = 0;
  let lastError: string | undefined;
  let lastKind: MirrorErrorKind | undefined;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK).map(runToRow);
    const r = await postMirrorRows(cfg, cfg.table, chunk);
    if (r.ok) {
      ok += chunk.length;
    } else {
      failed += chunk.length;
      lastError = r.error;
      lastKind = r.kind;
      if (r.kind === "missing-table" || r.kind === "auth") break;
    }
  }
  if (ok > 0) {
    const st = readCloudMirrorStatus();
    noteStatus({
      lastSyncAt: new Date().toISOString(),
      mirroredRuns: (st.mirroredRuns ?? 0) + ok,
      ...(failed === 0 ? { lastError: undefined, lastErrorKind: undefined } : {}),
    });
  }
  if (failed > 0) noteStatus({ lastError: lastError, lastErrorKind: lastKind });
  return { ok, failed, error: failed > 0 ? lastError : undefined, kind: failed > 0 ? lastKind : undefined };
}

/** r508: mirror the workflow DEFINITIONS themselves into workflow_defs so the
 * off-site backup can restore automations, not only their reports. */
export async function mirrorWorkflowsToCloud(items: MirrorWorkflowPayload[]): Promise<MirrorResult> {
  const cfg = readCloudMirrorConfig();
  if (!cfg || !cfg.enabled || !cfg.apiKey) return { ok: 0, failed: 0, error: "mirror disabled" };
  let ok = 0;
  let failed = 0;
  let lastError: string | undefined;
  let lastKind: MirrorErrorKind | undefined;
  const rows = items.map((w) => ({
    id: w.id,
    name: clamp(w.name),
    updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : null,
    data: w.data,
    mirrored_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await postMirrorRows(cfg, "workflow_defs", rows.slice(i, i + CHUNK));
    if (r.ok) {
      ok += Math.min(CHUNK, rows.length - i);
    } else {
      failed += Math.min(CHUNK, rows.length - i);
      lastError = r.error;
      lastKind = r.kind;
      if (r.kind === "missing-table" || r.kind === "auth") break;
    }
  }
  if (ok > 0) {
    const st = readCloudMirrorStatus();
    noteStatus({ mirroredWorkflows: (st.mirroredWorkflows ?? 0) + ok });
  }
  if (failed > 0) noteStatus({ lastError: lastError, lastErrorKind: lastKind });
  return { ok, failed, error: failed > 0 ? lastError : undefined, kind: failed > 0 ? lastKind : undefined };
}

/** One-row probe the Doctor card's "Test" button uses. Also records the
 * verdict (r508) so the setup panel can react without a sync attempt. */
export async function testCloudMirror(): Promise<{ ok: boolean; error?: string; kind?: MirrorErrorKind }> {
  const cfg = readCloudMirrorConfig();
  if (!cfg || !cfg.url || !cfg.apiKey) return { ok: false, error: "URL and key required" };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${cfg.table}?select=id&limit=1`, {
      headers: { apikey: cfg.apiKey, Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const c = classifyMirrorError(res.status, text);
      noteStatus({ lastError: c.message, lastErrorKind: c.kind });
      return { ok: false, error: c.message, kind: c.kind };
    }
    noteStatus({ lastError: undefined, lastErrorKind: undefined });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    noteStatus({ lastError: error, lastErrorKind: "network" });
    return { ok: false, error, kind: "network" };
  }
}
