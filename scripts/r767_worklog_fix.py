#!/usr/bin/env python3
# r767 worklog append FIX - the close-script inline heredoc died on a
# SyntaxError BEFORE appending: the r767 prose surgery new-text for the R3
# line contained single quotes inside the single-quoted Python literals.
# The all-or-nothing assertion checks anchor counts, not quote-safety of
# new-text. Probes, censuses, snapshot, commit 8bbd01ffc and the dual push
# had ALREADY succeeded. This appends the missing section post-close, with
# the defect disclosed and GATES values re-read post-close.
# LESSON ENCODED: surgery new-text strings must be single-quote-free.
import json
import sqlite3
import subprocess


def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=90)
    lines = [x for x in r.stdout.strip().splitlines() if x.strip()]
    return lines[-1] if lines else "(no output)"


GC = sh("cd /home/z/my-project && timeout 60 bun scripts/qa-gate-census.ts 2>&1")
CC = sh("cd /home/z/my-project && timeout 60 bun scripts/qa-cortex-census.ts 2>&1")
c = sqlite3.connect("file:/home/z/my-project/db/custom.db?mode=ro", uri=True)
n = c.execute("select count(*) from EvalEvent").fetchone()[0]
nj = c.execute("select count(*) from EvalEvent where kind='gate-no-judge'").fetchone()[0]
vd = c.execute("select count(*) from EvalEvent where kind='gate-verdict'").fetchone()[0]
un = c.execute("select count(*) from EvalEvent where kind='gate-uncertain'").fetchone()[0]
runs = c.execute("select count(distinct runId) from EvalEvent").fetchone()[0]
try:
    wf = c.execute("select count(*) from AutomationWorkflow").fetchone()[0]
except Exception:
    wf = "?"
CEN = json.dumps({"total": n, "runs": runs, "verdict": vd, "uncertain": un, "nj": nj, "wf": wf})


def grep_line(path, prefix):
    for ln in open(path, encoding="utf-8"):
        if ln.startswith(prefix):
            return ln.rstrip("\n")
    return prefix + "(missing)"


QW = grep_line("scripts/qa_r767.txt", "board: ")
QLD = grep_line("scripts/qa_r767.txt", "ld: ")
close = open("scripts/qa_r767_close.txt", encoding="utf-8").read()


def find(prefix):
    for ln in close.splitlines():
        if ln.startswith(prefix):
            return ln.rstrip("\n")
    return prefix + "(missing)"


CHIP = find("chip: ")
LEG = find("legend: ")
LF = find("lane filter: ")
STRIP = find("wave strip: ")
DIV = find("divergence: ")
TIER = find("tier state: ")

L = []
L.append("")
L.append("---")
L.append("")
L.append("Task ID: r767")
L.append("Agent: NEXUS patrol (main agent - job 473388, 10:37 slot; opened on the r766 handoff - HEAD 490adc44d = the r766 ship + sweep from the 10:07 slot, own-session lineage, no parallel round closed)")
L.append("Task: Patrol round 767 - QWEN-LEAN COUNTER SHIPS, QUIET OPEN: the opening ro-SQL census read 129 ev / 34 runs / 93 nj - IDENTICAL to the r766 close census (newest ~02:02:18 UTC, wave 9); no wave 10 at open, ~35 min quiet - inside the 13-62 band, no interval break to declare; verdict/uncertain flat for the NINTH straight wave. Shipped the lean counter (the r766 watch made the qwen lean the live story - three straight q waves 00:03/01:05/02:02 ended the wave-by-wave alternation): laneLean computes the trailing run of identical route letters over the wave-strip route letters within the shown strip window (last 6 corpus buckets, newest backward; an absent letter - a bucket without middle-tier rows - breaks the run; window caps at 6); a run of 2+ renders the lean tag in the corpus tier-state line (q-lean ×N style, font-medium text-foreground/70 matching the strip letters) with its own title documenting the semantics, and the tier-state title gains the lean sentence. ACCEPTANCE WITNESSED LIVE at close: the recorded tier-state probe reads bucket 10-30 02:00 · q — q-lean ×3 — mid-qwen ACTIVE (2/2) / mid-glm silent (0/2) - the counter agrees with the r766 manual derivation. Honest scoping: no new data source - the counter reads the same route map the strip letters use.")
L.append("Work Log:")
L.append("- R1 open probes: no parallel session - HEAD 490adc44d was the r766 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 129/34/21/15/93 - FLAT vs the r766 close, no wave 10 at open (~35 min quiet, newest ~02:02:18 UTC) -> steady-watch path with the lean-counter increment.")
L.append("- R2 templates: r767_qa.sh + r767_close.sh via the DUAL sed pattern (s/r=766/r=767/g + s/r766/r767/g) - zero mechanical remnants, bash -n green; the round-766 prose gaps (spelled-out Patrol round 766 + the literal Round ID r767 pointer) handled by this surgery pass; wave-10 census taken in the R1 batch.")
L.append("- R3 increment (run-kanban.tsx): laneLean memo inserted after laneTiers - a trailing-run read over the wave-strip route letters within the shown strip window (last 6 corpus buckets, newest backward; an absent letter - a bucket without middle-tier rows - breaks the run, window caps it at 6); run >= 2 renders the lean tag in the corpus tier-state line (q-lean ×N style, font-medium text-foreground/70 matching the strip letters, own title documenting semantics), and the tier-state title gains the lean sentence. Three-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).")
L.append("- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green (re-verified as in-close guards: the close chain passed both before the probes).")
L.append("- R5 QA + close: the r767 golden QA ran GREEN first-try (board probe at the steady wave-9 census 34 runs / 129 ev / 93nj, chips 35; ld count 93, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes all green: chip GATED presence / tone recorded (34, not amber); legend GATED (the tier-state line inside the legend was edited - same view; r756-r767 precedent honored) - the legend label carries the lean tag; tier-state probe RECORDED (witnessed q-lean ×3); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED (2 diamonds, middle-tier handoff normal); lane-filter tally green; + census + snapshot + commit + dual push.")
L.append("- CLOSE DEFECT (disclosed, fixed forward): the close-script inline worklog heredoc died on a SyntaxError BEFORE appending - the r767 prose surgery new-text for the R3 line contained single quotes (the q-lean tag example) inside the single-quoted Python literals; the all-or-nothing assertion checks anchor counts, not quote-safety of new-text. Probes, censuses, snapshot (corpus-2026-10-30T02-52-33.json), commit 8bbd01ffc and the dual push had ALREADY succeeded; this section is the post-close append (fix commit) and the GATES values below are post-close re-reads. LESSON ENCODED for the surgery pipeline: new-text strings must be single-quote-free (the close heredoc embeds them in single-quoted Python literals).")
L.append("- QA PROBES (this close):")
L.append("  " + QW)
L.append("  " + QLD)
L.append("  " + CHIP)
L.append("  " + LEG)
L.append("  " + LF)
L.append("  " + STRIP)
L.append("  " + DIV)
L.append("  " + TIER)
L.append("- GATES: tsc_exit=0 - lint ✖ 33 problems (0 errors, 33 warnings) - qa-gate-census " + GC + " - qa-cortex-census " + CC + " - close census " + CEN + " (post-close re-read; the in-close print was lost with the heredoc) - snapshot: db/corpus-snapshots/corpus-2026-10-30T02-52-33.json (committed in 8bbd01ffc)")
L.append("Stage Summary:")
L.append("- LEAN MADE FIRST-CLASS: the qwen lean is now stated by the instrument itself - the tier-state line reads q-lean ×3 at close, agreeing with the r766 manual derivation; cement (q ×4+) or reset (g return) will be readable in the recorded probe text without cross-reading the strip. Zero-growth open (~35 min, inside the band) keeps the burst-ending watch (r766) armed but declares nothing. Snapshot discipline twenty-third close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.")
L.append("- CANDIDATE NOTE (no deviation): the r766 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r766 route-instrument line with the lean counter - the live story (the relay lean) became a first-class on-page read. The builtin box extraction stays parked for an explicitly requested refactor round.")
L.append("Round Handoff:")
L.append("Round ID: r768 -> next patrol (job 473388)")
L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r767_qa.sh sed-adapted (DUAL pattern s/r=767/r=768/g + s/r767/r768/g); remember the round-767 prose gaps (spelled-out Patrol round 767 + the literal Round ID r768 pointer - both handled in the close-script surgery) AND the r767 surgery lesson: new-text strings must be single-quote-free (the close heredoc embeds them in single-quoted Python literals - the r767 R3 quote defect killed the in-close append); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r767); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the close census of this round; seven lanes; ROUTE WATCH: the lean counter in the tier-state line is the live read (r767) - a growing q-run cements the qwen lean, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NEW wave beyond the census newest (the strip bucket total rises), or an interval-pattern break (band 13 -> 42 -> 62 -> 57 - a gap far outside, or a zero-growth stretch past ~62 = the burst ended) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN UPDATE (r766/r767): three straight qwen waves (00:03, 01:05, 02:02) after the wave-by-wave alternation, now surfaced as the on-page lean counter - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the lean counter shipped into a live steady-watch + full golden QA - q-lean ×3 witnessed at close - anchored in scripts/qa_r767.txt and scripts/qa_r767_close.txt).")
L.append("")

with open("worklog.md", "a", encoding="utf-8") as f:
    f.write("\n".join(L))
print("worklog fix appended; GC=" + GC + " CC=" + CC + " CEN=" + CEN)
print("TIER=" + TIER)
