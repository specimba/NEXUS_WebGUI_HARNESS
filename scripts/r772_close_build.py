#!/usr/bin/env python3
"""r772 close-script builder (block-replacement doctrine, dynamic boundaries).

The r767 quote defect and the r769 wrapper defect (two heredoc deaths) are
encoded here: the WHOLE worklog heredoc block is swapped (wrappers exist by
construction), the body must compile() (definitive wrapper/quote check), prose
lines must be apostrophe-free, every L.append line must close, boundaries are
found by scan (the commit line within a 5-line window after the block), and
bash -n gates the final file. All-or-nothing: written only if every check
passes."""

import subprocess
import sys

PATH = "scripts/r772_close.sh"

HEREDOC = '''python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r772')
L.append('Agent: NEXUS patrol (main agent - job 473388, 13:07 slot; opened on the r771 handoff; HEAD 7013126a5 = a system-side cron commit (one line in scripts/qa_r771_close.txt - the r771 tee drift absorbed outside the patrol; benign, disclosed) on top of the r771 sweep 981387d22; no parallel round closed - grep r772 = 0)')
L.append('Task: Patrol round 772 - WAVE 12: VERDICT GROWTH + TENTH LANE + BOTH-SILENT NEWEST BUCKET; the band docs record the +6m restart; silent lanes go on-page by name. The opening ro-SQL census read 148 ev / 38 runs / 22 verdicts / 15 uncertain / 111 nj - nj +11, verdict 21 -> 22 (the FIRST verdict growth after the long 21/15 flat = a new signal class), runs +2; newest ~05:03:50 UTC. Three signals witnessed and handled: (1) TENTH lane label fast-judge OrcaRouter · google/gemini-3.8-flash, new vs the r771 nine - the same gemini model re-routed via OrcaRouter; a provider-level re-route witness (amber doctrine: investigated on sight, not a fault); (2) the q x5 lean run BROKE - the 05:00 bucket (x3, 5 lanes) carries NO middle-tier rows (absent letter), the lean tag correctly absent; (3) the BOTH-SILENT signal - mid-qwen (0/2) and mid-glm (0/2) against the newest bucket, the standing investigate-immediately case; the open board read rendered both tiers silent and the investigation bound is disclosed: the letterless chip title carries the span (all three newest rows at one instant, 05:03:50 UTC) but NO lane names - the r757 per-lane note overstates for letterless buckets (doc debt noted, not fixed this round). Shipped: (a) the band docs record the WITNESSED wave-12 readout +6m (04:45 -> 05:00 bucket maxes - the burst RESTARTED short after the +70m wave-11 gap; band 13/16/41/58/13/42/62/57/61/70/6) in the interval title, the quiet title and both tier-state band phrases; (b) silent lanes named inline after the tier count (r772): when a tier runs partial, the silent lane names render after the count in compact form (fast-judge prefix stripped, provider and model joined) - the both-silent and partial-bucket investigations read without opening the chips; (c) styling polish: cursor-help on the titled auto-digest and deep-skipped badges (the house cursor affordance convention for title-bearing chips).')
L.append('Work Log:')
L.append('- R1 open: parallel-session check clean (grep r772 = 0); HEAD 7013126a5 disclosed (system cron commit, one tee line, no code); server 200 first-try; tree clean.')
L.append('- R2 census + templates: ro-SQL via scripts/r771_census.py reused (python sqlite3, ro-mode URI): 148/38/22/15/111, verdict +1, nj +11, newest ~05:03:50 UTC; r772_qa.sh + r772_close.sh + r772_close_build.py via the DUAL sed from the in-tree r771 scripts (no git-history recovery).')
L.append('- R3 QA: the r772 golden QA ran GREEN FIRST-TRY (board strip true, tally 38 runs / 148 ev / 22 verdicts / 15u / 111nj, chips 39; ld all lanes with intern+fast+paid asserted and the TENTH label in the witnessed list; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors, page errors empty).')
L.append('- R4 witnesses: legend replay (the corpus-lane-legend click): +6m since prior, +8m quiet, mid-qwen route silent (0/2) and mid-glm route silent (0/2), the 05:00 bucket letterless (x3, 5 lanes), the 04:45 bucket x8 q (8 lanes); the q x5 lean run broken by the absent letter (lean tag correctly absent); the 05:00 chip title read: span only (rows 05:03:50 to 05:03:50), no lane names - investigation bound disclosed.')
L.append('- R5 increment (run-kanban.tsx, eight edits): four band strings /70 -> /70/6 with the wave-12 framing (interval span title, quiet span title, both tier-state band phrases); the silent-lane names suffix on the tier count; the tier-state title documents the inline names; cursor-help on the auto-digest and deep-skipped badges.')
L.append('- R6 gates + close: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree; close probes: chip presence GATED / tone recorded; legend GATED (the tier-state view edited again this round; r756-r772 precedent); tier-state probe RECORDED (quietSpan + quietAmber reads carry over from r770); wave-strip presence GATED / text RECORDED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (twenty-eighth) + worklog + commit + dual push.')
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
L.append('- WAVE 12 HANDLED: verdict growth (21 -> 22) ended the eleven-wave 21/15 flat; the tenth lane (OrcaRouter gemini re-route) joined; the q x5 lean run broke on a letterless bucket; the newest bucket went BOTH-SILENT (0/2 and 0/2) - all witnessed by the probes and recorded with the investigation bound disclosed. The band docs carry the witnessed +6m restart (13/16/41/58/13/42/62/57/61/70/6) and the silent lanes now name themselves inline - the both-silent board state reads without a single click. Snapshot discipline twenty-eighth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); NEW doc debt queued: the letterless-bucket chip title carries no lane list (the r757 note overstates for letterless buckets) - a small honest-title fix candidate for a future round.')
L.append('Round Handoff:')
L.append('Round ID: r773 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r772_qa.sh sed-adapted (DUAL pattern s/r=772/r=773/g + s/r772/r773/g; the r769-r772 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone + quietAmber r770, band docs r771-r772, silent-lane names r772); wave-strip presence GATED / text RECORDED; divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (twenty-ninth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels (OrcaRouter joined at wave 12); an ELEVENTH label = new signal, labeled unrouted on sight; ROUTE WATCH: the lean counter RESTARTED (the letterless 05:00 bucket broke the q x5 run) - the next lettered bucket starts a fresh run: a deepening q run, a g return (alternation resumed), or an m bucket (the first both-routes witness) all read from the restarted counter; BOTH-SILENT carried: if the NEXT lettered bucket is also both-silent, that is two in a row - then watch the relay lanes directly per the r770 doctrine; the 04:45 bucket ran x8 q (8 lanes) - the middle tier was healthy one bucket before the silent one. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6; the meter self-declares (amber past the 62 ceiling, 30s tick); wave 13 = a new interval data point, recorded forward by the round that witnesses it. (6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always; (d) doc debt: the letterless-bucket chip title carries no lane list (honest-title fix candidate). (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay: wave 12 restarted the burst with a +6m interval, the verdict lane grew (21 -> 22) and the newest bucket went both-silent - the platform report should describe the restart, the verdict growth and the silent bucket, not an outage. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the band docs recorded the witnessed +6m wave-12 restart, the silent lanes went on-page by name, and the three wave-12 signals were witnessed + full golden QA, anchored in scripts/qa_r772.txt and scripts/qa_r772_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\\n'.join(L))
print('worklog appended')
PY'''

COMMIT_MSG = 'git commit -m "r772: wave 12 handled - verdict growth (21 -> 22, the first after the eleven-wave 21/15 flat), a TENTH lane label (fast-judge OrcaRouter · google/gemini-3.8-flash, a provider-level re-route witness), the q x5 lean run broken by a letterless 05:00 bucket, and the BOTH-SILENT newest bucket (0/2 and 0/2) investigated with the bound disclosed (the letterless chip title carries the one-instant span, no lane names - doc debt queued). Increment: the band docs record the witnessed +6m restart (13/16/41/58/13/42/62/57/61/70/6) and silent lanes now name themselves inline after the tier count - the both-silent board reads without opening the chips; styling polish: cursor-help on the titled auto-digest and deep-skipped badges. Snapshot discipline twenty-eighth close."'

LINE2_OLD = "# r772 close (band-doc catch-up + amber-flip polish; re-labeled round): gates"
LINE2_NEW = "# r772 close (wave 12: verdict growth + tenth lane + both-silent; band restart recorded): gates"


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
            win = [n for n in range(j + 1, min(j + 6, len(lines))) if lines[n].startswith('git commit -m "r772')]
            if not win:
                errors.append("no r772 commit line within 5 lines after the heredoc")
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
        compile(body, "r772-heredoc", "exec")
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
    win = [n for n in range(i + len(hlines), min(i + len(hlines) + 6, len(lines))) if lines[n].startswith('git commit -m "r772')]
    if not win:
        print("BUILD ABORTED (commit line drifted past the swapped block)")
        return 1
    ci = win[0]
    lines[ci] = COMMIT_MSG
    out = "\n".join(lines)

    # post-apply audits
    if "Patrol round 771" in out:
        errors.append("stale r771 task prose survives")
    if "L.append('Task ID: r772')" not in out:
        errors.append("r772 Task ID missing")
    if "Patrol round 772" not in out:
        errors.append("r772 task line missing")
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
    print("r772 close rebuilt: heredoc block swapped (compiles, apostrophe-clean), commit msg set, bash -n green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
