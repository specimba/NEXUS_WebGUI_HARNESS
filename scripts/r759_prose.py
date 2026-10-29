#!/usr/bin/env python3
"""r759 close-script surgery: asserted, all-or-nothing (write happens only if every assert passes)."""

PATH = '/home/z/my-project/scripts/r759_close.sh'
lines = open(PATH).read().split('\n')


def edit_sub(old, new, tag):
    hits = [i for i, l in enumerate(lines) if old in l]
    assert len(hits) == 1, tag + ': ' + str(len(hits)) + ' hits'
    lines[hits[0]] = lines[hits[0]].replace(old, new)


def replace_line(prefix, new, tag):
    hits = [i for i, l in enumerate(lines) if l.startswith(prefix)]
    assert len(hits) == 1, tag + ': ' + str(len(hits)) + ' hits'
    lines[hits[0]] = new


# --- comments ---
edit_sub(
    '# r759 close (mid-round wave pivot - divergence debuts into wave 4): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - zero is correct) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
    '# r759 close (diamond investigation + semantics correction + lanes figure): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched) -> wave-strip probe (gated presence / recorded text, lanes figure included) -> divergence probe (RECORDED - expected while glm holds the tier) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
    'header')

edit_sub(
    '# lane-legend probe (board view; chips WERE touched this round - the increment edits chip faces -> the legend gate runs, r756/r757 precedent).',
    '# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r759 precedent).',
    'legend comment')

# --- worklog prose ---
replace_line(
    "L.append('Agent: NEXUS patrol (main agent - job 473388, 06:07 slot",
    "L.append('Agent: NEXUS patrol (main agent - job 473388, 06:37 slot; opened on the r758 handoff + forward correction)')",
    'agent')

replace_line(
    "L.append('Task: Patrol round 758",
    "L.append('Task: Patrol round 759 - THE DIAMOND INVESTIGATION (the r758 correction first action) + SEMANTICS CORRECTED ON-PAGE: the wave-2/4 verbatim trace diff found the truth - every row ever names a 5-LANE CHAIN (intern-systemone, two middle-tier routes, fast-judge, jev paid rung; relay chain exhausted (top 2 hops, no verdict) and jev not armed (no key) unchanged across all eras) whose middle tier ALTERNATES ROUTES: either the qwen free pair (AIHubMix flash+max) or the glm-5.3 pair (Z.ai + Intern TokenPlan), never all four. Wave-2 alternated WITHIN one run (rows 0-1 qwen, rows 2-3 glm, same 21:12:23 timestamp); waves 3-4 standardized on glm (qwen free lanes silent since ~21:12 UTC). So the r758 contraction/truncation interpretation was WRONG in mechanism - traces were never 7-wide; the divergence diamonds fired on a ROUTE-PREFERENCE SHIFT. Shipped: the instrument on-page text corrected (diamond span titles, chip-title clause, legend title, helper comments now say recent-bucket lag - route-preference shift or partial ladder - check the laggards before interpreting; stale full-ladder premise sentences removed), and the named-candidate increment sharpened: laneSpread (distinct lanes named per bucket) rendered in the wave strip as (N lanes) - a mixed-tier bucket reads 7, single-tier 5, making route alternation an on-page witness.')",
    'task')

replace_line(
    "L.append('- R1 open probes: r757 closed",
    "L.append('- R1 open probes: r758 closed by the 06:07 slot (3455b7bc6 ship + a617ac734 sweep + 42e58ecdc forward correction); tree clean; server 200; census 100/28/21/15/64 STEADY at the close baseline (no wave 5); opened r759 with the correction first action.')",
    'r1')

replace_line(
    "L.append('- R2 templates + census:",
    "L.append('- R2 trace diff + templates: wave-2 run_23430243dca4 vs wave-4 run_918b2b94af40 verbatim notes plus old-row baselines (16:36 glm, 17:17 qwen): ALL rows 5 lanes; middle tier alternates qwen pair / glm pair; wave-2 rows 0-1 qwen + rows 2-3 glm inside one run; wave-4 all glm; relay chain exhausted (top 2 hops) + jev not armed (no key) unchanged. The alternation predates the waves, so nothing was removed from any config - the qwen free routes simply stopped being picked. r759_qa.sh + r759_close.sh via the DUAL sed pattern (s/r=758/r=759/g + s/r758/r759/g) - zero r758 remnants (the round-758 prose gap handled by this surgery pass).')",
    'r2')

replace_line(
    "L.append('- R3 increment (run-kanban.tsx): laneDivergenceOf",
    "L.append('- R3 increment (run-kanban.tsx): laneBucketsOf gains laneSpread (distinct lanes named per bucket, computed from the per-lane bucket counts in one post-pass), the wave strip renders (N lanes) per bucket in corpus mode (filtered mode unchanged), strip title documents the lanes figure + the route-alternation shape, diamond semantics text corrected on-page (span title, chip-title clause, legend title), stale full-ladder premise sentences removed from the strip title and helper comments.')",
    'r3')

replace_line(
    "L.append('- R4 gates:",
    "L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')",
    'r4')

replace_line(
    "L.append('- R5 QA + close:",
    "L.append('- R5 QA + close: the r759 golden QA ran GREEN (board probe steady 28 runs / 100 ev / 64nj; ld count 64, seven lanes - the ld title lists all seven including the silent qwen pair; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (chips touched - semantics text edits; r756-r759 precedent honored); wave-strip probe presence GATED / text RECORDED (now carrying the lanes figure); divergence probe RECORDED ONLY (four diamonds were live at the r758 close and are EXPECTED while glm holds the tier); + census + snapshot + worklog + commit + dual push.')",
    'r5')

replace_line(
    "L.append('- FOUR-WAVE BURST, the new cadence record:",
    "L.append('- THE DIAMONDS DECODED: the r758 four-diamond debut was a route-preference shift, not a partial ladder - the middle tier of the 5-lane chain stopped routing through the qwen free pair after ~21:12 UTC (last qwen appearance 21:12:23; wave-3 at 21:28 onward is glm-only). The 5-lane chain shape holds across ALL eras (16:36 glm, 17:17 qwen), so no config change is witnessable in the trace: the qwen free routes stopped being picked. Candidate causes are Owner-queue items (AIHubMix free-quota exhaustion or a route-priority change upstream - the relay lives outside this repo; the app reads the trace verbatim). The wave strip (N lanes) figure turns route alternation into an on-page witness: the 21:00 bucket reads 7 lanes (both routes named in one bucket), single-tier buckets 5. Instrument semantics corrected forward: a diamond = recent-bucket lag = route shift OR partial ladder - the interpretation step is mandatory before reacting. Cadence record unchanged: the four-wave burst stands (w5 watch continues). Snapshot discipline fifteenth close. Witness six-legged, all green.')",
    'stage')

replace_line(
    "L.append('Round ID: r759 -> next patrol (job 473388)')",
    "L.append('Round ID: r760 -> next patrol (job 473388)')",
    'round id')

replace_line(
    "L.append('Next recommended action: (1) NORMAL WATCH",
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r759_qa.sh sed-adapted (DUAL pattern s/r=759/r=760/g + s/r759/r760/g); remember the round-759 prose gap (third explicit edit in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the chips, else RECORDED; wave-strip probe: presence GATED / text RECORDED (lanes figure included); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH (new, r759): the (N lanes) figure is the route-shift witness - a bucket reading 7 = both routes named; while glm holds the tier, diamonds on the qwen lanes are EXPECTED (muted-until-shift both ways: a diamond VANISHING on qwen = the free routes returning; a diamond appearing on intern/fast-judge/jev = a genuine partial ladder - investigate immediately); any EIGHTH lane, a VERDICT/UNCERTAIN growth wave, or a FIFTH consecutive/returning wave = new signal. (5) Increment queue: on-page route-tier grouping of the legend chips (label the qwen pair + glm pair as one middle tier with per-route state) is the named candidate; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; NEW: AIHubMix free-route silence since 21:12 UTC 10-29 (route-preference shift witness - the free-reach census in Settings may already reflect it; worth an Owner look alongside the platform report). (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')",
    'next action')

replace_line(
    "L.append('Blockers: none app-side",
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the diamond investigation discharged with the route-shift finding + semantics corrected on-page + the lanes figure shipped, anchored in scripts/qa_r759.txt and scripts/qa_r759_close.txt).')",
    'blockers')

replace_line(
    'git commit -m "r759: mid-round wave pivot',
    'git commit -m "r759: diamonds decoded - route-preference shift, not contraction; lanes figure ships. The wave-2/4 trace diff found every row names a 5-lane chain whose middle tier ALTERNATES routes (qwen free pair vs glm-5.3 pair, never all four); wave-2 alternated within one run (rows 0-1 qwen, rows 2-3 glm, 21:12:23 UTC), waves 3-4 are glm-only (qwen free lanes silent since ~21:12 UTC; alternation predates the waves so no config change is witnessable). The r758 truncation interpretation was wrong in mechanism - traces were never 7-wide; the diamonds fired on the route shift. On-page corrections: diamond titles, chip-title clause and legend text now say recent-bucket lag (route shift or partial ladder - check the laggards before interpreting); stale full-ladder premise sentences removed. Increment: laneSpread in the wave strip - (N lanes) per bucket makes route alternation an on-page witness (mixed-tier bucket = 7 lanes). Snapshot discipline fifteenth close."',
    'commit')

open(PATH, 'w').write('\n'.join(lines))
print('surgery ok: all asserts passed, file written')
