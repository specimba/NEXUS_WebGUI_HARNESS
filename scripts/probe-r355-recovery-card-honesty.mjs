// r355 probe — kind-honest recovery-card resume affordances (static pins).
// The card's primary resume button must now carry the SELF_HEAL-vs-terminal
// doctrine as hover copy (RESUME_HINT, keyed by ALL 8 RunErrorKinds — the
// Record typing makes a missing key a tsc error, the probe pins the wiring),
// composed with the r84 lane-preference note; the "Show full error" toggle
// must expose aria-expanded. House style: the hint block carries no /quota/i.
import { readFileSync } from "node:fs";

const FILE = "src/components/nexus/workflows/workflow-run-panel.tsx";
const src = readFileSync(FILE, "utf8");

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

console.log("probe-r355-recovery-card-honesty");

// ── 1. RESUME_HINT exists, exhaustive, and carries the honest contracts ──
const m = src.match(/const RESUME_HINT: Record<RunErrorKind, string> = \{([\s\S]*?)\n\};/);
ok(m !== null, "RESUME_HINT Record<RunErrorKind, string> declared in the run panel");
const hintBody = m ? m[1] : "";
for (const kind of ["network", "timeout", "rate-limit", "out-of-credits", "auth", "region", "model", "unknown"]) {
  ok(hintBody.includes(`"${kind}"`) || hintBody.includes(`${kind}:`), `RESUME_HINT keyed for "${kind}"`);
}
ok(
  hintBody.includes("00:00 UTC") && hintBody.includes("Retry via relay"),
  "out-of-credits hint names the reset time AND the relay escape hatch",
);
ok(
  hintBody.includes("saturated") && hintBody.includes("wave"),
  "rate-limit hint defers to the header chip's saturation signal (r352 tie-in)",
);
ok(hintBody.includes("Settings → Providers"), "auth hint points at Settings → Providers");
ok(!/quota/i.test(hintBody), "hint block stays free of /quota/i vocabulary (house style)");
ok(
  hintBody.includes("Safe to retry") && hintBody.includes("fails again"),
  "self-healable kinds say safe-to-retry; terminal kinds say fails-again",
);

// ── 2. Wiring: the primary button consumes the composed title ──
ok(
  /const resumeTitle = err\s*\?\s*\[\s*RESUME_HINT\[err\.kind\]/.test(src),
  "resumeTitle composes RESUME_HINT[err.kind] at render time",
);
ok(
  src.includes("Lane preference is ON — this resume dials through the server relay first"),
  "r84 lane-preference note survives inside the composed title",
);
ok(
  !src.includes('title={preferRelay ? "Lane preference is ON'),
  "old inline title ternary on the primary button is gone (single source: resumeTitle)",
);
ok(/title=\{resumeTitle\}/.test(src), "primary resume button renders title={resumeTitle}");
ok(
  (src.match(/title=\{resumeTitle\}/g) || []).length === 1,
  "exactly one button consumes resumeTitle (the primary; relay button keeps its static title)",
);

// ── 3. A11y: the message toggle exposes its state ──
ok(
  /onClick=\{\(\) => setMsgOpen\(\(o\) => !o\)\}\s*\n\s*aria-expanded=\{msgOpen\}/.test(src),
  '"Show full error" toggle carries aria-expanded={msgOpen}',
);

// ── 4. Nothing else in the card regressed — anchor pins ──
ok(src.includes("function RunRecoveryCard("), "RunRecoveryCard still present");
ok(
  src.includes("aria-label=\"Dismiss recovery options\""),
  "dismiss button a11y untouched",
);
ok(
  src.includes('title="Re-run this step through the app relay instead of the direct provider'),
  "relay escape-hatch button keeps its explanatory title",
);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
