#!/usr/bin/env python3
"""r760 close-script surgery: rewrite the sed-carried r759 prose for the
route-tier grouping + wave-5 round, add the tier-state probe (RECORDED),
extend the export + prose env lines, rewrite the commit message.
Asserted all-or-nothing: every helper asserts exactly 1 hit before
mutating; the file is written only if every edit passes."""

PATH = '/home/z/my-project/scripts/r760_close.sh'
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

def insert_after(prefix, new_lines, desc):
    i = line_index(lambda l: l.startswith(prefix), desc)
    if i >= 0:
        out[i + 1:i + 1] = new_lines

# --- sanity: sed carry-over must already name r760 where expected; the
# spelled-out "Patrol round 759" and the literal "Round ID: r760" pointer
# are the known prose gaps this surgery exists to fix ---
for must in ["L.append('Task ID: r760')",
             "L.append('Round ID: r760 -> next patrol (job 473388)')",
             "grep -q 'r760 QA GREEN' scripts/qa_r760.txt"]:
    if src.count(must) != 1:
        fails.append('sanity missing/ambiguous: ' + must)

# --- header comment (line 2) ---
replace_line('# r760 close (',
             '# r760 close (route-tier grouping + wave-5 round): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched) -> tier-state probe (recorded) -> wave-strip probe (gated presence / recorded text, lanes figure included) -> divergence probe (RECORDED - expected while glm holds the tier) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
             'header comment')

# --- tier-state probe (RECORDED ONLY) after the legend guard ---
insert_after("echo \"$LEG\" | grep -Eq 'legend",
             ['# tier-state probe (r760): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).',
              'TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector(\'[data-testid=\\\\"corpus-tier-state\\\\"]\'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)',
              'echo "tier state: $TIER"'],
             'tier probe insert')

# --- export line gains R760_TIER ---
replace_line('export R754_TSC=',
             'export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF" R754_STRIP="$STRIP" R758_DIV="$DIV" R760_TIER="$TIER"',
             'export line')

# --- prose env line for the tier probe ---
insert_after("L.append('  divergence: '",
             ["L.append('  tier state: ' + os.environ.get('R760_TIER','(missing)'))"],
             'prose env line')

# --- Agent line ---
replace_line("L.append('Agent: NEXUS patrol",
             "L.append('Agent: NEXUS patrol (main agent - job 473388, 07:07 slot; opened on the r759 handoff)')",
             'agent line')

# --- Round ID pointer: promote r760 -> r761 (sed cannot see this one -
# r759's surgery wrote the next-round number literally) ---
replace_line("L.append('Round ID: r760 -> next patrol (job 473388)')",
             "L.append('Round ID: r761 -> next patrol (job 473388)')",
             'round id line')

# --- Task line (spelled-out round-759 prose gap: sed only maps r759/r=759) ---
replace_line("L.append('Task: Patrol round 759",
             "L.append('Task: Patrol round 760 - WAVE 5 RETURNS + ROUTE-TIER GROUPING SHIPS: the opening ro-SQL census read 109 ev / 30 runs / 73 nj vs the r759 close baseline 100/28/21/15/64 - +9 events / +2 runs / +9 no-judge rows, newest 23:07:15 UTC, ~58 min after wave 4 - the fifth wave, RETURNING after one steady slot (verdict/uncertain flat at 21/15, so the growth is all no-judge rows across 2 new runs). Shipped the r759-handoff named candidate: route-tier grouping of the legend chips - laneTierOf (name-heuristic rung classifier: intern-systemone=entry, paid rung=paid, plain fast-judge=verify, qwen=middle qwen route, glm=middle glm route; heuristic not a hardcoded lane list, an eighth lane still classifies as unrouted), a corpus-tier-state line in the legend header (per-route ACTIVE/silent vs the newest corpus bucket with n/N lane counts - the route-shift witness on-page), and a per-chip rung tag; legend title documents the semantics. While glm holds the tier the qwen diamonds stay EXPECTED; a qwen state flip silent->ACTIVE = the free routes returning.')",
             'task line')

# --- R1 line ---
replace_line("L.append('- R1 open probes:",
             "L.append('- R1 open probes: r759 closed by the 06:37 slot (2fb12add6 ship + 389ecfe92 sweep; the diamonds decoded - route-preference shift, not contraction); tree clean; server 200; opened r760 on the r759 handoff verbatim.')",
             'r1 line')

# --- R2 line ---
replace_line("L.append('- R2 trace diff + templates:",
             "L.append('- R2 templates + wave census: r760_qa.sh + r760_close.sh via the DUAL sed pattern (s/r=759/r=760/g + s/r759/r760/g) - zero r759 remnants (the round-759 prose gap handled by this surgery pass); ro-SQL census 109/30/21/15/73 - WAVE 5 (+9 ev / +2 runs / +9 nj, newest 23:07:15 UTC, ~58 min after wave 4; verdict/uncertain flat) -> wave-round path taken with the route-tier grouping increment.')",
             'r2 line')

# --- R3 line ---
replace_line("L.append('- R3 increment (run-kanban.tsx): laneBucketsOf gains laneSpread",
             "L.append('- R3 increment (run-kanban.tsx): laneTierOf rung classifier (name-heuristic: entry / paid / verify + the middle tier split by route), laneTiers memo (per-route lane lists + ACTIVE flags against the newest corpus-bucket key, derived from laneBuckets alone so the dependency stays single), corpus-tier-state span in the legend header (mid-qwen vs mid-glm with per-route ACTIVE/silent + n/N), per-chip rung tag (mid-qwen / mid-glm / entry / verify / paid / unrouted), legend title gains the r760 semantics sentence. MultiEdit note: the atomic batch reported failure on a stale anchor (laggards vs laggard lanes) yet applied edits 1-2 before aborting - tree verified marker-by-marker and the three missing edits re-applied cleanly (probe-verified, not assumed).')",
             'r3 line')

# --- R5 line ---
replace_line("L.append('- R5 QA + close:",
             "L.append('- R5 QA + close: the r760 golden QA ran GREEN (board probe at the wave-5 census; ld count + seven lanes; console 0 errors; the wave-strip text carries the newest buckets - the probe record below holds the lanes figures). Close probes: chip GATED presence / tone recorded; legend GATED (chips touched - the increment edits legend rendering; r756-r760 precedent honored); tier-state probe RECORDED (new r760); wave-strip probe presence GATED / text RECORDED (lanes figure included); divergence probe RECORDED ONLY (diamonds expected while glm holds the tier); + census + snapshot + worklog + commit + dual push.')",
             'r5 line')

# --- Stage Summary ---
replace_line("L.append('- THE DIAMONDS DECODED:",
             "L.append('- WAVE 5 + THE TIER WITNESS: the fifth wave returned after one steady slot (+9 ev / +2 runs / +9 nj; intervals w1->w2 ~56, w2->w3 ~16, w3->w4 ~41, w4->w5 ~58 min - the burst is intermittent, not periodic), and the legend now carries the route-tier grouping the r759 handoff named: the middle tier reads as two routes with per-route state against the newest corpus bucket, turning the r759 route-shift finding into a standing on-page witness (a qwen silent->ACTIVE flip = the free routes returning; a lag on intern/verify/paid = a genuine partial ladder). Eighth-lane and verdict/uncertain watches stay armed (the classifier labels an unknown lane unrouted on sight). Snapshot discipline sixteenth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')",
             'stage summary')

# --- Handoff next-action ---
replace_line("L.append('Next recommended action:",
             "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r760_qa.sh sed-adapted (DUAL pattern s/r=760/r=761/g + s/r760/r761/g); remember the round-760 prose gap (third explicit edit in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the chips, else RECORDED; tier-state probe (r760 precedent): RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED (lanes figure included); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the tier-state line + the (N lanes) figure are the route-shift witnesses - a qwen silent->ACTIVE flip = the free routes returning (diamonds vanish on qwen); glm ACTIVE->silent = the shift back; a lag on intern/fast-judge/jev = a genuine partial ladder - investigate immediately; any EIGHTH lane (the classifier labels it unrouted on sight), a VERDICT/UNCERTAIN growth wave, or a SIXTH wave = new signal. (5) Increment queue: per-bucket mini-bar rendering (CSS bars replacing the text strip) is the styling-polish candidate; divergence-first if any diamond changes; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix free-route silence since 21:12 UTC 10-29 (route-preference shift witness - the free-reach census in Settings may already reflect it; worth an Owner look alongside the platform report). (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')",
             'handoff line')

# --- Blockers line ---
replace_line("L.append('Blockers: none app-side;",
             "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the route-tier grouping shipped into a live fifth wave + full golden QA, anchored in scripts/qa_r760.txt and scripts/qa_r760_close.txt).')",
             'blockers line')

# --- Commit message ---
replace_line('git commit -m "r760: diamonds decoded',
             'git commit -m "r760: route-tier grouping ships + wave 5 returns. The opening census read 109/30/73 vs the r759 baseline 100/28/21/15/64 - +9 ev / +2 runs / +9 no-judge rows, newest 23:07:15 UTC (~58 min after wave 4), the fifth wave returning after one steady slot; verdict/uncertain flat. Increment (r759-handoff named candidate): laneTierOf rung classifier (name-heuristic: entry / paid / verify / middle-qwen / middle-glm - an eighth lane still classifies as unrouted), laneTiers memo with per-route ACTIVE/silent state against the newest corpus bucket, a corpus-tier-state line in the legend header (route-shift witness on-page), and a per-chip rung tag; legend title documents the semantics. While glm holds the tier the qwen diamonds stay expected; a qwen silent->ACTIVE flip = the free routes returning. Snapshot discipline sixteenth close."',
             'commit message')

# --- divergence-probe comment: stale r758-era semantics -> r760 route-shift truth ---
replace_line('# divergence probe (',
             '# divergence probe (r760): RECORDED ONLY - diamonds on the qwen lanes are EXPECTED while glm holds the middle tier (route-shift witness); a diamond appearing on intern/fast-judge/jev = a genuine partial ladder - investigate immediately (amber-tone doctrine).',
             'divergence comment')

if fails:
    print('SURGERY FAILED - file untouched')
    for f in fails:
        print('  -', f)
    raise SystemExit(1)

open(PATH, 'w').write('\n'.join(out))
print('surgery ok: all asserts passed, r760_close.sh rewritten')
