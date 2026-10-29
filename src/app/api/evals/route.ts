import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { familyTallyOf } from "@/lib/family-witness";

export const dynamic = "force-dynamic";

// ─── r672: Durable RSI eval ledger (Owner deep-dive ship) ────────────────────
// The KICK corpus's interaction_logs pattern, adapted (KB-1-a candidate #2):
// every gate outcome from a finished workflow run lands here as a typed row
// in SQLite — the training corpus outlives the browser's trimmed localStorage
// store and becomes queryable history. The runner POSTs fire-and-forget on
// run finalization (never-throw on both sides); the Runs board digest GETs
// the census for its ledger chip.
//
// POST { runId, workflow, events: [{ stepId?, kind, verdict?, confidence?, note }] }
//   → { ok, written } — tolerant row validation, capped batch (64), capped
//     note (500), ledger hygiene keeps the newest 4000 rows.
// GET → { total, verdicts, fails, family, latest: [...], runs: [...] } — the
//   board census. r722: runs carries the newest 400 gate rows' { runId, note,
//   createdAt } — the per-run ledger read (the r683 proposal landed): the
//   board's SERVER-lane cards hold no client callLog, so their per-run ⚖ gate
//   chips classify these verbatim notes through the same shared gate-census
//   adapter the client-side chips use (one classifier, two sources).
//   r691: the drift tally pre-filters to witness-bearing notes (a
//   case-insensitive superset of the regex) — the scan no longer carries
//   every stored note on every poll; familyTallyOf stays the exact counter.
//   r730: runs rows also carry stepId (nullable) — the durable STEP key
//   reaches the board's corpus panel (the triage join, at step granularity).

const KINDS = new Set([
  "gate-verdict",
  "gate-uncertain",
  "gate-no-judge",
  "gate-judge-error",
]);
const MAX_BATCH = 64;
const LEDGER_KEEP = 4000;

interface IncomingEvent {
  stepId?: string;
  kind?: string;
  verdict?: string;
  confidence?: number;
  note?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const runId = typeof body.runId === "string" ? body.runId.slice(0, 64) : "";
    const workflow = typeof body.workflow === "string" ? body.workflow.slice(0, 120) : "";
    if (!runId || !workflow) {
      return NextResponse.json({ error: "runId and workflow are required" }, { status: 400 });
    }
    const events: IncomingEvent[] = Array.isArray(body.events)
      ? (body.events as IncomingEvent[]).slice(0, MAX_BATCH)
      : [];
    const rows: {
      runId: string;
      workflow: string;
      stepId?: string;
      kind: string;
      verdict?: string;
      confidence?: number;
      note: string;
    }[] = [];
    for (const e of events) {
      if (!e || typeof e !== "object") continue;
      if (typeof e.kind !== "string" || !KINDS.has(e.kind)) continue;
      if (typeof e.note !== "string" || e.note.length === 0) continue;
      const row = {
        runId,
        workflow,
        ...(typeof e.stepId === "string" && e.stepId.length > 0
          ? { stepId: e.stepId.slice(0, 64) }
          : {}),
        kind: e.kind,
        ...(((e.verdict === "PASS" || e.verdict === "FAIL") ? { verdict: e.verdict } : {})),
        ...(typeof e.confidence === "number" && Number.isFinite(e.confidence)
          ? { confidence: Math.min(100, Math.max(0, Math.round(e.confidence))) }
          : {}),
        note: e.note.slice(0, 500),
      };
      rows.push(row);
    }
    if (rows.length > 0) {
      await db.evalEvent.createMany({ data: rows });
      // Ledger hygiene (the corpus's own caps doctrine): keep the newest rows;
      // a runaway loop can't balloon SQLite one run at a time forever.
      const total = await db.evalEvent.count();
      if (total > LEDGER_KEEP + 500) {
        const stale = await db.evalEvent.findMany({
          orderBy: { createdAt: "desc" },
          skip: LEDGER_KEEP,
          take: total - LEDGER_KEEP,
          select: { id: true },
        });
        if (stale.length > 0) {
          await db.evalEvent.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
        }
      }
    }
    return NextResponse.json({ ok: true, written: rows.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "evals append failed" },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const [total, verdicts, fails, latest, notes, runsRaw] = await Promise.all([
      db.evalEvent.count(),
      db.evalEvent.count({ where: { kind: "gate-verdict" } }),
      db.evalEvent.count({ where: { kind: "gate-verdict", verdict: "FAIL" } }),
      db.evalEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { workflow: true, kind: true, verdict: true, confidence: true, createdAt: true },
      }),
      // r677: drift-witness tally over the stored notes — the shared
      // family-witness contract, applied server-side (never-throw: the
      // tally skips unwitnessed/junk notes silently). r691: the tally
      // pre-filters to witness-bearing notes (contains is a case-insensitive
      // superset of the regex, so the fetch can only return MORE candidates,
      // never fewer) — familyTallyOf stays the exact first-match counter
      // while the scan is bounded by witnessed rows, not the whole corpus.
      db.evalEvent.findMany({
        where: { OR: [{ note: { contains: "· cross-family" } }, { note: { contains: "· same-family" } }] },
        select: { note: true },
      }),
      // r722: the per-run ledger read (r683 proposal) — newest 400 rows with
      // runId + verbatim note; the board's server-lane cards classify their
      // own runId's rows through gateCensusOf (same adapter, one truth).
      // Capped: the ledger itself keeps 4000 (LEDGER_KEEP); 400 recent rows
      // bound the payload while covering every live run's window.
      db.evalEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 400,
        select: { runId: true, note: true, createdAt: true, stepId: true },
      }),
    ]);
    const family = familyTallyOf(notes.map((n) => n.note));
    const runs = runsRaw.map((r) => ({
      runId: r.runId,
      note: r.note,
      stepId: r.stepId,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : null,
    }));
    return NextResponse.json({ total, verdicts, fails, family, latest, runs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "evals census failed" },
      { status: 500 }
    );
  }
}
