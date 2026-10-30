#!/usr/bin/env python3
# r778 patch 2: the parallel session closed mid-round (commit eecd7902b,
# uuid-tagged) and swept the in-tree WIP including the r778 completions.
# Update the narrative to the final landing truth. Anchors or exit 1.
import sys

P = "scripts/r778_close.sh"
lines = open(P).read().split("\n")
out = []
agent_done = False
task_done = False
r6_done = False
stage1_done = False
handoff_done = False
commit_done = False

AGENT = (
    "L.append('Agent: NEXUS patrol (main agent - job 473388, 17:37 slot; opened on the r777 handoff; HEAD 1ad367aae = the r777 sweep tee riding the r777 main 91a0fd2aa; tree DIRTY at open - the parallel report-handler WIP (the Owner-report fix, seconds-fresh) disclosed and adopted after quiescence; "
    "LATE IN THE ROUND the parallel session closed in its own right: commit eecd7902b (uuid-tagged) swept the in-tree WIP INCLUDING the r778 completions (the vault load() conversion and the strip focus wash), with the harness tee 77a8dcda1 on top - both remotes; server 200 first-try throughout)')"
)

TASK = (
    "L.append('Task: Patrol round 778 - THE OWNER ROLLBACK REPORT ROOT-CAUSED AND LANDED (the parallel-session adoption, closed cooperatively). The Owner reported the vault / GitHub / Egress cards making rollbacks many times with a simple refresh, with the console error Unexpected token < (an HTML document reaching a res.json() parse). "
    "ROOT CAUSE WITNESSED FIRST-HAND: dmesg carries THREE next-server OOM kills (anon-rss 1.82 GB / 1.71 GB / 1.56 GB - three kills, matching the three wipe dates of the durability ledger); during a death/restart window the gateway answers every /api request with an HTML 502/504 page, the cards JSON-parsed it, and a save that failed that way read as a rollback after the next refresh. "
    "THE FIX arrived in-tree from the parallel report-handler session (uncommitted at r778 open): src/lib/api-fetch.ts - an apiJson helper that detects a non-JSON body BEFORE parsing, turns it into a plain-language ApiError (nothing was saved; retry once the server answers), retries once after 1.5s (every call site is an idempotent upsert, delete or read, so a retry can never double-apply), and lets abort/programmer errors pass through - wired through the vault store/lane-store/mirror/delete flows, the egress token save/clear + routing PUT (the optimistic revert now names the real error) and the GitHub vitals probe. "
    "r778 completed the fix: the vault load() read converted (the refresh half of the rollback look - a save that lands must not be unread by a death-window GET) plus the styling polish: a focus wash (focus-visible:bg-muted/30) on the wave-strip bucket chips so the r777 keyboard landing reads as a fill and not only a ring. "
    "LANDING: the parallel session closed mid-round - its commit eecd7902b (uuid-tagged) swept the in-tree WIP including the r778 completions, tee 77a8dcda1 on top, both remotes; the r778 close therefore carries the verification, the round scripts and this worklog. "
    "ADOPTION DISCIPLINE: the parallel edits were seconds-fresh at open (no stomping - QA ran as a quiescence window), quiescence verified at 4m40s with zero writes, tsc green at open, lint 0 errors / 33 warnings, golden QA GREEN FIRST-TRY on the adopted tree (console 0 errors, TEN lanes, no eleventh). "
    "The census at open: 158 ev / 42 runs / 23 verdicts / 15 uncertain / 120 nj - the wave-16 state, no wave 17 at open; the band stays 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62.')"
)

R6 = (
    "L.append('- R6 close: gates re-run on the final tree (tsc 0 / lint 0 errors, 33 warnings baseline); the FIRST close attempt aborted honestly at the chip probe (chip false during the post-edit HMR recompile window - the guarded chain did its job; the probe passed on the re-run); close probes: chip presence GATED / tone recorded; legend GATED (the strip edited - the focus wash); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip gate DEGRADED to RECORDED at generation time (cadence volatility after the r777 mid-round abort - disclosed); the r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip; the wash rides the class, recorded); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-fourth) + worklog + commit + dual push.')"
)

STAGE1 = (
    "L.append('- THE ROLLBACK CLASS CLOSED AT THE PRIMARY LAYER: the Owner-reported save rollback is the gateway-502-during-OOM-death-window class - three real OOM kills witnessed in dmesg, the HTML-page parse noise eliminated at the client (apiJson), the primary save/mirror/routing flows guarded, the vault load() read converted (the refresh half), and the failures now speak honestly (nothing was saved - retry) instead of rolling back silently. "
    "The round exercised the parallel-session doctrine on OPEN work for the first time: seconds-fresh edits treated as active, QA as the quiescence window, 4m40s verified, adopted with disclosure - and the parallel session then closed mid-round (eecd7902b), sweeping the completions; uncommitted code does not survive the three-wipe sandbox class, so landing beats politeness once quiescent. "
    "The read-path long tail (about 10 sites, several already catch-guarded) is r779 first work. The first close attempt aborted honestly at the chip probe during the HMR recompile window - the re-run carries the round. Snapshot discipline thirty-fourth close. Witness nine-legged + the keyboard-bridge probe (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')"
)

HANDOFF = (
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r778_qa.sh sed-adapted (DUAL pattern s/r=778/r=779/g + bare-label s/r778/r779/g; the r769-r778 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand. "
    "Probes: chip presence gated / tone recorded (NOTE: the chip probe can false-fail during a post-edit HMR recompile window - the r778 first abort; on a guard failure right after edits, re-probe once before diagnosing deeper); legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r777, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776, keyboard bridge r777, rollback class r778); "
    "wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only since r778; the r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; tally gated. "
    "(2) SNAPSHOT DISCIPLINE (thirty-fifth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the fresh lean run is q x1 (wave 16) - the NEXT lettered bucket decides (q x2 renders the lean tag again; a g return resumes the alternation; an m bucket = the first both-routes witness). "
    "GLM-SILENT WATCH FIRMED since r777 (wave 16 was q with no glm dial) - check the laggard lanes before interpreting; BOTH-SILENT lettered-bucket test still cleared. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) - wave 17 = the next interval point, recorded forward by the round that witnesses it (QUOTE THE RENDERED VALUE - the r775 convention). "
    "(6) Increment queue, IN ORDER: (a) FIRST complete the apiJson long tail (the read-path conversions in automation-vault-card.tsx: backup export/import, consume x2, test-dial, providers/recheck; egress-card.tsx: token/status/routing/probe GETs - the same helper, idempotent reads); (b) QA-found bugs first, always - including parallel-session WIP adopted under the r778 doctrine (quiescence-verify before landing, disclose in the worklog); (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. "
    "(7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; "
    "NOW ALSO THE OOM CEILING: three next-server OOM kills witnessed in dmesg (rss 1.82/1.71/1.56 GB) - the gateway-502 death-window class the Owner felt as config rollbacks; the client guard (apiJson) is shipped, but the ceiling itself (sandbox memory limit vs dev-server rss) is an Owner-side platform decision (raise the limit, or swap-backed profile); "
    "vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); "
    "AIHubMix relay update for the report: wave 16 = q at +62m (qwen back after the letterless wave 15), verdicts flat 23, the amber fired mid-lull before it - the arc reads r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull then wave-16 q landing. "
    "(9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"
)

COMMIT = (
    'git commit -m "r778 close: the rollback-class verification and the round record - the Owner report (vault/GitHub/Egress saves rolling back on refresh, Unexpected token < parse noise) root-caused as the OOM death-window class (three next-server OOM kills witnessed in dmesg, rss 1.82/1.71/1.56 GB; the gateway answers /api with HTML 502/504 during the window). '
    'The fix (the apiJson guarded-fetch helper + the card conversions) arrived from the parallel report-handler session and LANDED via its own mid-round close eecd7902b, which swept the in-tree WIP including the r778 completions (the vault load() conversion + the strip focus wash); this commit carries the round record: worklog, scripts, qa artifacts + snapshot thirty-fourth. The read-path long tail is queued for r779."'
)

for ln in lines:
    if ln.startswith("L.append('Agent: NEXUS patrol"):
        out.append(AGENT); agent_done = True; continue
    if ln.startswith("L.append('Task: Patrol round"):
        out.append(TASK); task_done = True; continue
    if ln.startswith("L.append('- R6 close"):
        out.append(R6); r6_done = True; continue
    if ln.startswith("L.append('- THE ROLLBACK CLASS CLOSED"):
        out.append(STAGE1); stage1_done = True; continue
    if ln.startswith("L.append('Next recommended action:"):
        out.append(HANDOFF); handoff_done = True; continue
    if ln.startswith("git commit -m"):
        out.append(COMMIT); commit_done = True; continue
    out.append(ln)

missing = [n for n, f in [
    ("agent", agent_done), ("task", task_done), ("r6", r6_done),
    ("stage1", stage1_done), ("handoff", handoff_done), ("commit", commit_done),
] if not f]
if missing:
    print("PATCH2 FAILED - anchors missing:", missing)
    sys.exit(1)

open(P, "w").write("\n".join(out))
print("patched2: r778_close.sh (final landing truth ok)")
