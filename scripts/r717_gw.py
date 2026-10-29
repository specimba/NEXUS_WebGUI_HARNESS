#!/usr/bin/env python3
# r717 gates runner + self-witnessing worklog appender (r709 pattern).
import subprocess, pathlib, sys, re
ROOT = pathlib.Path("/home/z/my-project")
WL = ROOT / "worklog.md"
wl = WL.read_text(encoding="utf-8")
if "Task ID: r717" in wl:
    print("GUARD: r717 section already present — refusing to double-append"); sys.exit(1)

def run(cmd):
    r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    return (r.stdout + ("\n" + r.stderr if r.stderr.strip() else "")).strip(), r.returncode

def read(p):
    f = ROOT / p
    return f.read_text(encoding="utf-8") if f.exists() else ""

# ---- gates ----
fixture_out, fixture_rc = run("bun scripts/qa-gate-census.ts")
cortex_out, cortex_rc = run("bun scripts/qa-cortex-census.ts")
tsc_out, tsc_rc = run("node_modules/.bin/tsc --noEmit")
lint_out, lint_rc = run("bun run lint")
fx = re.search(r"qa-gate-census: (\d+)/(\d+)", fixture_out)
cx = re.search(r"qa-cortex-census: (\d+)/(\d+)", cortex_out)
lint_line = next((l for l in lint_out.splitlines() if "problems" in l), "(no lint summary line)")
gates_ok = (fixture_rc == 0 and fx and fx.group(1) == fx.group(2)
            and tsc_rc == 0 and lint_rc == 0
            and cortex_rc == 0 and cx and cx.group(1) == cx.group(2))
gates_txt = (f"── fixture ──\n{fixture_out}\n── cortex fixtures ──\n{cortex_out}\n"
             f"── tsc ──\ntsc_exit={tsc_rc}\n── lint ──\n{lint_line}\n")
(ROOT / "scripts/qa_r717_gates.txt").write_text(gates_txt, encoding="utf-8")
print(gates_txt)
if not gates_ok:
    print("GATES FAILED — worklog NOT appended, chain aborts"); sys.exit(1)

# ---- FixNote r717 (single-line entry, corrected-anchor doctrine) ----
WF = "src/components/nexus/settings/whats-fixed.tsx"
s = read(WF)
if 'round: "r717"' in s:
    print("SKIP FixNote: r717 already present")
else:
    anchor = 'prints 43/43." },\n];'
    n = s.count(anchor)
    if n != 1:
        print(f"GUARD: FixNote anchor count {n} != 1 — worklog NOT appended"); sys.exit(1)
    entry = ('prints 43/43." },\n'
             '  { round: "r717", title: "The provenance question closed at the evidence\'s edge — and the runs board finally showed its face", '
             'detail: "r716 left the watch\'s baseline provenance open (r712–r714 read 26→31 verdicts; the durable table holds a handful). The probe closed it to the '
             'edge of in-repo evidence: the run-corpus side of the DB is empty except events written since this morning (AutomationRun 0; eval rows only from today\'s '
             'live traffic, which GREW 4→7 mid-round), the tracker side is fully intact (1,373 models), and a .corrupt-backup-r639 sibling documents a prior corruption '
             'recovery — the old population is not in this DB, and whether it died in that recovery or an Owner-side reset is unknowable from the repo. Same round, two '
             'DOM witnesses: the Runs board renders 4 runs with the board ⚖ census chip AND the r715 legend visible for the first time (the u/nj suffixes stay 0 until a '
             'visible run holds an ungated step), and witness attempt #11 (Run-on-server) was honestly refused by the BYOK doctrine — server lane: no key, runs stay '
             'queued, nothing implicit dials.", '
             'lookFor: "Runs board layout: \'4 runs on the board\' + the ⚖ census chip + the ⚖ legend line; the server-autopilot key-status pill explains the queued '
             'runs; scripts/r717_probe.js prints the full table census + db mtime." },\n];')
    s = s.replace(anchor, entry, 1)
    (ROOT / WF).write_text(s, encoding="utf-8")
    print("OK FixNote r717")

# ---- witnesses (self-witnessing) ----
watch = read("scripts/qa_r717_watch.txt")
probe = read("scripts/qa_r717_probe.txt")
browser = read("scripts/qa_r717_browser.txt")
qk = re.search(r'quick_check: (.+)', watch)
wm = re.search(r"WATCH: verdict=(\d+) \(PASS (\d+) / FAIL (\d+)\) · uncertain=(\d+) · nojudge=(\d+)", watch)
if not wm:
    print("watch mapping line not found — refusing a blind worklog"); sys.exit(1)
census_ok = re.search(r'census\\?":true', browser) is not None
relay_ok = re.search(r'relay\\?":true', browser) is not None
aria = "frontier-aria-clicked" if "frontier-aria-clicked" in browser else "ARIA-MISS"
paste = re.search(r"paste-len:(\d+)", browser)
console_block = browser.split("--- console", 1)[-1] if "--- console" in browser else ""
err_classes = sorted(set(re.findall(r"\[(?:error)\] ([^\n]{0,90})", console_block)))
page_errors = browser.split("--- page errors ---")[-1].strip() if "--- page errors ---" in browser else ""
probes = {k: (re.search(rf"^{k}: (\d+)$", probe, re.M).group(1) if re.search(rf"^{k}: (\d+)$", probe, re.M) else "?")
          for k in ("AutomationRun", "EvalEvent", "TrackedModel", "TrackerEvent", "RunReport")}
mtime = re.search(r"custom\.db mtime: (\S+) · size: (\d+)", probe)
backup = "yes" if ".corrupt-backup-r639" in probe else "no"
verdicts, p_, f_, unc, nj = wm.groups()

section = f"""
---
Task ID: r717
Agent: NEXUS patrol (main agent)
Task: Patrol round 717 (job 473388) — the baseline-provenance question closed at the evidence's edge (run-corpus gone, tracker intact, a corruption backup on record), the Runs board DOM-witnessed the r715 legend + board chip, and witness attempt #11 met the BYOK wall doing exactly what it was designed to do
Work Log:
- DB-HEALTH PROBE (standing): quick_check {qk.group(1) if qk else '(see watch file)'} on db/custom.db · root 200 at open · tree clean at r716 (8e0acad6a).
- PROVENANCE CLOSED (the round's named evaluation, scripts/r717_probe.js): AutomationRun={probes['AutomationRun']} · RunReport={probes['RunReport']} · TrackerEvent={probes['TrackerEvent']} · EvalEvent={probes['EvalEvent']} · TrackedModel={probes['TrackedModel']} (tracker side intact) · db mtime {mtime.group(1) if mtime else '?'} · corrupt-backup-r639 sibling: {backup}. The r712–r714 26→31-verdict population is NOT in this DB; whether it died in the r639-era corruption recovery or an Owner-side reset is unknowable from in-repo evidence — disclosed at the edge, watch baseline stays the remapped durable numbers.
- VERDICT-FLOW WATCH: verdict {verdicts} (PASS {p_} / FAIL {f_}) · uncertain {unc} · no-judge {nj} — the corpus GREW 4→7 rows mid-round (+3 confident PASS in ~30 min, the first growth the remapped baseline has caught); uncertain held at 2. Small moves are loud against 7 rows, as designed.
- GOLDEN QA: settings census={census_ok} relay={relay_ok} · radar "{aria}" (first try) · workflows paste-len:{paste.group(1) if paste else '?'} · console class verdict: {"clean (HMR/refresh logs only)" if not err_classes else "ERROR CLASSES: " + "; ".join(err_classes)} · page errors: {page_errors or "none"}.
- RUNS-BOARD DOM WITNESS (r713-carried debt NARROWS): switching to the Runs board layout renders "4 runs on the board" + the board ⚖ census chip + the r715 ⚖ legend — gate:1 legend:1, the r715 ship is DOM-verified at last; the u/nj suffixes read 0 because no visible run holds an ungated step — the remaining gap is exactly one visible run with ungated steps.
- WITNESS ATTEMPT #11 (launch-and-leave, r665/r668 doctrine): the first "Run on server" button was clicked and the panel answered with the BYOK doctrine, verbatim: "server lane: no key — closed-tab runs wait … without a key stored in the Automation vault, runs stay queued (nothing implicit dials)" — the vault-key gate is DOM-witnessed working; no dial, no queue entry, honest refusal. The in-browser palette route is attempt #12's road (a congested free lane makes nj the likeliest first nonzero tone).
- SHIP: (1) the provenance probe persisted (full table census + mtime + db-dir listing — the standing deep-probe beside the watch); (2) the watch's stale "[baseline 31/30/8]" tag refreshed to the remapped truth (the old label was actively misleading in r717 output); (3) FixNote r717.
- GATES: gate-census {fx.group(1) if fx else '?'}/{fx.group(2) if fx else '?'} · cortex {cx.group(1) if cx else '?'}/{cx.group(2) if cx else '?'} · tsc_exit={tsc_rc} · lint {lint_line}
- BUDGET: ~5 rounds — probe+QA batch, launch recon, label+worklog, chain.
Stage Summary:
- The watch's history is now honest end-to-end: pre-remap numbers disclosed as unprovable, the durable baseline live and growing, the legend and board chip seen in DOM, and the server lane's refusal witnessed as designed behavior rather than suspected breakage.
Round Handoff:
Round ID: r718 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js + scripts/r717_probe.js when provenance matters). (2) VERDICT-FLOW WATCH with the live durable baseline: verdict {verdicts} (PASS {p_} / FAIL {f_}) · uncertain {unc} · no-judge {nj}, grown +3 PASS mid-round — if the climb continues, name the workflows/steps the new verdicts land on (the watch prints samples). (3) U/NJ CHIP DOM WITNESS attempt #12: the in-browser palette route (r668 precedent) with a gate-worthy task — a congested free lane makes "no judge answered" (nj) the likeliest first nonzero tone on a VISIBLE run; the board renders chips + legend now, so any nonzero tone lands on a witnessed surface. (4) CORTEX P1 REMAINING (witnesses, not code): real-key UPSTASH 3/3 + HB ✓ DOM witness when the Owner probes with live keys; MIRROR-STRIP witness armed since r707. (5) Owner queue (r693 carry, unchanged): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix (needs Owner's r693 context); optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the provenance closure is the named evaluation, evidence-anchored; the probe + label refresh are the mechanism's own hardening).
"""
WL.write_text(wl + section, encoding="utf-8")
print("worklog: r717 section appended (Task ID guard passed, gates green)")
