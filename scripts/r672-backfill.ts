// r672: one-shot ledger backfill — REAL gate events from the browser store's
// finished runs, classified by the REAL extractor (single-mapping doctrine).
import { gateEventsOf } from "../src/lib/gate-census";
const raw = await Bun.file("/tmp/ledger-backfill.json").text();
let data: unknown = JSON.parse(raw);
if (typeof data === "string") data = JSON.parse(data); // agent-browser eval double-encodes
const runs = data as { runId: string; workflow: string; events: { stepId?: string; note: string }[] }[];
let written = 0;
for (const r of runs) {
  const events = gateEventsOf(r.events);
  if (events.length === 0) continue;
  const res = await fetch("http://localhost:3000/api/evals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: r.runId,
      workflow: r.workflow,
      events: events.map((e) => ({
        ...(e.stepId != null ? { stepId: e.stepId } : {}),
        kind: e.kind,
        ...(e.verdict != null ? { verdict: e.verdict } : {}),
        ...(e.confidence != null ? { confidence: e.confidence } : {}),
        note: e.note,
      })),
    }),
  });
  const j = (await res.json()) as { written?: number };
  written += j.written ?? 0;
}
console.log("backfill written:", written);
