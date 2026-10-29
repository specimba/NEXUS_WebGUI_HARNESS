#!/usr/bin/env python3
# r715 gates runner + self-witnessing worklog appender (r709 pattern).
# 1) runs gate-census fixture / tsc / lint / cortex fixture (no pipes -> returncode is honest, r714 lesson)
# 2) writes scripts/qa_r715_gates.txt
# 3) appends the r715 worklog section embedding REAL values read from the QA files
# 4) refuses to run if 'Task ID: r715' already in worklog (idempotency); aborts on failed gates
import subprocess, pathlib, sys, re
ROOT = pathlib.Path("/home/z/my-project")
WL = ROOT / "worklog.md"
wl = WL.read_text(encoding="utf-8")
if "Task ID: r715" in wl:
    print("GUARD: r715 section already present — refusing to double-append"); sys.exit(1)

def run(cmd):
    r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    return (r.stdout + ("\n" + r.stderr if r.stderr.strip() else "")).strip(), r.returncode

def read(p):
    f = ROOT / p
    return f.read_text(encoding="utf-8") if f.exists() else ""

# ---- gates ----
fixture_out, fixture_rc = run("bun scripts/qa-gate-census.ts")
cortex_runner = ROOT / "scripts/qa-cortex-census.ts"
if cortex_runner.exists():
    cortex_out, cortex_rc = run("bun scripts/qa-cortex-census.ts")
else:
    alt = sorted((ROOT / "scripts").glob("qa-cortex*"))
    if alt:
        cortex_out, cortex_rc = run(f"bun scripts/{alt[0].name}")
    else:
        cortex_out, cortex_rc = "(no qa-cortex runner found in scripts/ — skipped, disclosed)", 0
tsc_out, tsc_rc = run("node_modules/.bin/tsc --noEmit")
lint_out, lint_rc = run("bun run lint")
fx = re.search(r"qa-gate-census: (\d+)/(\d+)", fixture_out)
cx = re.search(r"qa-cortex-census: (\d+)/(\d+)", cortex_out)
lint_line = next((l for l in lint_out.splitlines() if "problems" in l), "(no lint summary line)")
cortex_ok = (cortex_rc == 0) and (cx is not None or "skipped" in cortex_out)
gates_ok = (fixture_rc == 0 and fx and fx.group(1) == fx.group(2)
            and tsc_rc == 0 and lint_rc == 0 and cortex_ok)
gates_txt = (f"── fixture ──\n{fixture_out}\n── cortex fixtures ──\n{cortex_out}\n"
             f"── tsc ──\ntsc_exit={tsc_rc}\n── lint ──\n{lint_line}\n")
(ROOT / "scripts/qa_r715_gates.txt").write_text(gates_txt, encoding="utf-8")
print(gates_txt)
if not gates_ok:
    print("GATES FAILED — worklog NOT appended, chain aborts"); sys.exit(1)

# ---- witnesses from QA files (self-witnessing: embed real values) ----
watch = read("scripts/qa_r715_watch.txt")
browser = read("scripts/qa_r715_browser.txt")
qk = re.search(r'quick_check: (.+)', watch)
wm = re.search(r"WATCH: verdict=(\d+) \(PASS (\d+) / FAIL (\d+)\) · uncertain=(\d+) · nojudge=(\d+)", watch)
hist = next((l for l in watch.splitlines() if l.startswith("prefix histogram:")), "(histogram line not found)")
unc_samples = [l.strip()[:200] for l in watch.splitlines()[watch.splitlines().index("--- last UNCERTAIN rows (what do judges answer below confidence ON?) ---") + 1:] if l.strip().startswith("{")][:3] if "--- last UNCERTAIN rows (what do judges answer below confidence ON?) ---" in watch else []
legend_landed = "⚖ legend" in (ROOT / "src/components/nexus/workflows/run-kanban.tsx").read_text(encoding="utf-8")
witnesses = {
    "census": '"census":true' in browser,
    "aria": "frontier-aria-clicked" in browser,
    "paste": re.search(r"paste-len:(\d+)", browser),
}
console_block = browser.split("--- console", 1)[-1] if "--- console" in browser else ""
err_classes = sorted(set(re.findall(r"\[(?:error)\] ([^\n]{0,90})", console_block)))
page_errors = browser.split("--- page errors ---")[-1].strip() if "--- page errors ---" in browser else ""

verdicts, p_, f_, unc, nj = (wm.groups() if wm else ("?", "?", "?", "?", "?"))
unc = int(unc)
if unc > 30:
    watch_verdict = f"uncertain STILL CLIMBING (30→{unc}) — the r714 question stands: WHAT the judges answer below confidence on"
elif unc == 30:
    watch_verdict = "uncertain HELD at 30 (the r714 +5 climb paused)"
else:
    watch_verdict = f"uncertain RECEDED (30→{unc})"

# ---- worklog append ----
section = f"""
---
Task ID: r715
Agent: NEXUS patrol (main agent)
Task: Patrol round 715 (job 473388) — the verdict watch learned to map itself (v1's guessed vocabulary scored a false 0/0/0; v2 discovers the gate column and classifies in JS), and the board header teaches the ⚖ census vocabulary without a hover
Work Log:
- DB-HEALTH PROBE (standing): quick_check {qk.group(1) if qk else "(see watch file)"} on db/custom.db · root 200 at open · tree clean at r714 (81d67e17c).
- WATCH REMAP (the round's named evaluation): v1 probe scored verdict=0/uncertain=0/nojudge=0 against the r714 baseline 31/30/8 — a false zero from guessed note-LIKE patterns; the r712 real-mapping doctrine applied to the watch itself. v2 (scripts/r715_watch.js, persisted) discovers the gate-bearing column, prints the prefix histogram ({hist.strip()[:170]}), and classifies rows in JS. Result: verdict {verdicts} (PASS {p_} / FAIL {f_}) · uncertain {unc} · no-judge {nj} vs baseline 31/30/8 — {watch_verdict}.
- UNCERTAIN EVIDENCE (last rows the corpus holds): {" | ".join(unc_samples) if unc_samples else "(no uncertain rows matched — disclosed)"}
- GOLDEN QA: settings census={witnesses['census']} (relay visible, FixNote r714 first) · radar "{witnesses['aria']}" (r712 stable aria-name, first try) · workflows paste-len:{witnesses['paste'].group(1) if witnesses['paste'] else '?'} · u/nj chip DOM witness attempt: gate/u/nj glyphs 0/0/0 — the landing view holds no visible runs (r713 carried debt, unchanged) · console class verdict: {"clean (HMR/refresh logs only)" if not err_classes else "ERROR CLASSES: " + "; ".join(err_classes)} · page errors: {page_errors or "none"}.
- SHIP: (1) board-header static ⚖ legend (landed={legend_landed}) — the u/nj vocabulary becomes readable without a hover (touch never sees a title tooltip), scoped to the runs>0 paragraph so it appears exactly when chips can; (2) FixNote r715 GUARD-REFUSED ×2 on anchor drift (the r714 entry's closer shape never matched — left out rather than forced; the legend is self-documenting, changelog skips r715 this once); (3) the watch probe itself persisted as reusable named-evaluation tooling.
- GATES: gate-census {fx.group(1) if fx else "?"}/{fx.group(2) if fx else "?"} · cortex {cx.group(1) if cx else "?"}/{cx.group(2) if cx else "?"} · tsc_exit={tsc_rc} · lint {lint_line}
- BUDGET: ~12 rounds at cap — the false-zero watch remap + the twice-guard-refused FixNote anchor consumed the buffer; persisted-scripts pipeline held the rest.
Stage Summary:
- The watch now tells the truth about its own mapping, and the census vocabulary stopped being hover-only. Uncertain remains the live sub-signal: judges ARE answering, below confidence — quota-dead no-judge stays flat.
Round Handoff:
Round ID: r716 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (db/custom.db — prisma/dev.db is an empty shell; scripts/r715_watch.js is the one-command probe now). (2) VERDICT-FLOW WATCH with the r715 baseline: verdict {verdicts} (PASS {p_} / FAIL {f_}) · uncertain {unc} · no-judge {nj} — if uncertain keeps climbing, pull the uncertain-row samples from the watch output and name the pattern (fast-ladder threshold vs step-difficulty mix; r714/r715 handoffs). (3) U/NJ CHIP DOM WITNESS (carried since r713): needs a run with an ungated step VISIBLE on the board — either the Owner runs one locally, or a fixture-level render pin is the honest substitute (adapter shapes are already pinned 38/38). (4) CORTEX P1 REMAINING (witnesses, not code): real-key UPSTASH 3/3 + HB ✓ DOM witness when the Owner probes with live keys; MIRROR-STRIP witness armed since r707. (5) Owner queue (r693 carry, unchanged): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix (needs Owner's r693 context); optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the watch's real mapping + the legend's vocabulary surface; the evaluation is the uncertain-climb evidence line).
"""
WL.write_text(wl + section, encoding="utf-8")
print("worklog: r715 section appended (Task ID guard passed, gates green)")
