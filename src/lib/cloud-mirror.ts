"use client";

// ─── r507: Cloud mirror — OPTIONAL Supabase (BYO) off-site tier ──────────────
// Owner ask (r507): "should we move on with Supabase, like the simple free
// SQL storage service thing, to secure things much more properly, and Redis
// in between them?" The researched verdict (deep-searched this round):
//
//  · Supabase free tier = real Postgres, 500MB, BUT projects auto-pause
//    after ~1 week of inactivity and enter read-only freeze — so it is
//    backup/backup-restore grade, never a primary for a local-first app.
//  · Redis (Upstash free: 10K cmds/day, 256MB) is a cache/queue for
//    multi-node fan-out — no durability win over the local SQLite tier,
//    one more credential to lose. REJECTED for this app; the Doctor card
//    renders that verdict so the decision stays visible.
//
// Doctrine fit (BYOK): the Supabase URL + anon key live in THIS browser
// (localStorage, nexus.cloud-mirror.v1) and the browser talks PostgREST
// directly — nothing transits our server. Mirror is upsert-on-id, best
// effort, and never blocks archiving.
//
// Table SQL (pasted into the Supabase SQL editor once):
export const SUPABASE_TABLE_SQL = `create table if not exists run_reports (
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
);`;

export type CloudMirrorKind = "supabase";

export interface CloudMirrorConfig {
  kind: CloudMirrorKind;
  /** Project REST base, e.g. https://xyzcompany.supabase.co */
  url: string;
  /** anon (public) key — safe for RLS-enabled tables; owner chooses. */
  apiKey: string;
  /** target table, default run_reports */
  table: string;
  /** Mirror writes only when true — the card's switch, default off. */
  enabled: boolean;
}

export interface CloudMirrorStatus {
  lastSyncAt?: string;
  lastError?: string;
  mirroredRuns: number;
}

const CFG_KEY = "nexus.cloud-mirror.v1";
const STATUS_KEY = "nexus.cloud-mirror.status.v1";
const MAX_FIELD = 1_000_000;

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

/** Upsert one run into the Supabase table via PostgREST
 * (`?on_conflict=id` + `Prefer: resolution=merge-duplicates`). Never throws;
 * resolves { ok, error? } and records status for the Doctor card. */
export async function mirrorRunToCloud(entry: MirrorRunPayload): Promise<{ ok: boolean; error?: string }> {
  const cfg = readCloudMirrorConfig();
  if (!cfg || !cfg.enabled || !cfg.apiKey) return { ok: false, error: "mirror disabled" };
  try {
    const row = {
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
    const res = await fetch(`${cfg.url}/rest/v1/${cfg.table}?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: cfg.apiKey,
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([row]),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = `Supabase mirror ${res.status}: ${text.slice(0, 160)}`;
      noteStatus({ lastError: err, lastSyncAt: undefined });
      return { ok: false, error: err };
    }
    const st = readCloudMirrorStatus();
    noteStatus({
      lastSyncAt: new Date().toISOString(),
      lastError: undefined,
      mirroredRuns: (st.mirroredRuns ?? 0) + 1,
    });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    noteStatus({ lastError: error });
    return { ok: false, error };
  }
}

/** One-row probe the Doctor card's "Test" button uses. */
export async function testCloudMirror(): Promise<{ ok: boolean; error?: string }> {
  const cfg = readCloudMirrorConfig();
  if (!cfg || !cfg.url || !cfg.apiKey) return { ok: false, error: "URL and key required" };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${cfg.table}?select=id&limit=1`, {
      headers: { apikey: cfg.apiKey, Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
