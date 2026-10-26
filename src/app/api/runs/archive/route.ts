import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── r455: Durable run-report archive (local lane) ───────────────────────────
// The durable tier behind the trimmed localStorage live state (r414): every
// settled LOCAL-lane run is POSTed here by the runner and lands in SQLite in
// full — steps, outputs, tool calls (the server lane already has AutomationRun).
// User ask (r455): reports "need to be archived, available for agents to
// maintain" — this is that surface: GET to list/read, DELETE to prune.
// Idempotent by construction: id = the WorkflowRun id, upsert on POST, so a
// resumed run re-archives over its earlier snapshot.

interface ArchiveStep {
  stepId?: string;
  agentName?: string;
  label?: string;
  output?: string;
  status?: string;
  ms?: number;
  toolCalls?: { name?: string; ms?: number; ok?: boolean; args?: string; result?: string }[];
}

// Paranoia caps — pathological single fields can't balloon a row; normal
// research outputs (essays, tool results) pass untouched.
const MAX_FIELD = 1_000_000;
const clamp = (s: string | undefined | null): string =>
  typeof s === "string" && s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : (s ?? "");

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  try {
    if (runId) {
      const row = await db.runReport.findUnique({ where: { id: runId } });
      if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({
        report: { ...row, steps: JSON.parse(row.stepsJson) as ArchiveStep[] },
      });
    }
    const workflowId = req.nextUrl.searchParams.get("workflowId");
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100)));
    // ─── r457: one-call latest-report fetch (full row incl. parsed steps) ───
    // The runner's prior-knowledge injection calls this at fresh-run start
    // (user ask r455: reports are for agents to "proceed further, evaluate,
    // and integrate" — this is that bootstrap call). No status filter: agents
    // may want the latest row even if it failed; callers filter as needed.
    if (workflowId && req.nextUrl.searchParams.get("latest")) {
      const row = await db.runReport.findFirst({
        where: { workflowId },
        orderBy: { startedAt: "desc" },
      });
      if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({
        report: { ...row, steps: JSON.parse(row.stepsJson) as ArchiveStep[] },
      });
    }
    const rows = await db.runReport.findMany({
      where: workflowId ? { workflowId } : undefined,
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        workflowId: true,
        workflowName: true,
        task: true,
        source: true,
        status: true,
        depth: true,
        error: true,
        toolCalls: true,
        durationMs: true,
        startedAt: true,
        finishedAt: true,
        archivedAt: true,
      },
    });
    return NextResponse.json({ reports: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "archive read failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      id?: string;
      workflowId?: string;
      workflowName?: string;
      task?: string;
      source?: string;
      status?: string;
      depth?: string;
      error?: string | null;
      steps?: ArchiveStep[];
      toolCalls?: number;
      durationMs?: number | null;
      startedAt?: number;
      finishedAt?: number | null;
    };
    if (!body.id || !body.workflowId || !body.status || !Array.isArray(body.steps)) {
      return NextResponse.json(
        { error: "id, workflowId, status and steps[] are required" },
        { status: 400 }
      );
    }
    const steps = body.steps.map((st) => ({
      ...st,
      output: clamp(st.output),
      toolCalls: (st.toolCalls ?? []).map((tc) => ({
        ...tc,
        args: clamp(tc.args),
        result: clamp(tc.result),
      })),
    }));
    const data = {
      workflowId: body.workflowId,
      workflowName: clamp(body.workflowName) || "Untitled workflow",
      task: clamp(body.task),
      source: body.source === "scheduled" ? "scheduled" : "manual",
      status: body.status,
      depth: body.depth ?? null,
      stepsJson: JSON.stringify(steps),
      error: body.error ? clamp(body.error) : null,
      toolCalls: Number.isFinite(body.toolCalls) ? Math.max(0, Math.round(body.toolCalls ?? 0)) : 0,
      durationMs:
        body.durationMs != null && Number.isFinite(body.durationMs)
          ? Math.max(0, Math.round(body.durationMs))
          : null,
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
      finishedAt: body.finishedAt ? new Date(body.finishedAt) : null,
    };
    const row = await db.runReport.upsert({
      where: { id: body.id },
      create: { id: body.id, ...data },
      update: data,
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    // r609 stack capture: the {error} body alone did not survive log rotation
    // (the archiver-500 left zero diagnostics) — the real stack now lands in
    // dev.log too, tagged for the archiver-500 class.
    console.error("[run-archive] write failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "archive write failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }
  try {
    await db.runReport.delete({ where: { id: runId } });
    return NextResponse.json({ ok: true });
  } catch {
    // Deleting something already gone is a successful maintenance no-op.
    return NextResponse.json({ ok: true });
  }
}
