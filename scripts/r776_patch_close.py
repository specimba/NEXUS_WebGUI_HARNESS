#!/usr/bin/env python3
# r776: patch the sed-generated close script with the round narrative.
# Line-prefix replacement + new-probe insertion; every anchor must match or
# we exit 1 BEFORE the close runs (guarded patching - no partial rewrite).
import sys

P = "scripts/r776_close.sh"
lines = open(P).read().split("\n")
out = []
br_swapped = False
br_export = False
br_worklog = False
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

BR_BLOCK = [
    r"""BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r776/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)""",
    'echo "broken note: $BR"',
    'echo "$BR" | grep -Eq \'broken\\\\?":true\' || { echo \'GUARD broken note\'; exit 1; }',
    'echo "$BR" | grep -Eq \'was q ×2\' || { echo \'GUARD broken run\'; exit 1; }',
]

TASK = (
    "L.append('Task: Patrol round 776 - THE LEAN-RUN BREAK WITNESSED ON-PAGE (the r776 break note). The opening ro-SQL census: 155 ev / 41 runs / 23 verdicts / 15 uncertain / 117 nj - FULLY FLAT vs the r775 close (no growth, no wave 16; newest row still 08:10:35 UTC; "
    "the band stays 13/16/41/58/13/42/62/57/61/70/6/73/55/59). The r775 correction held: the band docs and the live readouts agree (/59 in both). Golden QA GREEN FIRST-TRY (tally 41/155/23/15/117, TEN lane labels - no eleventh, console 0 errors). "
    "Shipped: the r776 lean-run break note - when the newest bucket is letterless and the run beneath it was 2+, the tier-state line now renders lean run broken (was q ×2) in place of the silently-dropped r767 tag (muted tone, cursor-help + transition-colors, "
    "the title carries the r767 break semantics and the restart rule: the run restarts at the next lettered bucket, x1 renders no tag, x2 renders the tag again); the laneLean memo returns the pre-break run (broken, recorded only when 2+); "
    "styling polish: transition-colors on the strip route-letter spans. The letterless 08:00 bucket exercised the note live during QA (the QA ran on the final tree).')"
)

R_LINES = [
    ("L.append('- R1 open", "L.append('- R1 open: parallel-session check clean (worklog tail = the r775 section + the same-round correction addendum; HEAD 5956ba12e = the r775 correction commit riding after the harness tee 5a1dec9dd; tree CLEAN at open; server 200 first-try; no parallel round closed).')"),
    ("L.append('- R2 census", "L.append('- R2 census: ro-SQL inline: 155/41/23/15/117 - FULLY FLAT vs the r775 close (newest row still 08:10:35 UTC, ~+27m quiet at reading); no wave 16 - the band stays /55/59; r776_qa.sh + r776_close.sh generated via the DUAL sed + bare-label sed from the in-tree r775 scripts.')"),
    ("L.append('- R3 QA", "L.append('- R3 QA: the r776 golden QA ran GREEN FIRST-TRY (board strip true, tally 41 runs / 155 ev / 23 verdicts / 15u / 117nj, chips 42; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')"),
    ("L.append('- R4 witnesses", "L.append('- R4 witnesses: the QA legs carried the witnesses this round (the census was flat - no separate witness pass needed): the tier-state reads lean run broken (was q ×2) - the new r776 note LIVE at probe time; +59m since prior; quiet ~+27m at census, amber correctly off; the 08:00 chip hover carries lanes + counts + gap 59 + the why-sentence (the r773-r775 affordances all holding).')"),
    ("L.append('- R5 increment", "L.append('- R5 increment (run-kanban.tsx, four edits): the laneLean memo returns the pre-break run (broken = the trailing identical-letter run beneath the newest letterless bucket, recorded only when 2+, the tag condition preserved - the tag still renders only when the NEWEST bucket is lettered); the tier-state line renders the r776 break note in place of the silently-vanished tag; styling polish: transition-colors on the strip route-letter spans.')"),
    ("L.append('- R6 close", "L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the tier-state span edited this round); tier-state RECORDED (gap/quiet/quietAmber) + the NEW r776 broken-note probe GATED (broken true + was q ×2); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip + the letterless chip in-window); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-second) + worklog + commit + dual push.')"),
]

STAGE1 = (
    "L.append('- THE BREAK WITNESSED: the r767 break semantics (a letterless bucket breaks the run, the tag unrenders) now have an on-page witness - the tier-state reads lean run broken (was q ×2), the note gated in scripts/qa_r776_close.txt; "
    "the flat census (155/41/23/15/117, zero growth through the round) is itself a cadence datum: quiet ~+27m at census, +59m since prior, amber correctly off; GLM-SILENT deepens (no glm dial in any shown bucket, now spanning the lettered q buckets AND the letterless break); "
    "BOTH-SILENT lettered-bucket test still cleared. Snapshot discipline thirty-second close. Witness nine-legged + the r776 broken-note probe (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')"
)
STAGE2 = (
    "L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); no new doc debt queued (the r775 correction validated this round - band docs and live readouts agree at /59).')"
)

HANDOFF = (
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r776_qa.sh sed-adapted (DUAL pattern s/r=776/r=777/g; the r769-r776 scripts are committed in-tree; if swept, recover from git history); "
    "surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; "
    "legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r775, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776); "
    "wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip + the letterless chip in-window); the r776 broken-note probe GATED but WAVE-BOUND (it asserts the current state: newest bucket letterless, run-below q×2) - when the next lettered bucket lands the note unrenders and the gate degrades to RECORDED with the bound disclosed; divergence RECORDED ONLY; tally gated. "
    "(2) SNAPSHOT DISCIPLINE (thirty-third). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the lean run restarts at the next lettered bucket (x1 no tag, x2 tag; a g return resumes the alternation; an m bucket = the first both-routes witness). "
    "GLM-SILENT WATCH: no glm dial in any shown bucket - if the next lettered bucket is again q with no glm, the standing-laggard reading firms up (r759 semantics: check the laggard lanes before interpreting); BOTH-SILENT lettered-bucket test still cleared. "
    "(5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59 - the 62 ceiling HELD at the r775 re-look; wave 16 = the next interval point, recorded forward by the round that witnesses it (QUOTE THE RENDERED VALUE - the r775 correction convention); the witnessing round updates the band docs at the four sites + the wave framing. "
    "(6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. "
    "(7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; "
    "vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay update for the report: the flat stretch continues (zero growth through r776, verdicts flat 23, glm silent across the window, wave 15 letterless) - the relay reads IDLE-ADRIFT; the platform report should carry the arc (r774 recovering -> r775 adrift -> r776 flat-adrift) with the band and the ceiling-HOLD verdict. "
    "(9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"
)

BLOCKERS = (
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the r776 break-note feature is gated-witnessed in scripts/qa_r776_close.txt - a named mechanism shipped with its witness; the flat census is recorded as a cadence datum; full golden QA anchored in scripts/qa_r776.txt).')"
)

COMMIT = (
    'git commit -m "r776: the lean-run break witnessed on-page - when the newest bucket is letterless and the run beneath it was 2+, the tier-state line now renders lean run broken (was q ×2) in place of the silently-dropped r767 tag (the laneLean memo returns the pre-break run; '
    'muted tone + cursor-help + transition-colors; the title carries the break semantics and the restart rule); the letterless 08:00 bucket exercised the note live during QA. Styling polish: transition-colors on the strip route-letter spans. '
    'Census fully flat (155/41/23/15/117, no wave 16, band stays /55/59, the r775 /59 correction held). Snapshot discipline thirty-second close."'
)

for ln in lines:
    if ln.startswith("# r776 close (waves 14+15 recorded"):
        out.append("# r776 close (the lean-run break witnessed on-page: the r776 break note gated; flat census as a cadence datum; transition-colors on the route-letter spans): gates")
        header_done = True
        continue
    if ln.startswith("L.append('Agent: NEXUS patrol"):
        out.append("L.append('Agent: NEXUS patrol (main agent - job 473388, 16:37 slot; opened on the r775 handoff + correction addendum; HEAD 5956ba12e = the r775 correction commit riding after the harness tee 5a1dec9dd (my r775 close commit db3414c25 sits beneath both); tree CLEAN at open; no parallel round closed (the worklog tail handed off r776; git log showed no r776 commit))')")
        agent_done = True
        continue
    if ln.startswith("L.append('Task: Patrol round"):
        out.append(TASK); task_done = True; continue
    if ln.startswith("L.append('Task ID:"):
        out.append("L.append('Task ID: r776')"); taskid_done = True; continue
    matched_r = False
    for pref, new in R_LINES:
        if ln.startswith(pref):
            out.append(new); matched_r = True
            r_done[pref.split("'- ")[1].split(" ")[0]] = True
            break
    if matched_r:
        continue
    if ln.startswith('echo "$LT" | grep -Eq') and "hasGap" in ln:
        out.append(ln)
        out.extend(BR_BLOCK)
        br_swapped = True
        continue
    if 'R774_LL="$LL"' in ln and ln.startswith("export"):
        # the export token is still the UPPERCASE R774_ name - the lowercase
        # bare-label seds never renamed it (the r774 patch lesson again);
        # the reader lines read the same R774_ names, so the chain is
        # internally consistent - append the r776 BR token alongside.
        out.append(ln.replace('R774_LL="$LL"', 'R774_LL="$LL" R776_BR="$BR"'))
        br_export = True
        continue
    if ln.startswith("L.append('  letterless chip: '"):
        out.append(ln)
        out.append("L.append('  broken note: ' + os.environ.get('R776_BR','(missing)'))")
        br_worklog = True
        continue
    if ln.startswith("L.append('- WAVES 14 AND 15"):
        out.append(STAGE1); stage1_done = True; continue
    if ln.startswith("L.append('- CANDIDATE NOTE"):
        out.append(STAGE2); stage2_done = True; continue
    if ln.startswith("L.append('Round ID:"):
        out.append("L.append('Round ID: r777 -> next patrol (job 473388)')"); round_done = True; continue
    if ln.startswith("L.append('Next recommended action:"):
        out.append(HANDOFF); handoff_done = True; continue
    if ln.startswith("L.append('Blockers:"):
        out.append(BLOCKERS); blockers_done = True; continue
    if ln.startswith("git commit -m"):
        out.append(COMMIT); commit_done = True; continue
    out.append(ln)

missing = [n for n, f in [
    ("br_probe", br_swapped), ("br_export", br_export), ("br_worklog", br_worklog),
    ("header", header_done), ("agent", agent_done), ("task", task_done), ("taskid", taskid_done),
    ("stage1", stage1_done), ("stage2", stage2_done), ("round", round_done),
    ("handoff", handoff_done), ("blockers", blockers_done), ("commit", commit_done),
] + [("rline_" + k, v) for k, v in r_done.items()] if not f]
if missing:
    print("PATCH FAILED - anchors missing:", missing)
    sys.exit(1)

open(P, "w").write("\n".join(out))
print("patched: r776_close.sh (broken-note probe + narrative + commit ok)")
