// r387: first committed client-perf measurement in the app — born from the
// handoff debt "run-panel MOUNT perf unmeasured (only on user report)". The
// workflow run panel materializes a large subtree (run header, steps, history,
// server lane) the moment it opens; until now nobody had a NUMBER for that
// cost — any "it feels slow" report was unanswerable. React.Profiler hands us
// (phase, actualDuration) per commit of the instrumented subtree; this module
// keeps a small newest-first ring so QA (and any future debug surface) can
// read the real measurements instead of guessing.
//
// Honesty note: React's timings are precise in dev/profiling builds and coarse
// (possibly zeroed) in plain production builds — quote numbers from a dev
// server, which is also where the QA bridge below is wired.

export type PerfNote = {
  /** Profiler id, e.g. "WorkflowRunPanel". */
  id: string;
  /** React commit phase. */
  phase: "mount" | "update" | "nested-update";
  /** actualDuration of the commit, in ms (React scheduler clock). */
  ms: number;
  /** Date.now() when the note was recorded. */
  at: number;
};

const CAP = 50;
const notes: PerfNote[] = [];

export function recordPerfNote(
  id: string,
  phase: PerfNote["phase"],
  ms: number,
): void {
  notes.unshift({ id, phase, ms, at: Date.now() });
  if (notes.length > CAP) notes.length = CAP;
}

/** Newest-first copy — safe to hand to QA evals or future debug UIs. */
export function perfNotes(): PerfNote[] {
  return notes.map((n) => ({ ...n }));
}

/** Newest note for a Profiler id, or undefined if nothing recorded yet. */
export function lastPerfNote(id: string): PerfNote | undefined {
  return notes.find((n) => n.id === id);
}

// QA bridge (dev only): the r387 witness reads this from the live page.
// Window assignment is guarded, so SSR import is inert.
if (
  process.env.NODE_ENV !== "production" &&
  typeof window !== "undefined"
) {
  (
    window as unknown as { __praisonPerfNotes: typeof perfNotes }
  ).__praisonPerfNotes = perfNotes;
}
