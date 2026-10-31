#!/usr/bin/env python3
# r822 close: append the round handoff to worklog.md (never overwrite),
# record the corpus snapshot number-only (watch retired per r821), and
# verify the vault stays gitignored.
import json, os, subprocess

PROJ = "/home/z/my-project"
entry_tail = """Task ID: r822 (02:37 slot; HEAD opened at b3e7a0123 the r821 close, tree clean; server SURVIVED a fourteenth time - 200 at open, no restart spent; mem 2.7/3.9 GB steady at open; origin AND fork verified 0 ahead at open - the r821 commit landed on both)
Agent: NEXUS patrol (main agent - job 473388)
Task: Patrol round 822 - THE TOOL STRIP SPEAKS (the handoff's chat-message-lists candidate, verified against the real markup first): the message stream container is an honest role=log ("Chat messages") and the attached images/files lists were already spoken, but the tool-calls strip inside assistant messages was a BARE STACK of disclosure buttons (no list semantics - no grouping, no count, no unit) and each card's outcome lived ONLY in the status icon's own aria-label, so a screen reader heard ungrouped buttons and had to open each one to learn what happened. Now the wrapper is a labeled list ("Tool activity - N calls"), every card self-describes in one utterance ("Web Search - Succeeded, 1.2s") mirroring the visible copy, the status icons are aria-hidden so the status word has ONE source of truth (the r819 statusWord lesson), and the cards gain the arc's hover polish (transition-colors hover:border-border/60).
Work Log:
- R1 open + probe (HEAD b3e7a0123, server 200 - fourteenth survival, no restart; mem 2.7/3.9 GB); r821's entry and double push verified at open, this slot ran as r822 against the r821 handoff.
- R2 r822_qa.sh derived (0 stale, 5 cache-busters ?r=822) + FULL GOLDEN QA GREEN on first derive (console 0 errors, page errors none; ld and lane-matrix honest skips).
- R3 the chat surface surveyed: stream container honest role=log, attachment lists already spoken, ToolCallCard strip = real gap (bare stack, outcome icon-only) - the increment targeted it.
- R4 witness v1 GUARDed honestly and taught two things: (a) the assertion read the listitem's aria-label ATTRIBUTE, but the utterance lives on the row's disclosure BUTTON (the honest home for an interactive row's name - the listitem groups, the button names; labels came back [null,null] with list:true n:2); (b) a GUARD that fires mid-dance leaves the seed in the stores - recovered by manually restoring from the sessionStorage TRUE priors (saved before the seed polluted) and verifying CLEAN before re-running; a blind re-run would have saved the SEEDED state as priors (the pollution-chain trap, now doctrine).
- R5 witness v2 GREEN first try: "Web Search - Succeeded, 1.2s" and "Web Search - Failed, 340ms" (fmtMs renders 1200 -> "1.2s", 340 -> "340ms") asserted live through the #/chat/conv-r822-witness deep link; both stores (nexus-agents + nexus-conversations) restored and verified clean through the write-back-safe dance.
- GATES unmasked: tsc_exit=0 - lint_exit=0 (0 errors, 28 warnings, per-file set md5 c965c8e8961745824f858ce1f12b475a identical to baseline) - plus a harness-recipe note: grep -c "warning" over-counts the summary line (29 vs the true 28) and the per-FILE set md5 recipe is the sorted file-path LIST; verified against the surviving r814 log - the same recipe reproduces c965... on r814/r818/r822 alike, the set is unchanged across eight rounds.
Stage Summary: the chat tool strip now speaks its count and every card speaks its outcome in one utterance (grouped, labeled, status word single-sourced); the witness surfaced the interactive-row assertion rule (button carries the name, listitem carries the grouping) and the mid-dance-GUARD recovery rule; gates green with the baseline warning set reproduced three ways; golden QA green on first derive.
Round Handoff:
Round ID: r823 -> next patrol (job 473388)
Next recommended action: (1) golden QA: scripts/r822_qa.sh is the proven template (copy + rename r822->r823; bump ?r=822 -> ?r=823 alongside the plain rename). (2) Increment candidates: QA-found bugs first; else the spoken-surface arc: the chat tool strip is DONE - remaining verify-first candidates: the command palette / global-search results lists, the LaneRideTally detail in the adoption pipeline, or the conversation-list sidebar rows (conversation-list.tsx). (3) WITNESS DOCTRINE carried + widened twice: interactive disclosure rows carry their utterance on the BUTTON (assert [role=listitem] button aria-label, not the listitem attribute); a GUARD firing mid-dance leaves the seed in the stores - restore from the sessionStorage true-priors MANUALLY and verify CLEAN before any re-run (blind re-run saves the seeded state as priors); dual-store seeding + write-back-safe cleanup (restore -> navigate -> file-fix -> re-navigate -> verify store-clean) stands. (4) THE CARRIED DOM WITNESSES: cortex lane-age caption green-verdict probe (10 consecutive reds); ladder details disclosure >6-entry boards payload; 401 quickCheck + provider/token notes remain real-event-only. (5) Owner queue carried: CORTEX 401 = Owner-side config (disable Enforce JWT verification for nexus-cortex-harness ONLY, set the edge secrets, the SAME random phrase as CORTEX_SHARED_SECRET into the app Cortex key field, Probe again); KICK widget, PAT rotation, Webshare token, vault re-key BACKUP-FIRST; upload/nexus-provider-vault.json holds LIVE KEYS, never commit (verify at every close). (6) MEM-GUARD read at open (2.7/3.9 GB steady). (7) Snapshot seventy-fifth next close (number only; the cadence watch stays retired). (8) r707 mechanism-per-round: HELD (the tool-strip utterances are a named, live-witnessed user-facing mechanism; the button-name assertion rule and the mid-dance-GUARD recovery are the named evaluations).
Blockers: none app-side; TASK-101/102 stale (absent from TASKS.md - do not chase); the cortex lane stays Owner-side config.
"""

# corpus snapshot seventy-fourth (number only)
lat = os.path.join(PROJ, "db/corpus-snapshots/latest.json")
rows = None
try:
    with open(lat) as f:
        rows = json.load(f).get("count")
except Exception as e:
    rows = f"unreadable:{e}"
snaps = sorted(
    (fn for fn in os.listdir(os.path.join(PROJ, "db/corpus-snapshots"))
     if fn.startswith("corpus-")),
    reverse=True,
)
newest = snaps[0] if snaps else "none"

# vault gitignore check (never commit live keys)
gi = subprocess.run(
    ["git", "check-ignore", "-q", "upload/nexus-provider-vault.json"],
    cwd=PROJ,
).returncode == 0
vault_line = f"vault-gitignored:{'yes' if gi else 'NO-CONTACT-OWNER'}"

final = entry_tail.replace(
    "Stage Summary:",
    f"- R8 snapshot SEVENTY-FOURTH: db/corpus-snapshots/latest.json rows={rows}; newest timestamped {newest} - number only, watch retired. {vault_line}.\n"
    "Stage Summary:",
)

wl = os.path.join(PROJ, "worklog.md")
with open(wl, "a") as f:
    f.write("\n" + final)

print(f"corpus-74th rows={rows} newest={newest} {vault_line}")
print(f"worklog appended: {os.path.getsize(wl)} bytes total")
