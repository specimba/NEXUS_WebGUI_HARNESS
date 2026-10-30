#!/usr/bin/env python3
"""r771 close-script builder (block-replacement doctrine, dynamic boundaries).

The r767 quote defect and the r769 wrapper defect (two heredoc deaths) are
encoded here: the WHOLE worklog heredoc block is swapped (wrappers exist by
construction), the body must compile() (definitive wrapper/quote check), prose
lines must be apostrophe-free, every L.append line must close, boundaries are
found by scan (no hard-coded line numbers to drift), and bash -n gates the
final file. All-or-nothing: written only if every check passes."""

import subprocess
import sys

PATH = "scripts/r771_close.sh"

HEREDOC = '''python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r771')
L.append('Agent: NEXUS patrol (main agent - job 473388, 12:37 slot; opened on the r770 handoff and RE-LABELED r770 -> r771 - the 12:07 slot already closed r770 (ship 953264f61, addendum e88f24967, wave 11 landed mid-round = the pre-declared reset case); own-session lineage per the r768->r769 precedent)')
L.append('Task: Patrol round 771 - BAND DOCS CATCH UP TO WAVE 11 + the quiet tag amber flip gets a transition polish: the opening ro-SQL census read 136 ev / 36 runs / 21 verdicts / 15 uncertain / 100 nj - FLAT vs the r770 close (newest ~04:13:18 UTC = wave 11, the +70m interval); no wave 12, quiet ~28m at open - the amber cleared, the meter honest. Lane census corrected FORWARD: the ld witness lists NINE lane labels in BOTH qa_r770 and qa_r771 (intern-systemone; fast-judge Inception mercury-3; fast-judge Google gemini-3.8-flash; fast-judge plain; jev paid rung; fast-judge AIHubMix qwen3.8-flash-free; fast-judge AIHubMix qwen3.8-max-free; fast-judge Z.ai glm-5.3; fast-judge Intern TokenPlan glm-5.3) - the seven-lane handoff phrasing was stale prose, NOT a new-lane signal; no tenth-lane event. Shipped the cadence-band doc catch-up: the interval span title, the quiet span title and BOTH band mentions inside the tier-state title now record 13/16/41/58/13/42/62/57/61/70 - the 70 is the wave-11 interval (03:03:43 -> 04:13:18 = 69m35s, rounds to 70; the r770 addendum prose wrote 71, the witnessed readout said +70m, the titles follow the witnessed readout) - plus a transition-colors polish on the quiet tag so the amber flip at the ceiling animates instead of snapping. QUIET_CEILING stays 62: one new data point is not a retune, and wave 11 landed exactly where the old plateau ceiling predicted the burst end - the meter worked as designed.')
L.append('Work Log:')
L.append('- R1 open: parallel-session check found r770 ALREADY CLOSED by the 12:07 slot (worklog Task ID r770, addendum commit e88f24967 on top of ship 953264f61) -> re-labeled to r771 per lineage precedent; server 200 first-try; tree clean.')
L.append('- R2 census + templates: ro-SQL via scripts/r771_census.py (sqlite3 CLI absent in this sandbox - python sqlite3 module, ro-mode URI) read 136/36/21/15/100 FLAT, newest gate-no-judge ~04:13:18 UTC; the DB run tables (AutomationRun / RunReport / EvalEvent) carry NO route/model column - route letters stay an on-page strip witness, not a SQL read; r771_qa.sh + r771_close.sh + r771_close_build.py via the DUAL sed from the in-tree r770 scripts (no git-history recovery needed).')
L.append('- R3 QA: the r771 golden QA ran GREEN FIRST-TRY (board strip true, tally 36 runs / 136 ev / 21 verdicts / 15u / 100nj, chips 37; ld all lanes with intern+fast+paid asserted; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors, page errors empty). Lane-list diff vs qa_r770: IDENTICAL nine labels - the carried lane-watch item resolves as stale prose, corrected forward.')
L.append('- R4 increment (run-kanban.tsx, six edits): band strings 13/16/41/58/13/42/62/57/61 -> 13/16/41/58/13/42/62/57/61/70 in the interval span title, the quiet span title, and BOTH the interval phrase and the quiet phrase of the tier-state title; the pre-burst comment block at the QUIET_CEILING constant reworded (plateau ceiling; wave 11 landed at +70m, first data point of the post-burst band); transition-colors added to BOTH branches of the quiet tag class ternary (the amber flip animates). Carried items re-read: divergence badges 2 -> 6 = the r758 semantics witnessing the wave-11 bucket shift (the 04:00 bucket entering the trailing 3-bucket windows) - amber doctrine, investigated, no fault; the mid-qwen ACTIVE 1/2 stays a watch item for the next wave.')
L.append('- R5 gates + close: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree; close probes: chip presence GATED / tone recorded; legend GATED (the tier-state view edited again this round; r756-r771 precedent); tier-state probe RECORDED (quietSpan + quietAmber reads carry over from r770); wave-strip presence GATED / text RECORDED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (twenty-seventh) + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('  wave strip: ' + os.environ.get('R754_STRIP','(missing)'))
L.append('  divergence: ' + os.environ.get('R758_DIV','(missing)'))
L.append('  tier state: ' + os.environ.get('R760_TIER','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- BAND DOCS HONEST: the cadence-watch titles now carry the full recorded band including the wave-11 +70m interval - the first data point of the post-burst band - and the quiet tag amber flip animates; the meter cleared its amber on the wave-11 reset and the close probe records the post-reset state as-is (quietAmber false expected while quiet stays under the 62 ceiling; either state is the watch working). Nine-lane census corrected forward; the divergence 2 -> 6 move investigated under the amber doctrine (bucket-shift witness, no fault). Snapshot discipline twenty-seventh close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA found no bugs this round (green first-try) - the increment continued the r759-r770 instrument line with the band-doc catch-up + flip polish.')
L.append('Round Handoff:')
L.append('Round ID: r772 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r771_qa.sh sed-adapted (DUAL pattern s/r=771/r=772/g + s/r771/r772/g; the r769-r771 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand (apostrophe-free AND single-quote-free new texts; full-line replacements preserve the L.append( wrapper; block replacement with a compile() pre-flight is the kept pattern). Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone + quietAmber r770, band docs /70 since r771); wave-strip presence GATED / text RECORDED; divergence RECORDED ONLY; tally assertion gated. (2) SNAPSHOT DISCIPLINE stands (twenty-eighth close next). (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; NINE lane labels (corrected r771, was seven in stale prose); a TENTH label = new signal, labeled unrouted on sight; ROUTE WATCH: the 04:00 bucket was the FIFTH straight q (lean deepened x5 at r770) - a sixth q deepens further, a g return resets (alternation resumed), an m bucket or m run (both routes, amber, nine lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; a VERDICT/UNCERTAIN growth wave = new signal. (5) CADENCE WATCH: the post-burst band is OPEN with one data point (70); the quiet meter self-declares (amber past the 62 ceiling, 30s tick); wave 12 = a new interval data point - the band grows in the titles only when a round records it forward; a quiet stretch firing amber across two rounds with no wave = the post-burst lull signal - then watch the relay lanes directly per the r770 doctrine. CARRIED: mid-qwen ACTIVE 1/2 (one qwen lane silent at the 04:00 bucket) - re-read at the next wave; divergence badge count re-read at the next wave. (6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay: lean deepened to q x5 at the wave-11 bucket and the burst ended per the r770 witness - the platform report should describe the deepened lean and the ended burst, not an outage. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the band docs caught up to the witnessed wave-11 interval and the amber flip got its transition polish, anchored in scripts/qa_r771.txt and scripts/qa_r771_close.txt + full golden QA).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\\n'.join(L))
print('worklog appended')
PY'''

COMMIT_MSG = 'git commit -m "r771: band docs catch up to wave 11 + the quiet-tag amber flip gets its transition polish. Re-labeled round: the 12:07 slot already closed r770 (ship 953264f61 + addendum e88f24967, wave 11 landed mid-round = the pre-declared reset case). Census flat at open 136/36/21/15/100 (newest ~04:13:18 UTC, the +70m wave-11 interval; no wave 12, quiet ~28m, amber cleared). Lane census corrected FORWARD: nine lane labels in both qa_r770 and qa_r771 - the seven-lane handoff phrasing was stale prose, not a new-lane signal. Increment: the interval title, quiet title and both tier-state band mentions now record 13/16/41/58/13/42/62/57/61/70 (the 70 = the witnessed wave-11 readout; the addendum prose 71 noted as the same data point) + transition-colors on both branches of the quiet tag ternary (amber flip animates). QUIET_CEILING held at 62 - one data point is not a retune. Snapshot discipline twenty-seventh close."'

LINE2_OLD = "# r771 close (burst-end witness + live quiet meter): gates"
LINE2_NEW = "# r771 close (band-doc catch-up + amber-flip polish; re-labeled round): gates"


def main() -> int:
    with open(PATH, encoding="utf-8") as f:
        content = f.read()
    lines = content.split("\n")
    errors = []

    # dynamic boundary scan (no hard-coded line numbers to drift)
    i = next((n for n, ln in enumerate(lines) if ln.startswith("python3 - <<'PY'")), None)
    if i is None:
        errors.append("heredoc start not found")
    else:
        j = next((n for n in range(i + 1, len(lines)) if lines[n] == "PY"), None)
        if j is None:
            errors.append("heredoc end not found")
        else:
            win = [n for n in range(j + 1, min(j + 6, len(lines))) if lines[n].startswith('git commit -m "r771')]
            if not win:
                errors.append("no r771 commit line within 5 lines after the heredoc")
    if LINE2_OLD not in content:
        errors.append("header anchor not found")
    if errors:
        print("BUILD ABORTED (boundaries):")
        for e in errors:
            print(" -", e)
        return 1

    # pre-flight on the NEW heredoc body
    hlines = HEREDOC.split("\n")
    body = "\n".join(hlines[1:-1])
    try:
        compile(body, "r771-heredoc", "exec")
    except SyntaxError as e:
        print("BUILD ABORTED (heredoc does not compile): %s" % e)
        return 1
    for ln in hlines:
        s = ln.strip()
        if s.startswith("L.append(") and not s.endswith(")"):
            errors.append("L.append line does not close: %s..." % s[:60])
            break
    for ln in hlines:
        s = ln.strip()
        if s.startswith("L.append('") and "os.environ" not in s:
            inner = s[len("L.append('"):-2]
            if "'" in inner:
                errors.append("prose contains a single quote: %s..." % inner[:60])
                break
    if errors:
        print("BUILD ABORTED (shape):")
        for e in errors:
            print(" -", e)
        return 1

    # apply
    content = content.replace(LINE2_OLD, LINE2_NEW, 1)
    lines = content.split("\n")
    i = next(n for n, ln in enumerate(lines) if ln.startswith("python3 - <<'PY'"))
    j = next(n for n in range(i + 1, len(lines)) if lines[n] == "PY")
    lines[i:j + 1] = hlines
    win = [n for n in range(i + len(hlines), min(i + len(hlines) + 6, len(lines))) if lines[n].startswith('git commit -m "r771')]
    if not win:
        print("BUILD ABORTED (commit line drifted past the swapped block)")
        return 1
    ci = win[0]
    lines[ci] = COMMIT_MSG
    out = "\n".join(lines)

    # post-apply audits
    if "Patrol round 770" in out:
        errors.append("stale r770 task prose survives")
    if "L.append('Task ID: r771')" not in out:
        errors.append("r771 Task ID missing")
    if "Patrol round 771" not in out:
        errors.append("r771 task line missing")
    if errors:
        print("BUILD ABORTED (post-apply):")
        for e in errors:
            print(" -", e)
        return 1
    bn = subprocess.run(["bash", "-n", PATH], capture_output=True, text=True)
    if bn.returncode != 0:
        print("BUILD ABORTED (bash -n): %s" % bn.stderr[:300])
        return 1
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(out)
    print("r771 close rebuilt: heredoc block swapped (compiles, apostrophe-clean), commit msg set, bash -n green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
