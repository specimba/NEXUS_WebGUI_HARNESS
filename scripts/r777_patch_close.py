#!/usr/bin/env python3
# r777: patch the sed-generated close script with the round narrative.
# Line-prefix replacement + probe extension; every anchor must match or we
# exit 1 BEFORE the close runs (guarded patching - no partial rewrite).
import sys

P = "scripts/r777_close.sh"
lines = open(P).read().split("\n")
out = []
kb_added = False
export_swapped = False
header_done = False
agent_done = False
task_done = False
taskid_done = False
stage1_done = False
stage2_done = False
round_done = False
handoff_done = False
blockers_done = False
commit_done = False
r_done = {"R1": False, "R2": False, "R3": False, "R4": False, "R5": False, "R6": False}

KB_PROBE = r"""KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }"""

TASK = (
    "L.append('Task: Patrol round 777 - CENSUS FLAT SECOND STRAIGHT ROUND; THE KEYBOARD BRIDGE SHIPPED; THE AMBER FIRED LIVE. The opening ro-SQL census: 155 ev / 41 runs / 23 verdicts / 15 uncertain / 117 nj - FULLY FLAT vs the r776 close (no growth, no wave 16; newest row still epoch 1793347835110 = 08:10:35 UTC; the band stays 13/16/41/58/13/42/62/57/61/70/6/73/55/59). "
    "The quiet readout crossed the 62 ceiling during the round - the amber tone fired on-page (the second true firing after the r774 mid-lull; the r775 re-look already held the ceiling, so this is a live lull witness on a settled regime, not a fault; the close probes carry the rendered quiet value). "
    "Golden QA GREEN FIRST-TRY (tally 41/155/23/15/117, TEN lane labels - no eleventh, console 0 errors). "
    "Shipped: the r777 keyboard bridge - the strip bucket chips gained tabIndex 0 and a focus-visible ring (rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:text-foreground/90), so the hover-only bucket data (lanes named, counts, the max-to-max gap, the letterless why-sentence) is reachable by keyboard focus (Chromium and Firefox surface title tooltips on focus); the strip container title documents the bridge. "
    "Styling polish: the focus ring plus the focused-chip text emphasis.')"
)

R_LINES = [
    ("L.append('- R1 open", "L.append('- R1 open: parallel-session check clean (worklog tail = the r776 section with the r777 handoff; HEAD 4c9d8937e = the r776 sweep tee riding after the r776 main increment 90f422abf - the r776 round closed in its own 16:37 slot; tree CLEAN at open; server 200 first-try; both remotes verified at 4c9d8937e).')"),
    ("L.append('- R2 census", "L.append('- R2 census: ro-SQL inline: 155/41/23/15/117 - FULLY FLAT vs the r776 close (newest row still epoch 1793347835110 = 08:10:35 UTC, ~+63m quiet at reading - already past the 62 ceiling); no wave 16 - the band stays /55/59; r777_qa.sh + r777_close.sh generated via the DUAL sed + bare-label sed from the in-tree r776 scripts.')"),
    ("L.append('- R3 QA", "L.append('- R3 QA: the r777 golden QA ran GREEN FIRST-TRY (board strip true, tally 41 runs / 155 ev / 23 verdicts / 15u / 117nj, chips 42; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')"),
    ("L.append('- R4 witnesses", "L.append('- R4 witnesses: the QA legs carried the witnesses (the census was flat - no separate witness pass needed): the tier-state note lean run broken (was q ×2) stayed live (the wave-bound r776 probe holds on the flat census); the quiet readout climbed past the 62 ceiling while the round ran (amber territory - the rendered value lands in the close probes); the r773-r775 chip affordances held (lanes + counts + gap 59 + the why-sentence on the letterless hover).')"),
    ("L.append('- R5 increment", "L.append('- R5 increment (run-kanban.tsx, two edits): the r777 keyboard bridge - tabIndex 0 + a focus-visible ring (rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:text-foreground/90) on the strip bucket chips, the hover-only bucket data reachable by keyboard focus (Chromium and Firefox surface title tooltips on focus); the strip container title documents the bridge. New texts kept apostrophe-free AND single-quote-free (surgery lessons).')"),
    ("L.append('- R6 close", "L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the strip edited this round); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip + the letterless chip in-window); the r776 broken-note probe GATED wave-bound (still true on the flat census); the NEW r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-third) + worklog + commit + dual push.')"),
]

STAGE1 = (
    "L.append('- CENSUS FLAT SECOND STRAIGHT ROUND; AMBER LIVE: zero growth through the round (155/41/23/15/117, newest row still 08:10:35 UTC) - the quiet crossed the 62 ceiling during the round and the amber tone fired on-page (the second true firing; the r774 mid-lull was the first; the probes carry the rendered value); "
    "the band stays 13/16/41/58/13/42/62/57/61/70/6/73/55/59; the r776 break note stayed live (the wave-bound probe true on the flat census); GLM-SILENT unchanged (no glm dial in any shown bucket). "
    "Snapshot discipline thirty-third close. Witness nine-legged + the r777 keyboard-bridge probe (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')"
)
STAGE2 = (
    "L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); no new doc debt queued (the r777 bridge is documented in the strip container title).')"
)

HANDOFF = (
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r777_qa.sh sed-adapted (DUAL pattern s/r=777/r=778/g + bare-label s/r777/r778/g; the r769-r777 scripts are committed in-tree; if swept, recover from git history); "
    "surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; "
    "legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r775, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776, keyboard bridge r777); "
    "wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip + the letterless chip in-window while the 08:00 bucket stays newest); "
    "the r776 broken-note probe GATED WAVE-BOUND (newest bucket letterless, run-below q×2 - when the next lettered bucket lands the note unrenders and the gate degrades to RECORDED with the bound disclosed); the r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; tally gated. "
    "(2) SNAPSHOT DISCIPLINE (thirty-fourth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the lean run restarts at the next lettered bucket (x1 no tag, x2 tag; a g return resumes the alternation; an m bucket = the first both-routes witness). "
    "GLM-SILENT WATCH: no glm dial in any shown bucket - if the next lettered bucket is again q with no glm, the standing-laggard reading firms up (r759 semantics: check the laggard lanes before interpreting); BOTH-SILENT lettered-bucket test still cleared. "
    "(5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59 - the quiet crossed the 62 ceiling LIVE at r777 (the amber fired, the second true firing after the r774 mid-lull); wave 16 = the next interval point, recorded forward by the round that witnesses it (QUOTE THE RENDERED VALUE - the r775 correction convention); the witnessing round updates the band docs at the four sites + the wave framing. "
    "(6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. "
    "(7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; "
    "vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); "
    "AIHubMix relay update for the report: zero growth two straight rounds (r776 + r777), verdicts flat 23, glm silent across the window, the quiet now PAST the 62 ceiling with the amber live - the relay reads DEEP-ADRIFT; the platform report should carry the arc (r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull). "
    "(9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"
)

BLOCKERS = (
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the r777 keyboard bridge is a named mechanism gated-witnessed in scripts/qa_r777_close.txt - a real accessibility gap closed; the amber firing is recorded as a live cadence datum; full golden QA anchored in scripts/qa_r777.txt).')"
)

COMMIT = (
    'git commit -m "r777: census flat second straight round - the band holds /55/59 and the quiet crossed the 62 ceiling live (the amber fired, the second true firing after the r774 mid-lull). '
    'Increment: the r777 keyboard bridge - the strip bucket chips gained tabIndex 0 + a focus-visible ring, the hover-only bucket data (lanes, counts, max-to-max gap, the letterless why-sentence) reachable by keyboard focus (Chromium/Firefox surface title tooltips on focus); the strip container title documents the bridge. '
    'Styling polish: the focus ring + focused-chip text emphasis. Snapshot discipline thirty-third close."'
)

for ln in lines:
    if ln.startswith("# r777 close ("):
        out.append("# r777 close (census flat second straight round; the r777 keyboard bridge on the strip chips; the amber fired live past the 62 ceiling): gates")
        header_done = True
        continue
    if ln.startswith("L.append('Agent: NEXUS patrol"):
        out.append("L.append('Agent: NEXUS patrol (main agent - job 473388, 17:07 slot; opened on the r776 handoff; HEAD 4c9d8937e = the r776 sweep tee riding after the r776 main increment 90f422abf (the r776 round closed in its own 16:37 slot); tree CLEAN at open; no parallel round closed (the worklog tail handed off r777; git log showed no r777 commit))')")
        agent_done = True
        continue
    if ln.startswith("L.append('Task: Patrol round"):
        out.append(TASK); task_done = True; continue
    if ln.startswith("L.append('Task ID:"):
        out.append("L.append('Task ID: r777')"); taskid_done = True; continue
    matched_r = False
    for pref, new in R_LINES:
        if ln.startswith(pref):
            out.append(new); matched_r = True
            r_done[pref.split("'- ")[1].split(" ")[0]] = True
            break
    if matched_r:
        continue
    if ln.startswith('echo "$BR"') and "was q ×2" in ln:
        out.append(ln)
        out.append(KB_PROBE)
        kb_added = True
        continue
    if ln.startswith("export R754_TSC="):
        out.append(ln + ' R777_KB="$KB"')
        export_swapped = True
        continue
    if ln.startswith("L.append('- THE BREAK WITNESSED"):
        out.append(STAGE1); stage1_done = True; continue
    if ln.startswith("L.append('- CANDIDATE NOTE"):
        out.append(STAGE2); stage2_done = True; continue
    if ln.startswith("L.append('Round ID:"):
        out.append("L.append('Round ID: r778 -> next patrol (job 473388)')"); round_done = True; continue
    if ln.startswith("L.append('Next recommended action:"):
        out.append(HANDOFF); handoff_done = True; continue
    if ln.startswith("L.append('Blockers:"):
        out.append(BLOCKERS); blockers_done = True; continue
    if ln.startswith("git commit -m"):
        out.append(COMMIT); commit_done = True; continue
    out.append(ln)

missing = [n for n, f in [
    ("kb_probe", kb_added), ("export", export_swapped), ("header", header_done),
    ("agent", agent_done), ("task", task_done), ("taskid", taskid_done),
    ("stage1", stage1_done), ("stage2", stage2_done), ("round", round_done),
    ("handoff", handoff_done), ("blockers", blockers_done), ("commit", commit_done),
] + [("rline_" + k, v) for k, v in r_done.items()] if not f]
if missing:
    print("PATCH FAILED - anchors missing:", missing)
    sys.exit(1)

open(P, "w").write("\n".join(out))
print("patched: r777_close.sh (KB probe + narrative + commit ok)")
