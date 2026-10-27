// ─── qa:golden — headless golden-path regression (r607, Owner meta-review) ──
// Collapses the patrol's three manual browser legs into ONE command so a patrol
// round spends 1 tool round on QA instead of 3 (the chronic budget-overrun
// driver: r604/r605 spent 13 rounds vs the <=12 cap, mostly on legs + hunting).
// Runs the three golden legs through the agent-browser CLI, asserts each leg's
// observable truth, and counts NEW console errors per leg (baseline-aware).
// Exit 0 = all green; exit 1 = first failure with a named leg.
//   bun run qa:golden
// r623 hardening (harness integrity, per r621/r622 post-mortems):
//   1. tsc gate leg FIRST with the rc captured unmasked via spawnSync().status
//      (the r621 false witness came from `tsc | head` pipe-masking; a spawn
//      without a shell cannot be pipe-masked by construction).
//   2. consoleErrors() parses STRUCTURED console entries — `agent-browser
//      console --json`, counting level=="error" entries — instead of counting
//      the substring "error" anywhere in the text dump (r622 proved benign
//      warning bodies containing the word "error" inflated the count and
//      masked the real DB-corruption signal). Severity-prefix line parse is
//      the fallback when --json is unavailable.
import { spawnSync } from "node:child_process";

function sh(cmd: string, timeoutMs = 60000): string {
  const p = spawnSync("bash", ["-c", cmd], { timeout: timeoutMs, encoding: "utf8" });
  return (p.stdout ?? "") + (p.stderr ?? "");
}

// r623: structured console-entry parse — only REAL error-level entries count.
function consoleErrors(): number {
  const raw = sh("agent-browser console --json 2>&1", 30000);
  try {
    const parsed = JSON.parse(raw) as {
      data?: { messages?: { level?: string; type?: string }[] };
    };
    const msgs = parsed?.data?.messages;
    if (Array.isArray(msgs)) {
      return msgs.filter((m) => m?.level === "error" || m?.type === "error")
        .length;
    }
  } catch {
    /* --json unavailable or shape changed — fall back to the prefix parse */
  }
  const out = sh("agent-browser console 2>&1", 30000);
  return (out.match(/^\s*\[error\]/gim) ?? []).length;
}

function evalJs(label: string, js: string, timeoutMs = 45000): string {
  const out = sh(`agent-browser eval '${js}' 2>&1`, timeoutMs);
  const last = out.trim().split("\n").filter(Boolean).pop() ?? "";
  return last.replace(/^"|"$/g, "");
}

const results: { leg: string; ok: boolean; detail: string }[] = [];
function record(leg: string, ok: boolean, detail: string) {
  results.push({ leg, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${leg} — ${detail}`);
}

// ── Gate: TypeScript compiles — rc captured UNMASKED (no shell, no pipe) ────
// r621 doctrine: a gate rc must never travel through a pipe. spawnSync()
// without a shell hands us .status directly; a timeout surfaces as null and
// fails the leg (a hung gate is a broken gate).
{
  const tsc = spawnSync("bunx", ["tsc", "--noEmit"], {
    encoding: "utf8",
    timeout: 180000,
  });
  const diag = ((tsc.stdout ?? "") + (tsc.stderr ?? ""))
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 3)
    .join(" | ")
    .slice(0, 200);
  record(
    "tsc gate",
    tsc.status === 0,
    tsc.status === 0 ? "rc=0" : `rc=${tsc.status ?? "timeout"} :: ${diag}`
  );
}

// Fresh document: clears any prior witness residue (fetch patches, pollers).
sh("agent-browser reload >/dev/null 2>&1", 30000);
const baseline = consoleErrors();

// ── Leg 1: Settings -> Model Relay (intel badge + census chip) ──────────────
sh("agent-browser open 'http://localhost:3000/#settings' >/dev/null 2>&1", 30000);
sh("sleep 4", 10000);
sh(`agent-browser eval '(() => { const b=[...document.querySelectorAll("button")].find(x=>/^model relay$/i.test((x.textContent||"").trim())); if(b) b.click(); return b?"clicked":"nav-missing"; })()' >/dev/null 2>&1`, 30000);
sh("sleep 3", 10000);
const leg1 = evalJs("relay-badges", `(() => { const i=document.querySelector("[data-testid=intel-vintage-badge]"); const c=document.querySelector("[data-testid=freellm-census-badge]"); return "intel="+(i?i.textContent.trim():"ABSENT")+" | census="+(c?c.textContent.trim():"ABSENT"); })()`);
const m1 = leg1.match(/intel=([^|]+) \| census=(.+)/);
const ok1 = !!m1 && /snapshot|live|cached|seeding|boards/i.test(m1[1]) && /live|cached|seeding|no census/i.test(m1[2]);
record("leg1 relay badges", ok1, leg1.slice(0, 120));

// ── Leg 2: Radar -> Frontier tab (board renders + internal scroll) ──────────
sh("agent-browser open 'http://localhost:3000/#radar' >/dev/null 2>&1", 30000);
sh("sleep 5", 10000);
sh(`agent-browser eval '(() => { const b=[...document.querySelectorAll("button,[role=tab]")].find(x=>/^frontier/i.test((x.textContent||"").trim())); if(b) b.click(); return b?"clicked":"missing"; })()' >/dev/null 2>&1`, 30000);
sh("sleep 9", 15000);
const leg2 = evalJs("frontier-scroll", `(() => { const e=[...document.querySelectorAll("*")].find(x=>x.clientHeight>120 && x.scrollHeight>x.clientHeight+40 && x.scrollHeight>3000); return e ? ("guard "+e.clientWidth+"x"+e.clientHeight+" sh="+e.scrollHeight) : "NO-GUARD"; })()`);
record("leg2 frontier scroll", leg2.startsWith("guard"), leg2);

// ── Leg 3: Workflows run-panel long-paste (gate honest + queue toast) ───────
sh("agent-browser open 'http://localhost:3000/#workflows' >/dev/null 2>&1", 30000);
sh("sleep 4", 10000);
sh(`agent-browser eval '(() => { const r=[...document.querySelectorAll("button")].find(b=>/^run$/i.test((b.textContent||"").trim()) && !b.closest("[role=dialog]")); if(r) r.click(); return r?"ok":"missing"; })()' >/dev/null 2>&1`, 30000);
sh("sleep 2", 10000);
const leg3 = evalJs("long-paste", `(() => { const d=document.querySelector("[role=dialog]"); if(!d) return "NO-DIALOG"; const t=d.querySelector("textarea"); if(!t) return "NO-TEXTAREA"; const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set; s.call(t,"qa:golden long-paste regression leg: Run stays reachable and the queue reports honestly with a long pasted instruction. "+"Gate padding sentence. ".repeat(4)); t.dispatchEvent(new Event("input",{bubbles:true})); const r=[...d.querySelectorAll("button")].find(b=>/^run/i.test((b.textContent||"").trim())); if(!r) return "NO-RUN"; if(r.disabled) return "GATE-DISABLED"; r.click(); return "PASTED-AND-RUN len="+t.value.length; })()`);
sh("sleep 2", 10000);
const toast = evalJs("queue-toast", `(() => { const t=[...document.querySelectorAll("[role=status],[role=alert],[data-sonner-toast]")].map(e=>(e.textContent||"").trim()).filter(Boolean).join(" | "); return t.slice(0,120) || "NO-TOAST"; })()`);
record("leg3 long-paste", leg3.startsWith("PASTED-AND-RUN") && /queued/i.test(toast), `${leg3} toast=[${toast}]`);

// ── Console: no NEW errors beyond the pre-legs baseline ─────────────────────
const after = consoleErrors();
record("console", after <= baseline, `errors ${baseline} -> ${after} (delta ${after - baseline})`);

const failed = results.filter((r) => !r.ok);
console.log(`\nQA:GOLDEN ${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length} legs green`);
process.exit(failed.length === 0 ? 0 : 1);
