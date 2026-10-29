#!/usr/bin/env python3
"""r761 close-script surgery: rewrite the sed-carried r760 prose for the
mini-bar strip + wave-6 round. Asserted all-or-nothing: every helper
asserts exactly 1 hit before mutating; the file is written only if every
edit passes. Known prose gaps handled here: the spelled-out 'Patrol
round 760' (sed only maps r760/r=760) and the literal 'Round ID: r761'
next-round pointer (sed cannot see it)."""

PATH = '/home/z/my-project/scripts/r761_close.sh'
src = open(PATH).read()
out = src.split('\n')
fails = []

def line_index(pred, desc):
    hits = [i for i, l in enumerate(out) if pred(l)]
    if len(hits) != 1:
        fails.append(desc + ': ' + str(len(hits)) + ' hits')
        return -1
    return hits[0]

def replace_line(prefix, new, desc):
    i = line_index(lambda l: l.startswith(prefix), desc)
    if i >= 0:
        out[i] = new

# --- sanity: sed carry-over must already name r761 where expected ---
for must in ["L.append('Task ID: r761')",
             "L.append('Round ID: r761 -> next patrol (job 473388)')",
             "grep -q 'r761 QA GREEN' scripts/qa_r761.txt"]:
    if src.count(must) != 1:
        fails.append('sanity missing/ambiguous: ' + must)

# --- header comment (line 2) ---
replace_line('# r761 close (',
             '# r761 close (mini-bar strip + wave-6 round): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched via the strip the legend sits in; strip title edited) -> tier-state probe (recorded) -> wave-strip probe (gated presence / recorded text, lanes figure + bars included) -> divergence probe (RECORDED - expected while glm holds the tier) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
             'header comment')

# --- Round ID pointer: promote r761 -> r762 ---
replace_line("L.append('Round ID: r761 -> next patrol (job 473388)')",
             "L.append('Round ID: r762 -> next patrol (job 473388)')",
             'round id line')

# --- Agent line ---
replace_line("L.append('Agent: NEXUS patrol",
             "L.append('Agent: NEXUS patrol (main agent - job 473388, 07:37 slot; opened on the r760 handoff)')",
             'agent line')

# --- Task line (spelled-out round-760 prose gap) ---
replace_line("L.append('Task: Patrol round 760",
             "L.append('Task: Patrol round 761 - WAVE 6 RETURNS, MINI-BAR STRIP SHIPS: the opening ro-SQL census read 118 ev / 31 runs / 82 nj vs the r760 close baseline 109/30/21/15/73 - +9 events / +1 run / +9 no-judge rows, newest 23:20:39 UTC, only ~13 min after wave 5 (intervals w4->w5 ~58, w5->w6 ~13 - erratic, re-accelerating; verdict/uncertain flat again, all growth no-judge rows). Shipped the r760-handoff styling-polish candidate: per-bucket mini-bars in the wave strip - height scales 2px per row (16px cap, 2px floor), an AMBER bar marks a mixed-tier (both-routes, >5 lanes) bucket, muted bars are single-tier - the route watch now reads bar color at a glance; strip title documents the scale and the color semantics. The bar transform keeps the exact text line (labels + counts + (N lanes)) as siblings, so the recorded probe format and the screen-reader path are unchanged.')",
             'task line')

# --- R1 line ---
replace_line("L.append('- R1 open probes:",
             "L.append('- R1 open probes: r760 closed by the 07:07 slot (b40eb1d63 ship + 577e6e608 sweep; route-tier grouping + wave 5); tree clean; server 200; ro-SQL census 118/31/21/15/82 - WAVE 6 (+9 ev / +1 run / +9 nj, newest 23:20:39 UTC, ~13 min after wave 5; verdict/uncertain flat) -> wave-round path taken with the mini-bar strip increment.')",
             'r1 line')

# --- R2 line ---
replace_line("L.append('- R2 templates + wave census:",
             "L.append('- R2 templates: r761_qa.sh + r761_close.sh via the DUAL sed pattern (s/r=760/r=761/g + s/r760/r761/g) - zero mechanical remnants; the round-760 prose gap (spelled-out Patrol round 760 + the literal Round ID r761 pointer) handled by this surgery pass; wave-6 census taken in the same R1 batch.')",
             'r2 line')

# --- R3 line ---
replace_line("L.append('- R3 increment (run-kanban.tsx): laneTierOf rung classifier",
             "L.append('- R3 increment (run-kanban.tsx): the wave strip map replaced with per-bucket bar+label spans (inline-flex items-end, whitespace-nowrap; bar = w-1.5 rounded-sm, height Math.max(2, Math.min(16, count*2))px, amber-500/40 when spread > 5 lanes in corpus mode, muted-foreground/30 otherwise; separators kept as text nodes so the recorded text format is byte-identical), strip title gains the mini-bar doc sentence. Two-edit MultiEdit verified applied by output diff this time (r760 lesson: verify markers, not the tool ack).')",
             'r3 line')

# --- R5 line ---
replace_line("L.append('- R5 QA + close:",
             "L.append('- R5 QA + close: the r761 golden QA ran GREEN first-try (board probe at the wave-6 census 31 runs / 118 ev / 82nj, chips 32; ld count 82, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (strip title edited - the legend panel sits in the same view; r756-r761 precedent honored); tier-state probe RECORDED (r760 precedent); wave-strip probe presence GATED / text RECORDED (labels + lanes figures unchanged in format); divergence probe RECORDED ONLY (diamonds expected while glm holds the tier); + census + snapshot + worklog + commit + dual push.')",
             'r5 line')

# --- Stage Summary ---
replace_line("L.append('- WAVE 5 + THE TIER WITNESS:",
             "L.append('- SIX WAVES, ERRATIC CADENCE: w4->w5 ~58 min then w5->w6 ~13 min - the burst is neither periodic nor decaying; magnitude steady at +9 nj per wave for three waves now (w4 +4, w5 +9, w6 +9). The mini-bar strip turns the bucket row into a glanceable magnitude+composition read: bar height = row count, bar color = tier composition (amber = both-routes bucket). Every wave since r759 stayed glm-only (qwen free lanes silent since 21:12 UTC 10-29) - the tier-state line and the diamonds keep watching for the flip both ways. Eighth-lane and verdict/uncertain watches stay armed. Snapshot discipline seventeenth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')",
             'stage summary')

# --- Handoff next-action ---
replace_line("L.append('Next recommended action:",
             "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r761_qa.sh sed-adapted (DUAL pattern s/r=761/r=762/g + s/r761/r762/g); remember the round-761 prose gap (spelled-out Patrol round 761 + the literal Round ID r762 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED (bars changed nothing in the text format); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: tier-state line + bar color + (N lanes) figure are the route-shift witnesses - a qwen silent->ACTIVE flip = the free routes returning (diamonds vanish on qwen, strip bars go amber on new both-routes buckets); glm ACTIVE->silent = the shift back; a lag on intern/fast-judge/jev = a genuine partial ladder - investigate immediately; any EIGHTH lane (the classifier labels it unrouted on sight), a VERDICT/UNCERTAIN growth wave, a SEVENTH wave, or an interval-pattern break = new signal. (5) Increment queue: bucket-bound tooltips on the mini-bars (hover shows the exact bucket start-end UTC) is the named styling-polish candidate; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix free-route silence since 21:12 UTC 10-29 - now spanning three waves (w5/w6 glm-only) - worth an Owner look alongside the platform report. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')",
             'handoff line')

# --- Blockers line ---
replace_line("L.append('Blockers: none app-side;",
             "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the mini-bar strip shipped into a live sixth wave + full golden QA, anchored in scripts/qa_r761.txt and scripts/qa_r761_close.txt).')",
             'blockers line')

# --- Commit message ---
replace_line('git commit -m "r761: route-tier grouping ships',
             'git commit -m "r761: mini-bar wave strip ships + wave 6 returns. The opening census read 118/31/82 vs the r760 baseline 109/30/21/15/73 - +9 ev / +1 run / +9 no-judge rows, newest 23:20:39 UTC, only ~13 min after wave 5 (intervals w4->w5 ~58, w5->w6 ~13 - erratic, re-accelerating); verdict/uncertain flat, all growth no-judge rows. Increment (r760-handoff styling-polish candidate): per-bucket mini-bars in the wave strip - height 2px per row (16px cap), amber bar = mixed-tier both-routes bucket (>5 lanes), muted = single-tier; the exact text line (labels + counts + (N lanes)) kept as siblings so the recorded probe format is unchanged; strip title documents scale + color semantics. Every wave since r759 glm-only - the tier-state line and diamonds keep watching both ways. Snapshot discipline seventeenth close."',
             'commit message')

if fails:
    print('SURGERY FAILED - file untouched')
    for f in fails:
        print('  -', f)
    raise SystemExit(1)

open(PATH, 'w').write('\n'.join(out))
print('surgery ok: all asserts passed, r761_close.sh rewritten')
