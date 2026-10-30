#!/usr/bin/env python3
"""r770 close-script builder (block-replacement doctrine).

After the r767 quote defect and the r769 wrapper defect (two heredoc deaths),
this builder swaps the WHOLE worklog-heredoc block (python3 - <<'PY' .. PY)
instead of splicing individual L.append lines - wrappers exist by construction.
Post-build gates: bash -n, compile() of the extracted heredoc body (the
definitive wrapper/quote check), zero r769 remnants, and boundary asserts.
All-or-nothing: the file is written only if every check passes."""

import sys

PATH = "scripts/r770_close.sh"

HEREDOC = '''python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r770')
L.append('Agent: NEXUS patrol (main agent - job 473388, 12:07 slot; opened on the r769 handoff - HEAD 8811b25cb = the r769 terminal sweep, own-session lineage, no parallel round closed)')
L.append('Task: Patrol round 770 - BURST-END SIGNAL WITNESSED, QUIET METER GOES LIVE: the opening ro-SQL census read 133 ev / 35 runs / 97 nj - FLAT vs the r769 close (newest ~03:03:43 UTC = wave 10); no wave 11, quiet 64m at open - PAST the ~62 ceiling of the recorded band (13-42-62-57-61), the burst-end signal condition FIRST MET at open; verdict/uncertain flat 21/15 for the eleventh straight wave; lean CEMENTED q x4 held. Shipped the live quiet meter: the quiet value re-ticks every 30s while the board is open (a tick state driven by a 30s setInterval with cleanup in the mount effect, added to the laneQuiet deps) so the staleness readout stays honest on a quiet board - the exact scenario it monitors - and past the QUIET_CEILING constant (62, the recorded band max) the quiet tag takes the amber signal tone (text-amber-600 dark:text-amber-400, the house amber) - the burst-ended witness, same convention as the divergence diamonds, a signal not a fault; the span title and the tier-state title document the tick and the tone. The close tier-state probe gains a quietAmber read (the quiet span class) so the burst-end witness is a probe witness. Honest scoping: no new data source; the ceiling constant is the recorded band max, not a new threshold.')
L.append('Work Log:')
L.append('- R1 open probes: no parallel session - HEAD 8811b25cb = the r769 terminal sweep (own-session lineage); tree clean; server 200; ro-SQL census 133/35/21/15/97 FLAT, quiet 64m at open - past the ~62 ceiling = the burst-end signal condition met -> burst-end-witness path with the live-quiet-meter increment.')
L.append('- R2 templates: r770_qa.sh + r770_close.sh via the DUAL sed pattern (s/r=769/r=770/g + s/r769/r770/g) from the IN-TREE r769 scripts (no git-history recovery needed this round) - zero mechanical remnants, bash -n green; the close heredoc rebuilt by BLOCK replacement (the whole python3 heredoc swapped, wrappers by construction) with a compile() pre-flight check - the definitive wrapper/quote gate after the r767 and r769 heredoc deaths.')
L.append('- R3 increment (run-kanban.tsx): quietTick state + a 30s setInterval in the mount effect (clearInterval cleanup) added to the laneQuiet deps, so the quiet value re-ticks every 30s while the board is open; QUIET_CEILING = 62 (the recorded band max) and the quiet span takes the amber signal tone (text-amber-600 dark:text-amber-400) when laneQuiet exceeds it, defaulting back to the strip-letter treatment below the ceiling; the span title and the tier-state title document the tick and the tone. Four-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree.')
L.append('- R5 QA + close: the r770 golden QA ran GREEN (board probe at the wave-10 steady census, chips per the artifact; ld seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (the tier-state line inside the legend was edited - same view; r756-r770 precedent honored); tier-state probe RECORDED with the NEW quietAmber read (the quiet span class - amber expected while the quiet stretch holds, a wave 11 landing would clear it; either outcome is the watch working); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; lane-filter tally assertion gated-run; census + snapshot + worklog + commit + dual push.')
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
L.append('- BURST-END ON-PAGE: the burst-end signal condition was met at open (quiet 64m, past the ~62 ceiling, census flat) and the instrument now states it live - the quiet meter re-ticks every 30s and takes the amber signal tone past the ceiling, so the end of the wave burst is a recorded probe witness (quietAmber) without cross-reading the strip or the census. A new wave resets the meter and clears the amber automatically - the watch works both ways. Snapshot discipline twenty-sixth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the r769 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r769 instrument line with the live quiet meter - the burst-end watch became a self-declaring on-page signal. The builtin box extraction stays parked for an explicitly requested refactor round.')
L.append('Round Handoff:')
L.append('Round ID: r771 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r770_qa.sh sed-adapted (DUAL pattern s/r=770/r=771/g + s/r770/r771/g; the r769/r770 scripts are committed in-tree; if swept, recover from git history); remember the surgery lessons: new-texts apostrophe-free AND single-quote-free AND full-line replacements must preserve the L.append( wrapper (the r767 quote defect and the r769 wrapper defect - two heredoc deaths); the r770 close used BLOCK replacement with a compile() pre-flight - keep that pattern; close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r767, the interval readout since r768, the quiet readout since r769, the amber burst-end tone + the quietAmber read since r770); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the lean is CEMENTED (q x4, 00:03 through 03:03) - a fifth q deepens it, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight) or a VERDICT/UNCERTAIN growth wave = new signal. (5) BURST-END WATCH (the live story): the burst-end signal condition was met at the r770 open (quiet 64m past the ~62 ceiling, census flat); the close probe records the quietAmber state as-is - if amber held, the burst ended; if wave 11 landed mid-round, the meter reset and the new interval is the first data point of the next band; either way the meter self-declares from here - a LONG amber stretch across multiple rounds with no new wave and no lane churn means stop treating the wave cadence as the primary clock and watch the relay lanes directly; an interval-pattern break inside a new band = new signal. (6) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay: LEAN CEMENTED (r768, q x4) and the wave burst ending per the r770 burst-end witness - the platform report should describe the lean and the burst end, not an outage. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the live quiet meter shipped into a met burst-end signal - quiet 64m at open past the ~62 ceiling, the amber tone and the quietAmber probe read witnessing it - + full golden QA, anchored in scripts/qa_r770.txt and scripts/qa_r770_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\\n'.join(L))
print('worklog appended')
PY'''

COMMIT_MSG = 'git commit -m "r770: burst-end witnessed + the quiet meter goes live. Census flat 133/35/21/15/97 at open with quiet 64m - PAST the ~62 ceiling of the recorded band (13-42-62-57-61): the burst-end signal condition first met on-page; verdict/uncertain flat eleventh wave; lean CEMENTED q x4 held. Increment: the quiet meter goes live - a 30s tick keeps the staleness readout honest while the board is open, and past the QUIET_CEILING (62, the recorded band max) the quiet tag takes the house amber signal tone (text-amber-600 dark:text-amber-400, divergence-diamond convention, a witness not a fault); the tier-state probe gains a quietAmber class read - the burst-end witness as a probe witness. Close heredoc rebuilt by block replacement with a compile() pre-flight (the r767/r769 wrapper lessons). Snapshot discipline twenty-sixth close."'

LINE2_OLD = "# r770 close (quiet readout + wave-10 open watch): gates"
LINE2_NEW = "# r770 close (burst-end witness + live quiet meter): gates"
LINE32_OLD = "# tier-state probe (r770): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768) and the quiet readout (r770); the route-state line is a witness, not a gate (amber-tone doctrine)."
LINE32_NEW = "# tier-state probe (r770): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r770); the route-state line is a witness, not a gate (amber-tone doctrine)."
TIER_PROBE_OLD = "TIER=$(timeout 30 agent-browser eval \"(() => { const p=document.querySelector('[data-testid=\\\\\"corpus-tier-state\\\\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()\" 2>&1 | tail -1)"
TIER_PROBE_NEW = "TIER=$(timeout 30 agent-browser eval \"(() => { const p=document.querySelector('[data-testid=\\\\\"corpus-tier-state\\\\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()\" 2>&1 | tail -1)"


def main() -> int:
    with open(PATH, encoding="utf-8") as f:
        content = f.read()
    lines = content.split("\n")
    errors = []

    # boundary asserts: worklog heredoc = lines 70..106 (1-based)
    if lines[69].startswith("python3 - <<'PY'") is False:
        errors.append("line 70 is not the heredoc start")
    if lines[105] != "PY":
        errors.append("line 106 is not the heredoc end: %r" % lines[105][:40])
    if not lines[107].startswith('git commit -m "r770'):
        errors.append("line 108 is not the commit line")
    for probe in (LINE2_OLD, LINE32_OLD):
        if probe not in content:
            errors.append("anchor not found: %s..." % probe[:60])
    if TIER_PROBE_OLD not in content:
        errors.append("tier-probe anchor not found")
    if errors:
        print("BUILD ABORTED (boundaries):")
        for e in errors:
            print(" -", e)
        return 1

    # quote/wrapper pre-flight on the NEW heredoc body: compile it as python
    body = "\n".join(HEREDOC.split("\n")[1:-1])  # strip the <<'PY' and PY lines
    try:
        compile(body, "r770-heredoc", "exec")
    except SyntaxError as e:
        print("BUILD ABORTED (heredoc does not compile): %s" % e)
        return 1
    # wrapper shape: every L.append line must start with L.append( and end with )
    for ln in body.split("\n"):
        s = ln.strip()
        if s.startswith("L.append(") and not s.endswith(")"):
            errors.append("L.append line does not close: %s..." % s[:60])
            break
    # apostrophe audit inside prose strings (the r767 defect class)
    for ln in body.split("\n"):
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

    # apply: header comment, probe comment, tier probe, heredoc block, commit msg
    content = content.replace(LINE2_OLD, LINE2_NEW, 1)
    content = content.replace(LINE32_OLD, LINE32_NEW, 1)
    content = content.replace(TIER_PROBE_OLD, TIER_PROBE_NEW, 1)
    lines = content.split("\n")
    lines[69:106] = HEREDOC.split("\n")
    lines[107] = COMMIT_MSG
    out = "\n".join(lines)

    # post-apply audits
    if "qa_r769" in out or "?r=769" in out or "scripts/r769_qa" in out:
        errors.append("r769 remnant survives")
    if "L.append('Task ID: r770')" not in out:
        errors.append("r770 Task ID missing")
    if errors:
        print("BUILD ABORTED (post-apply):")
        for e in errors:
            print(" -", e)
        return 1

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(out)
    print("r770 close rebuilt: heredoc block swapped (compiles), tier probe extended, commit msg set")
    return 0


if __name__ == "__main__":
    sys.exit(main())
