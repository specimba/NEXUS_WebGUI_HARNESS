#!/usr/bin/env python3
# r775: patch the sed-generated close script with the round narrative.
# Line-prefix replacement + probe extension; every anchor must match or we
# exit 1 BEFORE the close runs (guarded patching - no partial rewrite).
import sys

P = "scripts/r775_close.sh"
lines = open(P).read().split("\n")
out = []
lt_swapped = False
guard_added = False
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

LT_PROBE = r"""LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)"""

TASK = (
    "L.append('Task: Patrol round 775 - WAVES 14 AND 15 RECORDED FORWARD; THE CEILING RE-LOOK RUNS (the r770 three-point gate satisfied). The opening ro-SQL census: 155 ev / 41 runs / 23 verdicts (flat, third round after the two growths) / 15 uncertain (flat) / 117 nj (+3); "
    "the newest corpus row 08:10:35 UTC. The board witnesses: wave 14 = bucket 07:00 (x2 q, +55m since prior - the r774 close caught it mid-landing, r775 records it forward); wave 15 = bucket 08:00 (x3, LETTERLESS - the full tried list reads intern-systemone no-answer + mercury-3 no-answer + OrcaRouter gemini-3.8-flash no-answer + fast-judge relay-chain-exhausted + jev not-armed, NO middle-tier dial) at +60m since prior (bucket 07:00 to 08:00 maxes, 07:11:05 to 08:10:35 = 59.5m, rendered +60m) "
    "- band 13/16/41/58/13/42/62/57/61/70/6/73/55/60 (14 points); the letterless wave-15 BREAKS the q-lean x2 run (r767 semantics: a bucket without middle-tier rows breaks the run - the lean tag unrenders); the GLM-SILENT watch continues (no glm dial in any shown bucket); the letterless case is not the BOTH-SILENT lettered-bucket test (that carry stays cleared). "
    "THE RE-LOOK: post-burst points now four (6/73/55/60, mean 48.5m vs pre-burst mean 43.3m) - the cadence regime is compatible with the pre-burst track, the 62 ceiling is HELD, its one firing (the r774 mid-lull) true - verdict documented in the quiet title. Golden QA GREEN FIRST-TRY (tally 41/155/23/15/117, TEN lane labels - no eleventh, console 0 errors). "
    "Shipped: (a) per-chip interval on the strip - each corpus bucket chip hover now carries +Xm since prior (max-to-max), the exact r768 laneGap definition, so the whole cadence band is readable per-bucket on the strip instead of only the newest interval in the tier-state line; "
    "(b) the band docs carry /55/60 with wave-14 and wave-15 framing at the four band sites (interval span title, quiet span title, both tier-state band phrases); (c) the r775 re-look verdict (62 held) in the quiet title; (d) styling polish: transition-colors on the strip bucket chips (legend lane-chip parity, the r773 pattern).')"
)

R_LINES = [
    ("L.append('- R1 open", "L.append('- R1 open: parallel-session check clean (worklog tail handed off r775 - the r774 round closed in its own 15:07 slot with commits 6e5693e94 main + ffb9e4015 sweep tee; no cron-tagged commit after the sweep, the r773-onward pattern); tree CLEAN at open this time (the r774 gateway-pulse drift was committed in its own round); server 200 first-try.')"),
    ("L.append('- R2 census", "L.append('- R2 census: ro-SQL inline: 155/41/23/15/117 (+3 ev, +1 run, +3 nj vs the r774 close census 152/40/23/15/114 - verdicts flat), newest epoch 1793347835110 = 08:10:35 UTC (past wave 14 - a NEW wave landed before the round opened); the bucket-map query fixed the shape (08:00 x3 all at 08:10:35, 07:00 x2, 06:15 x2); r775_qa.sh + r775_close.sh generated via the DUAL sed from the in-tree r774 scripts + a bare-label sed for the echo headers.')"),
    ("L.append('- R3 QA", "L.append('- R3 QA: the r775 golden QA ran GREEN FIRST-TRY (board strip true, tally 41 runs / 155 ev / 23 verdicts / 15u / 117nj, chips 42; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')"),
    ("L.append('- R4 witnesses", "L.append('- R4 witnesses: the full-note read of the newest rows: wave 15 (08:00) tried list = intern-systemone (no answer) + mercury-3 (no answer) + OrcaRouter gemini-3.8-flash (no answer) + fast-judge (relay chain exhausted) + jev (not armed) - NO middle-tier lane: LETTERLESS, the lean run breaks; wave 14 (07:00) tried list confirmed q (qwen3.8-flash-free present, no glm). Gap math: 07:11:05 to 08:10:35 = 59.5m -> chip and tier-state render +60m (Math.round).')"),
    ("L.append('- R5 increment", "L.append('- R5 increment (run-kanban.tsx, nine edits): the gap map in the waveStrip memo (prevKey walk over the same single dependency; Math.round of the bounds max-to-max delta); the chip-title gap fragment (+Xm since prior (max-to-max), corpus mode, hidden for a first-ever bucket); the four band strings /6/73 -> /6/73/55/60 with wave-14 and wave-15 framing (interval span title, quiet span title + the re-look verdict, both tier-state band phrases); transition-colors on the strip bucket chips.')"),
    ("L.append('- R6 close", "L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the tier-state span edited this round); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (the newest-chip probe EXTENDED this round: hasGap asserts the r775 max-to-max fragment on the newest chip; the letterless probe now reads the first of TWO in-window letterless chips, 05:00 and 08:00); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-first) + worklog + commit + dual push.')"),
]

STAGE1 = (
    "L.append('- WAVES 14 AND 15 RECORDED FORWARD: band 13/16/41/58/13/42/62/57/61/70/6/73/55/60 (14 points); the post-burst band holds four points (6/73/55/60, mean 48.5m vs pre-burst 43.3m) - the r775 re-look runs at the three-plus gate and HOLDS the 62 ceiling (its one firing true); "
    "the letterless wave-15 broke the q-lean x2 run (the tag unrenders - r767 semantics witnessed working on-page); the GLM-SILENT watch deepens (no glm dial in any shown bucket); verdicts flat at 23; TEN lanes held. The per-chip gap feature makes the whole band readable on the strip (hover any bucket). "
    "Snapshot discipline thirty-first close. Witness nine-legged + the hasGap extension (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')"
)
STAGE2 = (
    "L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); no new doc debt queued (the r773 letterless-title debt stays paid - the wave-15 letterless chip exercised the why-sentence live this round).')"
)

HANDOFF = (
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r775_qa.sh sed-adapted (DUAL pattern s/r=775/r=776/g; the r769-r775 scripts are committed in-tree; if swept, recover from git history); "
    "surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; "
    "legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r775, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775); "
    "wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts on the newest chip + hasGap on the newest chip (r775, wave-agnostic - the assertion survives newer waves) + the letterless chip in-window (the wave-15 08:00 bucket is newest, so it stays in-window for rounds to come)); divergence RECORDED ONLY; tally gated. "
    "(2) SNAPSHOT DISCIPLINE (thirty-second). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the lean run RESTARTED after the wave-15 break - the next lettered bucket starts a fresh run (q x1 = no tag, x2 renders the tag; a g return resumes the alternation; an m bucket = the first both-routes witness). "
    "GLM-SILENT WATCH: no glm dial in any shown bucket - if the next lettered bucket is again q with no glm, the standing-laggard reading firms up (r759 semantics: check the laggard lanes before interpreting); BOTH-SILENT lettered-bucket test still cleared (the letterless wave is not a lettered bucket). "
    "(5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/60 - the 62 ceiling RE-LOOKED and HELD at r775 (four post-burst points, mean 48.5m vs pre-burst 43.3m - the regime is compatible); wave 16 = the next interval point, recorded forward by the round that witnesses it; the per-chip gap makes the band self-documenting (hover any bucket). "
    "(6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. "
    "(7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; "
    "vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay update for the report: wave 14 = q at +55m (qwen back), wave 15 = LETTERLESS at +60m (no qwen AND no glm dial - the free pair unpicked), verdicts flat 23, glm silent across the window - the relay reads IDLE-ADRIFT again after the r774 recovering read: the platform report should carry BOTH states. "
    "(9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"
)

BLOCKERS = (
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held twice (the wave-14/15 intervals recorded forward into the on-page band docs - a named mechanism updated with witnessed data; AND the r770-gated ceiling re-look - a named evaluation run at its stated gate; the per-chip gap feature is gated-witnessed in scripts/qa_r775_close.txt; full golden QA anchored in scripts/qa_r775.txt).')"
)

COMMIT = (
    'git commit -m "r775: waves 14 and 15 recorded forward - band 13/16/41/58/13/42/62/57/61/70/6/73/55/60 (wave 14 = 07:00 q at +55m; wave 15 = 08:00 LETTERLESS at +60m, no middle-tier dial - the q-lean x2 run breaks per r767); the r770-gated ceiling re-look runs at four post-burst points '
    '(6/73/55/60, mean 48.5m vs pre-burst 43.3m) and HOLDS the 62 ceiling (its one firing true) - verdict in the quiet title. Increment: per-chip +Xm since prior (max-to-max) on the strip bucket hovers - the whole cadence band readable per-bucket on-page; the four band sites carry /55/60 with wave framing. '
    'Styling polish: transition-colors on the strip bucket chips (legend parity). Snapshot discipline thirty-first close."'
)

for ln in lines:
    if ln.startswith("# r775 close (wave 13 recorded"):
        out.append("# r775 close (waves 14+15 recorded: band /55/60 at four sites; per-chip max-to-max gap on the strip chips; ceiling re-look held at 62; transition-colors on the strip chips): gates")
        header_done = True
        continue
    if ln.startswith("L.append('Agent: NEXUS patrol"):
        out.append("L.append('Agent: NEXUS patrol (main agent - job 473388, 16:07 slot; opened on the r774 handoff; HEAD ffb9e4015 = the r774 sweep tee (r774 main 6e5693e94 landed in its own 15:07 slot); no cron-tagged commit after the r774 sweep (the r773-onward pattern - the tee artifact rides the next round); tree CLEAN at open (the r774 gateway-pulse drift was committed in its own round); no parallel round closed (the worklog tail handed off r775; git log showed no r775 commit))')")
        agent_done = True
        continue
    if ln.startswith("L.append('Task: Patrol round"):
        out.append(TASK); task_done = True; continue
    if ln.startswith("L.append('Task ID:"):
        out.append("L.append('Task ID: r775')"); taskid_done = True; continue
    matched_r = False
    for pref, new in R_LINES:
        if ln.startswith(pref):
            out.append(new); matched_r = True
            r_done[pref.split("'- ")[1].split(" ")[0]] = True
            break
    if matched_r:
        continue
    if ln.startswith("LT=$(timeout 30 agent-browser eval"):
        out.append(LT_PROBE); lt_swapped = True; continue
    if ln.startswith('echo "$LT" | grep -Eq') and "hasCounts" in ln:
        out.append(ln)
        out.append('echo "$LT" | grep -Eq \'hasGap\\\\?":true\' || { echo \'GUARD chip gap\'; exit 1; }')
        guard_added = True
        continue
    if ln.startswith("L.append('- WAVE 13 RECORDED"):
        out.append(STAGE1); stage1_done = True; continue
    if ln.startswith("L.append('- CANDIDATE NOTE"):
        out.append(STAGE2); stage2_done = True; continue
    if ln.startswith("L.append('Round ID:"):
        out.append("L.append('Round ID: r776 -> next patrol (job 473388)')"); round_done = True; continue
    if ln.startswith("L.append('Next recommended action:"):
        out.append(HANDOFF); handoff_done = True; continue
    if ln.startswith("L.append('Blockers:"):
        out.append(BLOCKERS); blockers_done = True; continue
    if ln.startswith("git commit -m"):
        out.append(COMMIT); commit_done = True; continue
    out.append(ln)

missing = [n for n, f in [
    ("lt_probe", lt_swapped), ("gap_guard", guard_added), ("header", header_done),
    ("agent", agent_done), ("task", task_done), ("taskid", taskid_done),
    ("stage1", stage1_done), ("stage2", stage2_done), ("round", round_done),
    ("handoff", handoff_done), ("blockers", blockers_done), ("commit", commit_done),
] + [("rline_" + k, v) for k, v in r_done.items()] if not f]
if missing:
    print("PATCH FAILED - anchors missing:", missing)
    sys.exit(1)

open(P, "w").write("\n".join(out))
print("patched: r775_close.sh (probe extension + narrative + commit ok)")
