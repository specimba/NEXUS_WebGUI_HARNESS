#!/usr/bin/env python3
# r778: patch the sed-generated close script with the round narrative.
# The Owner rollback report (adopted parallel fix) + the OOM witness.
# Every anchor must match or we exit 1 BEFORE the close runs.
import sys

P = "scripts/r778_close.sh"
lines = open(P).read().split("\n")
out = []
ll_degraded = False
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

TASK = (
    "L.append('Task: Patrol round 778 - THE OWNER ROLLBACK REPORT ROOT-CAUSED AND LANDED (the parallel-session adoption). The Owner reported the vault / GitHub / Egress cards making rollbacks many times with a simple refresh, with the console error Unexpected token < (an HTML document reaching a res.json() parse). "
    "ROOT CAUSE WITNESSED FIRST-HAND: dmesg carries THREE next-server OOM kills (anon-rss 1.82 GB / 1.71 GB / 1.56 GB - three kills, matching the three wipe dates of the durability ledger); during a death/restart window the gateway answers every /api request with an HTML 502/504 page, the cards JSON-parsed it, and a save that failed that way read as a rollback after the next refresh. "
    "THE FIX arrived in-tree from the parallel report-handler session (uncommitted at r778 open): src/lib/api-fetch.ts - an apiJson helper that detects a non-JSON body BEFORE parsing, turns it into a plain-language ApiError (nothing was saved; retry once the server answers), retries once after 1.5s (every call site is an idempotent upsert, delete or read, so a retry can never double-apply), and lets abort/programmer errors pass through - wired through the vault store/lane-store/mirror/delete flows, the egress token save/clear + routing PUT (the optimistic revert now names the real error) and the GitHub vitals probe. "
    "r778 completed the fix: the vault load() read converted too (the refresh half of the rollback look - a save that lands must not be unread by a death-window GET), plus the styling polish: a focus wash (focus-visible:bg-muted/30) on the wave-strip bucket chips so the r777 keyboard landing reads as a fill and not only a ring. "
    "ADOPTION DISCIPLINE: the parallel edits were seconds-fresh at open (no stomping - QA ran as a quiescence window), quiescence verified at 4m40s with zero writes, tsc green at open, lint 0 errors / 33 warnings, golden QA GREEN FIRST-TRY on the adopted tree (console 0 errors, TEN lanes, no eleventh). "
    "The census at open: 158 ev / 42 runs / 23 verdicts / 15 uncertain / 120 nj - the wave-16 state, no wave 17 at open; the band stays 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62.')"
)

R_LINES = [
    ("L.append('- R1 open", "L.append('- R1 open: parallel-session check found the tree DIRTY with in-flight work r778 did not write - the three exact cards from the Owner report (automation-vault, egress, github-ops) modified plus a new src/lib/api-fetch.ts; HEAD 1ad367aae = the r777 sweep tee riding the r777 main 91a0fd2aa; worklog tail = the r777 handoff; server 200 first-try; the edits were seconds-fresh, so NO stomping - the session was treated as an active parallel report-handler and QA became the quiescence window.')"),
    ("L.append('- R2 census", "L.append('- R2 census: ro-SQL inline: 158/42/23/15/120 - the wave-16 state (no growth since the r777 close; newest row 1793351578070 = 09:12:58 UTC); the band stays /59/62; r778_qa.sh + r778_close.sh generated via the DUAL sed + bare-label sed from the in-tree r777 scripts.')"),
    ("L.append('- R3 QA", "L.append('- R3 QA: the r778 golden QA ran GREEN FIRST-TRY on the adopted parallel-WIP tree (board strip true, tally 42 runs / 158 ev / 23 verdicts / 15u / 120nj, chips 43; ld TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty) - the WIP breaks nothing.')"),
    ("L.append('- R4 witnesses", "L.append('- R4 witnesses: the OOM root cause witnessed FIRST-HAND in dmesg (three next-server kills: total-vm ~21.5 GB, anon-rss 1.82/1.71/1.56 GB, UID 1001 - the sandbox memory ceiling, not an app leak this round can fix); the gateway-502 class is therefore a recurring platform fact and the apiJson guard is the durable client-side answer; quiescence recheck at 4m40s: zero new writes, tsc + lint green on the stable tree.')"),
    ("L.append('- R5 increment", "L.append('- R5 increment (adopted + completed, 4 files + 1 new): src/lib/api-fetch.ts (the parallel session - ApiError, guarded parse, one idempotent retry, honest errors); automation-vault-card.tsx (4 save/mirror/delete flows - parallel session; PLUS the r778 load() read conversion); egress-card.tsx (token save/clear + routing PUT with honest reverts - parallel session); github-ops-card.tsx (vitals probe - parallel session); run-kanban.tsx (r778 styling polish: focus-visible:bg-muted/30 wash on the strip bucket chips beside the r777 ring). The remaining read-path long tail (vault backup/consume/test-dial/providers-recheck, egress status/probe GETs - several already catch-guarded) is queued for r779, not hidden.')"),
    ("L.append('- R6 close", "L.append('- R6 close: gates re-run on the final tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the strip edited - the focus wash); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip gate DEGRADED to RECORDED at generation time (cadence volatility after the r777 mid-round abort - a wave-17 landing mid-close must not kill the close; disclosed); the r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip; the wash rides the class, recorded); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-fourth) + worklog + commit + dual push.')"),
]

STAGE1 = (
    "L.append('- THE ROLLBACK CLASS CLOSED AT THE PRIMARY LAYER: the Owner-reported save rollback is the gateway-502-during-OOM-death-window class - three real OOM kills witnessed in dmesg, the HTML-page parse noise eliminated at the client (apiJson), the primary save/mirror/routing flows guarded, the vault load() read converted (the refresh half), and the failures now speak honestly (nothing was saved - retry) instead of rolling back silently. "
    "The parallel-session adoption doctrine was exercised for the first time on OPEN work: seconds-fresh edits treated as active, QA as the quiescence window, 4m40s verified, then adopted with disclosure - uncommitted code does not survive the three-wipe sandbox class, so landing beats politeness once quiescent. "
    "The read-path long tail (about 11 sites, several already catch-guarded) is r779 first work. Snapshot discipline thirty-fourth close. Witness nine-legged + the r777 keyboard-bridge probe extended with the wash class (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')"
)
STAGE2 = (
    "L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; the apiJson long tail is the queued debt (named, not hidden); the OOM ceiling itself is Owner-side (sandbox memory limit vs next-server rss ~1.8 GB - a platform-report item, not a code fix).')"
)

HANDOFF = (
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r778_qa.sh sed-adapted (DUAL pattern s/r=778/r=779/g + bare-label s/r778/r779/g; the r769-r778 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand. "
    "Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r777, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776, keyboard bridge r777, rollback class r778); "
    "wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only since r778 (cadence volatility - a mid-round wave must not kill a close); the r777 keyboard-bridge probe GATED (tabindex + ring + wash on the newest chip); divergence RECORDED ONLY; tally gated. "
    "(2) SNAPSHOT DISCIPLINE (thirty-fifth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the fresh lean run is q x1 (wave 16) - the NEXT lettered bucket decides (q x2 renders the lean tag again; a g return resumes the alternation; an m bucket = the first both-routes witness). "
    "GLM-SILENT WATCH FIRMED since r777 (wave 16 was q with no glm dial) - check the laggard lanes before interpreting; BOTH-SILENT lettered-bucket test still cleared. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) - wave 17 = the next interval point, recorded forward by the round that witnesses it (QUOTE THE RENDERED VALUE - the r775 convention); the witnessing round updates the band docs at the band sites + the wave framing. "
    "(6) Increment queue, IN ORDER: (a) FIRST complete the apiJson long tail (the read-path conversions in automation-vault-card.tsx: backup export/import, consume x2, test-dial, providers/recheck; egress-card.tsx: token/status/routing/probe GETs - the same helper, idempotent reads); (b) QA-found bugs first, always - including any parallel-session WIP adopted under the r778 doctrine (quiescence-verify before landing, disclose in the worklog); (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. "
    "(7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; "
    "NOW ALSO THE OOM CEILING: three next-server OOM kills witnessed in dmesg (rss 1.82/1.71/1.56 GB) - the gateway-502 death-window class the Owner felt as config rollbacks; the client guard (apiJson) is shipped, but the ceiling itself (sandbox memory limit vs dev-server rss) is an Owner-side platform decision (raise the limit, or move the dev server to a swap-backed profile); "
    "vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); "
    "AIHubMix relay update for the report: wave 16 = q at +62m (qwen back after the letterless wave 15), verdicts flat 23, the amber fired mid-lull before it - the arc reads r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull then wave-16 q landing. "
    "(9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"
)

BLOCKERS = (
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held twice (the rollback-class fix is a named mechanism landed with its witness - the dmesg OOM read and the gated close probes; "
    "AND the golden QA re-witness on the adopted tree; full golden QA anchored in scripts/qa_r778.txt).')"
)

COMMIT = (
    'git commit -m "r778: the Owner rollback report root-caused and landed - three next-server OOM kills witnessed in dmesg (rss 1.82/1.71/1.56 GB); during death windows the gateway answers /api with HTML 502/504 pages, the cards res.json() surfaced raw parse noise and failed saves read as rollbacks on refresh. '
    'Fix adopted from the parallel report-handler session (quiescence-verified 4m40s, tsc/lint/QA green before landing): the apiJson guarded-fetch helper (non-JSON detection before parse, one idempotent retry, honest errors) wired through the vault store/mirror/delete, egress token/routing and GitHub vitals flows; r778 adds the vault load() read conversion (the refresh half). '
    'Styling polish: focus wash on the wave-strip bucket chips. The read-path long tail is queued for r779. Snapshot discipline thirty-fourth close."'
)

for ln in lines:
    if ln.startswith("# r778 close ("):
        out.append("# r778 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates")
        header_done = True
        continue
    if ln.startswith("L.append('Agent: NEXUS patrol"):
        out.append("L.append('Agent: NEXUS patrol (main agent - job 473388, 17:37 slot; opened on the r777 handoff; HEAD 1ad367aae = the r777 sweep tee riding the r777 main 91a0fd2aa; tree DIRTY at open - the parallel report-handler WIP (the Owner-report fix, seconds-fresh) disclosed and adopted after quiescence; server 200 first-try; no parallel commit landed (the WIP was uncommitted at open AND at adoption))')")
        agent_done = True
        continue
    if ln.startswith("L.append('Task: Patrol round"):
        out.append(TASK); task_done = True; continue
    if ln.startswith("L.append('Task ID:"):
        out.append("L.append('Task ID: r778')"); taskid_done = True; continue
    matched_r = False
    for pref, new in R_LINES:
        if ln.startswith(pref):
            out.append(new); matched_r = True
            r_done[pref.split("'- ")[1].split(" ")[0]] = True
            break
    if matched_r:
        continue
    if ln.startswith('echo "$LL"'):
        out.append('echo "letterless-chip gate DEGRADED to RECORDED (r778: cadence volatility after the r777 mid-round abort)"')
        ll_degraded = True
        continue
    if ln.startswith("L.append('- WAVE 16 RECORDED"):
        out.append(STAGE1); stage1_done = True; continue
    if ln.startswith("L.append('- CANDIDATE NOTE"):
        out.append(STAGE2); stage2_done = True; continue
    if ln.startswith("L.append('Round ID:"):
        out.append("L.append('Round ID: r779 -> next patrol (job 473388)')"); round_done = True; continue
    if ln.startswith("L.append('Next recommended action:"):
        out.append(HANDOFF); handoff_done = True; continue
    if ln.startswith("L.append('Blockers:"):
        out.append(BLOCKERS); blockers_done = True; continue
    if ln.startswith("git commit -m"):
        out.append(COMMIT); commit_done = True; continue
    out.append(ln)

missing = [n for n, f in [
    ("ll_degraded", ll_degraded), ("header", header_done), ("agent", agent_done),
    ("task", task_done), ("taskid", taskid_done), ("stage1", stage1_done),
    ("stage2", stage2_done), ("round", round_done), ("handoff", handoff_done),
    ("blockers", blockers_done), ("commit", commit_done),
] + [("rline_" + k, v) for k, v in r_done.items()] if not f]
if missing:
    print("PATCH FAILED - anchors missing:", missing)
    sys.exit(1)

open(P, "w").write("\n".join(out))
print("patched: r778_close.sh (adoption narrative + LL degrade ok)")
