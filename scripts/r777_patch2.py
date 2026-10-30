#!/usr/bin/env python3
# r777 patch 2: wave 16 landed mid-round - record it forward in the close
# narrative and DEGRADE the wave-bound broken-note guards to RECORDED.
# Every anchor must match or we exit 1 BEFORE the close runs.
import sys

P = "scripts/r777_close.sh"
lines = open(P).read().split("\n")
out = []
guard_done = False
header_done = False
task_done = False
r2_done = False
r4_done = False
r5_done = False
r6_done = False
stage1_done = False
handoff_done = False
blockers_done = False
commit_done = False

TASK = (
    "L.append('Task: Patrol round 777 - WAVE 16 LANDED MID-ROUND AND IS RECORDED FORWARD; THE KEYBOARD BRIDGE SHIPPED; THE AMBER FIRED LIVE. The opening ro-SQL census: 155 ev / 41 runs / 23 verdicts / 15 uncertain / 117 nj - flat vs the r776 close at reading time. "
    "MID-ROUND the wave-16 bucket landed: 10-30 09:00, LETTERED q (qwen-only - qwen3.8-flash-free answered, qwen3.8-max-free silent, 1/2), at +62m since prior (bucket 08:00 to 09:00 maxes, ms-true render 62 - the r775 convention: quote the rendered value; the close probe caught gapVal 62 on the newest chip). "
    "Band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) recorded forward at the band sites with wave-16 framing. "
    "The amber fired live mid-round (quiet crossed the 62 ceiling before the wave reset it to 0 - the second true firing after the r774 mid-lull; the r775 re-look already held the ceiling, so a live lull witness on a settled regime, not a fault). "
    "Wave 16 is q with NO glm dial - the GLM-SILENT watch FIRMS UP (the r759 standing-laggard reading: check the laggard lanes before interpreting). "
    "The lean run RESTARTED per r767: the wave-15 break note unrendered live exactly as the semantics predict (the wave-bound r776 probe degraded to RECORDED with the bound disclosed); the fresh run is x1 (no tag - the tag renders at x2). "
    "Golden QA GREEN FIRST-TRY on the opening tree; the close probes re-witnessed the edited strip on the final tree. "
    "Shipped: the r777 keyboard bridge (strip bucket chips tabIndex 0 + focus-visible ring - the hover-only bucket data reachable by keyboard focus; the strip container title documents it) + the wave-16 band-doc recording. Styling polish: the focus ring + focused-chip text emphasis.')"
)

R2 = (
    "L.append('- R2 census: ro-SQL inline: 155/41/23/15/117 - flat vs the r776 close at reading time (newest row then still epoch 1793347835110 = 08:10:35 UTC, ~+63m quiet - past the 62 ceiling, amber territory); r777_qa.sh + r777_close.sh generated via the DUAL sed + bare-label sed from the in-tree r776 scripts.')"
)
R4 = (
    "L.append('- R4 witnesses: the QA legs carried the opening witnesses; MID-ROUND the wave-16 bucket landed and the close probes caught it live: newest chip 10-30 09:00 q with gapVal 62, tier-state reads bucket 10-30 09:00 - q, +62m since prior, +0m quiet (the wave reset the lull), mid-qwen route ACTIVE (1/2, qwen3.8-max-free silent); the r776 break note UNRENDERED (broken false - the wave-bound semantics witnessed in the unrender direction too); the strip window rotated (04:00 dropped off, 09:00 in).')"
)
R5 = (
    "L.append('- R5 increment (run-kanban.tsx, six edits): (a) the r777 keyboard bridge - tabIndex 0 + a focus-visible ring (rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:text-foreground/90) on the strip bucket chips, the hover-only bucket data reachable by keyboard focus (Chromium and Firefox surface title tooltips on focus); (b) the strip container title documents the bridge; (c) the wave-16 recording at the band sites - the band token extended /59 to /59/62 everywhere and the wave-16 framing added to the interval title, the quiet title and the route-state title lists. New texts kept apostrophe-free AND single-quote-free (surgery lessons).')"
)
R6 = (
    "L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the strip edited this round); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - gapVal 62 caught the wave-16 interval live); the r776 broken-note probe DEGRADED to RECORDED (the wave-16 lettered landing unrendered the note exactly as the r776 handoff predicted - the bound disclosed); the r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-third) + worklog + commit + dual push.')"
)

STAGE1 = (
    "L.append('- WAVE 16 RECORDED FORWARD; AMBER LIVE THEN RESET: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) - wave 16 = bucket 10-30 09:00, lettered q (qwen-only, 1/2 active), at +62m (the rendered value quoted per the r775 convention); the post-burst band now five points (6/73/55/59/62, mean 51.0m vs pre-burst 43.3m); "
    "the amber fired live mid-round before the wave reset quiet to 0 (the second true firing; the r775 ceiling hold stands on the regime question); the lean run RESTARTED (fresh q x1, no tag; the r776 break note unrendered live - the wave-bound gate degraded to RECORDED as the handoff predicted); "
    "GLM-SILENT FIRMS (the lettered 09:00 bucket is q with no glm dial - the r759 standing-laggard reading strengthens); TEN lanes held. "
    "Snapshot discipline thirty-third close. Witness nine-legged + the r777 keyboard-bridge probe (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')"
)

HANDOFF = (
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r777_qa.sh sed-adapted (DUAL pattern s/r=777/r=778/g + bare-label s/r777/r778/g; the r769-r777 scripts are committed in-tree; if swept, recover from git history); "
    "surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; "
    "legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r777, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776, keyboard bridge r777); "
    "wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic; the letterless chip probe reads the 08:00 chip, still in-window while it stays shown); "
    "the r776 broken-note probe RETIRED to RECORDED-only history (it fired true at r776, degraded at r777 when wave 16 landed - the bound witnessed both directions); the r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; tally gated. "
    "(2) SNAPSHOT DISCIPLINE (thirty-fourth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the fresh lean run is q x1 (wave 16) - the NEXT lettered bucket decides (q x2 renders the lean tag again; a g return resumes the alternation; an m bucket = the first both-routes witness). "
    "GLM-SILENT WATCH FIRMED: wave 16 is q with no glm dial - if the next lettered bucket is again q with no glm, the standing-laggard reading holds per r759 (check the laggard lanes before interpreting); BOTH-SILENT lettered-bucket test still cleared. "
    "(5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) - the amber fired live at r777 before wave 16 reset the quiet; wave 17 = the next interval point, recorded forward by the round that witnesses it (QUOTE THE RENDERED VALUE - the r775 convention); the witnessing round updates the band docs at the band sites + the wave framing. "
    "(6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. "
    "(7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; "
    "vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); "
    "AIHubMix relay update for the report: wave 16 = q at +62m (qwen back after the letterless wave 15 - the qwen3.8-flash-free lane answered, the max-free lane still silent), the amber fired mid-lull before it, verdicts flat - the report arc reads r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull then wave-16 q landing. "
    "(9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"
)

BLOCKERS = (
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held twice (the r777 keyboard bridge is a named mechanism gated-witnessed in scripts/qa_r777_close.txt; "
    "AND the wave-16 interval recorded forward into the on-page band docs with the rendered value - a named mechanism updated with witnessed data; full golden QA anchored in scripts/qa_r777.txt).')"
)

COMMIT = (
    'git commit -m "r777: wave 16 landed mid-round and is recorded forward - bucket 10-30 09:00 q (qwen-only, 1/2 active) at +62m, band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) at the band sites with wave-16 framing; '
    'the amber fired live mid-round before the wave reset the quiet (second true firing); the lean run restarted (the r776 break note unrendered live, the wave-bound gate degraded to RECORDED as the handoff predicted); GLM-SILENT firms (q with no glm dial). '
    'Increment: the r777 keyboard bridge - the strip bucket chips gained tabIndex 0 + a focus-visible ring, the hover-only bucket data reachable by keyboard focus; the strip container title documents the bridge. '
    'Styling polish: the focus ring + focused-chip text emphasis. Snapshot discipline thirty-third close."'
)

for ln in lines:
    if ln.startswith("# r777 close ("):
        out.append("# r777 close (wave 16 landed mid-round: bucket 10-30 09:00 q at +62m, band /59/62; the keyboard bridge shipped; the amber fired live then the wave reset quiet): gates")
        header_done = True
        continue
    if ln.startswith("L.append('Task: Patrol round"):
        out.append(TASK); task_done = True; continue
    if ln.startswith("L.append('- R2 census"):
        out.append(R2); r2_done = True; continue
    if ln.startswith("L.append('- R4 witnesses"):
        out.append(R4); r4_done = True; continue
    if ln.startswith("L.append('- R5 increment"):
        out.append(R5); r5_done = True; continue
    if ln.startswith("L.append('- R6 close"):
        out.append(R6); r6_done = True; continue
    if ln.startswith('echo "$BR"'):
        if "broken" in ln:
            out.append('echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"')
        guard_done = True
        continue
    if ln.startswith("L.append('- CENSUS FLAT"):
        out.append(STAGE1); stage1_done = True; continue
    if ln.startswith("L.append('Next recommended action:"):
        out.append(HANDOFF); handoff_done = True; continue
    if ln.startswith("L.append('Blockers:"):
        out.append(BLOCKERS); blockers_done = True; continue
    if ln.startswith("git commit -m"):
        out.append(COMMIT); commit_done = True; continue
    out.append(ln)

missing = [n for n, f in [
    ("guard", guard_done), ("header", header_done), ("task", task_done),
    ("r2", r2_done), ("r4", r4_done), ("r5", r5_done), ("r6", r6_done),
    ("stage1", stage1_done), ("handoff", handoff_done),
    ("blockers", blockers_done), ("commit", commit_done),
] if not f]
if missing:
    print("PATCH2 FAILED - anchors missing:", missing)
    sys.exit(1)

open(P, "w").write("\n".join(out))
print("patched2: r777_close.sh (wave-16 narrative + guard degrade ok)")
