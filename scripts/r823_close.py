#!/usr/bin/env python3
# r823 close: append the round handoff to worklog.md (never overwrite),
# record the corpus snapshot number-only (watch retired per r821), and
# verify the vault stays gitignored.
import json, os, subprocess

PROJ = "/home/z/my-project"
entry_tail = """Task ID: r823 (03:07 slot; HEAD opened at 939d6d8a7 the r822 close, tree clean, origin AND fork 0 ahead at open; server SURVIVED a fifteenth time - 200 at open, no restart spent; mem 2.6/3.9 GB steady at open)
Agent: NEXUS patrol (main agent - job 473388)
Task: Patrol round 823 - THE SEARCH HITS KNOW THEIR CHAT, plus a QA-FOUND CRASH FIX that outranked it: the handoff's first verify-first candidate (command palette / global-search lists) surveyed honestly - the palette is cmdk-native (group headings, option semantics), the stream container and option rows carry role=listbox/option/aria-selected, BUT the message-hit rows' own content said only WHO spoke + the snippet while the conversation they belong to lived ONLY in the visual group header (a screen reader navigating by option had no idea which chat a jump would open). Each message-hit row now utters its conversation ("{convTitle} - {who}, {relTime}: {snippet}" on the BUTTON - the r822 interactive-row rule), and all four option-row classes gain focus-visible parity with their hover tint. THEN the witness hunt turned into the round's real prize: five witness attempts saw the search dialog "self-close" 0.4-4s after any query - v6 dumped the browser console and CAUGHT the truth: TypeError "Cannot read properties of undefined (reading 'toLowerCase')" inside <GlobalSearchDialog>, swallowed by the error boundary (the "self-close" was the crash all along). Root cause: the search scans read TYPED-OPTIONAL strings unguarded - an agent or workflow saved without a description (or a conversation without a title) bricked the global search for EVERY query. Guarded all of them ((a.description ?? "") / (wf.description ?? "") / (st.label ?? "") / (conv.title ?? "") / (a.name/role ?? "") / (wf.name ?? "")); the dialog now scans safely and the witness went green.
Work Log:
- R1 open + probe (HEAD 939d6d8a7, server 200 - fifteenth survival, no restart; mem 2.6/3.9 GB); r822 handoff verified as the last section.
- R2 r823_qa.sh derived (0 stale, 5 cache-busters ?r=823) + FULL GOLDEN QA GREEN on first derive (console 0 errors, page errors none; ld and lane-matrix honest skips).
- R3 the search surface surveyed: palette cmdk-native; global-search rows carry listbox/option/aria-selected; the REAL gap = message hits' conv context lives only in the group header (visual), utterances wired to the buttons (r822 rule) + focus-visible parity polish.
- R4-R6 witness v1-v3: three honest GUARDs - assertion pointed at the listitem attribute while the utterance lives on the row's button (fixed); the dialog "closed itself" between steps; an atomic single-eval chain still found it gone.
- R7-R9 v4-v5: in-window read (0.4s after the input event) STILL gone; the #/workflows dodge failed - the heartbeat-at-root theory dead; v6 used the browser's REAL keyboard path (keyboard inserttext) and added lifecycle diagnostics; the console dump then named the crash (TypeError toLowerCase-of-undefined in GlobalSearchDialog, error boundary).
- R10-R11 the fix: the scans guard every typed-optional string; the r823 comment names the crash and its reach (any description-less agent/workflow bricked search for every query - real-user reachable, not just seed-shape).
- R12 WITNESS GREEN first run after the fix: dialogOpen:true, options:1, utterance "r823 witness conv - WitnessWorker, just now: the witnessneedle hides in this sentence" asserted live through Ctrl+K -> Search all chats -> real-keyboard needle; both stores (nexus-agents + nexus-conversations) restored and verified clean through the write-back-safe dance. LESSON NAMED: when a UI "closes itself", dump the browser console BEFORE theorizing - the error boundary had been eating the truth for five rounds.
Stage Summary: the global search dialog no longer crashes on typed-optional-missing agents/workflows/conversations (QA-found, user-facing, console-verified) and its message hits now speak which chat they belong to; five witness GUARDs became a console-first debugging doctrine; the goldens stayed green throughout (the crash was query-gated and never on their paths).
Round Handoff:
Round ID: r824 -> next patrol (job 473388)
Next recommended action: (1) golden QA: scripts/r823_qa.sh is the proven template (copy + rename r823->r824; bump ?r=823 -> ?r=824 alongside the plain rename); consider ADDING a search-dialog step to the golden (Ctrl+K -> Search all chats -> type a 2-char query -> assert no console error) so the crash class stays guarded forever. (2) Increment candidates: QA-found bugs first; else the spoken-surface arc: the search dialog is DONE (utterance + crash fix) - remaining verify-first candidates: the LaneRideTally detail in the adoption pipeline, or the conversation-list sidebar rows (conversation-list.tsx). (3) WITNESS DOCTRINE carried + one add: CONSOLE-FIRST - when DOM goes missing, `agent-browser console` BEFORE new theories (the error boundary eats render crashes silently; a "self-closing dialog" was a TypeError for five rounds); the r822 rules stand (interactive rows name on the BUTTON; mid-dance GUARDs need manual true-priors restore; dual-store seeding + write-back-safe cleanup). (4) THE CARRIED DOM WITNESSES: cortex lane-age caption green-verdict probe (10 consecutive reds); ladder details disclosure >6-entry boards payload; 401 quickCheck + provider/token notes remain real-event-only. (5) Owner queue carried: CORTEX 401 = Owner-side config (disable Enforce JWT verification for nexus-cortex-harness ONLY, set the edge secrets, the SAME random phrase as CORTEX_SHARED_SECRET into the app Cortex key field, Probe again); KICK widget, PAT rotation, Webshare token, vault re-key BACKUP-FIRST; upload/nexus-provider-vault.json holds LIVE KEYS, never commit (verify at every close). (6) MEM-GUARD read at open. (7) Snapshot seventy-sixth next close (number only; watch retired). (8) r707 mechanism-per-round: HELD (the search utterances + the crash guard are a named, live-witnessed user-facing mechanism; the console-first doctrine is the named evaluation).
Blockers: none app-side; TASK-101/102 stale (absent from TASKS.md - do not chase); the cortex lane stays Owner-side config.
"""

# corpus snapshot seventy-fifth (number only)
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
    f"- R13 snapshot SEVENTY-FIFTH: db/corpus-snapshots/latest.json rows={rows}; newest timestamped {newest} - number only, watch retired. {vault_line}.\n"
    "Stage Summary:",
)

wl = os.path.join(PROJ, "worklog.md")
with open(wl, "a") as f:
    f.write("\n" + final)

print(f"corpus-75th rows={rows} newest={newest} {vault_line}")
print(f"worklog appended: {os.path.getsize(wl)} bytes total")
