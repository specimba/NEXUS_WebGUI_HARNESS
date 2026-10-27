# NEXUS Vault & RSI Loop — Expert Review Session

- **Session**: web-1661896a · chat a34f44b2 · 2026-10-28 (Istanbul)
- **Trigger**: Owner directive — *"check all related sections and add directly copied pastes from the platform itself on how it looks and where we need to fix and improve, brainstorming with your experts in a long-term session properly for our new version's stable fixed update and autonomous RSI updating cycle looping successfully configured with perfect backend wiring."*
- **Evidence**: three Owner captures of the live preview (`#/vault` anchor), plus a read-only expert audit (653-a) of the vault, receipts panel and RSI wiring.
- **Status**: living document. Future rounds append to §6; nothing above it is rewritten.

---

## 1. What the Owner's captures show (platform verbatim, digested)

The three pastes are three snapshots of the same surface minutes apart (sidebar countdown `next 24m → 17m → 8m`), which itself witnesses the patrol heartbeat ticking. Read as evidence:

| Surface | What the capture shows | Verdict |
|---|---|---|
| Sidebar | `cron 1/1 · next Nm · v1.0.0 · local-first · BYOK`, four views + Settings | healthy; cron ratio counts agentTurns only (r300) |
| Settings tabs | What's fixed / Usage / Providers / Local models / Model Relay / Vault / GitHub / Referrals / BYOK / Cortex Edge / Egress / Behavior / Evolution / Profile / Appearance / Your Data | all 16 sections reachable from one strip |
| What's fixed | header reads **"r186-r516 shipped…"**, newest entry r516 | **STALE** — confirmed: no r517+ entry existed in the repo. Fixed this round (§3 F1) |
| Usage | 0 messages · 7d, 24.3s avg response, 13 tool runs, tool mix (URL Reader 7, Web Search 3…), "11 of 16 tool types unused" | honest census rendering correctly |
| Providers | 17/18 ready, Vyce `9 live`, key validated `✓ 9582ms`, credits `webgui2 · $277.00 · 600 RPM` | gallery + live-catalog refresh healthy |
| Vault (`#/vault`) | deep link lands on the Automation vault; lanes `3 of 3 keyed` (Exa, Webshare), reveal/test/remove per slot, Share deep link | card functional; Backup/Restore gap found (§3 F2) |
| Local models | RTX 4070 budget ~5.9 GB, "27 models fit your budget", 30+ Load rows, HF field examples | WebGPU tier honest and populated |
| Model Relay | emerald "Benchmark intelligence" panel, `Intel 0.948` badges, free-reach census "parsed from freellm.sh as of 4h ago" | r516 architecture rendering as designed (re-witnessed live r654) |

## 2. The honest headline finding

**The receipts panel was 138 rounds stale.** Rounds r517–r653 shipped through worklog + `docs/strategy/TASKS.md` only; the in-app "What's fixed" panel — the r195 doctrine that says *fixes stop living only in git* — never received a new entry. The r294 anti-stale guard derives the header from the entries array, so `r186-r516` kept telling the truth about a *backlog that had stopped growing*. The Owner's paste is what caught it: the exact failure mode r195 was built to prevent, resurfacing one layer up.

**Fixed in r654**: the arcs r517→r654 are backfilled as compressed digests (each sourced from the round's commit chain), the panel leads with r654, the range label now reads `r186-r654`, and patrol rounds feed the panel again.

## 3. Findings & fixes (ranked)

- **F1 · Receipts stall (P0) — SHIPPED r654.** Root cause: no round appended to `whats-fixed.tsx` after r516; no render cap existed to hide entries (the array simply ended). Fix: 9 arc-digest entries + bounded internal scroll (`max-h-[38rem]`, violet scrollbar) + `tabular-nums` round badges (house 10px chip language).
- **F2 · Vault backup/restore has an endpoint but no button (P1) — STAGED.** `/api/vault/backup` GET/POST exists and works; the vault card's only recovery path is a CLI hint (`bun scripts/seedwrite.ts --import`). Two one-click buttons (Backup downloads JSON; Restore uploads it) are ~25 LOC on `automation-vault-card.tsx`. **Deliberately deferred**: a parallel session (OWN-b) held uncommitted edits on that exact file this round — collision protocol says don't touch a moving seam. Top of the r655 handoff.
- **F3 · Empty-vault dead end (P2).** With zero slots stored, the card offers no "Guided setup" jump (the Providers gallery has the 4-line pattern to copy). Cheap, high-value for the "stable fixed update" onboarding story.
- **F4 · Vestigial localStorage label (P3).** `storage-usage.tsx:76` labels a `nexus-automation-vault` key that nothing in src/ writes (the vault is server SQLite since the AES-256-GCM migration). The Storage meter should not name a ghost.
- **F5 · Receipts doctrine gap (P0, process).** Code fixes the symptom; the loop fix is procedural — every patrol round that ships a user-visible change appends one `FixNote` here. Added to the round handoff checklist (§6).

## 4. The RSI loop — wiring map (audit-verified)

The autonomous cycle the Owner asked about is **fully wired end-to-end**; every node below is imported, invoked and observable (file:line from audit 653-a):

```
[cron 473388 agentTurn]  →  patrol round (this document's engine)
        ↓ runs golden QA + ships increment + appends worklog + receipts
[in-app schedules]       →  automation-executor.ts claim loop (15s tick, :55)
                            + in-flight overlap guard (:885-893)      WIRED
        ↓ reads keys
[Automation vault]       →  SQLite AES-256-GCM slots, read directly by the
                            server lane (:946-948, resolveServerDialFromSlots :165) WIRED
        ↓ dials through
[Relay chain]            →  benchmark-led blend 0.65 live · 0.35 Elo
                            (relay.ts:797-811, intelligence.ts:107)   WIRED
                            + rescue-lane memory 15m
                            (provider-rotation.ts:123-138)            WIRED
        ↓ produces
[Run archive]            →  trace-trial harness chips (lineage honesty)
                            → precedent lane (precedent-lane.ts:193 shared
                            mapper → RRF top-2 → both-legs gate →
                            two-occurrence block)                     WIRED, LIVE-WITNESSED r653
        ↓ completes runs
[Evolution engine]       →  spawn-proposal-engine.ts maybeProposeSpawn (:230)
                            called at run completion (workflow-runner.ts:1012),
                            Evolution Inbox panel                     WIRED
        ↓ proposes
[Owner / patrol]         →  proposals → next slices → next round     THE LOOP CLOSES
```

**Staged gaps (honest, none block the loop):** (a) looped-path FAIL-branch live-witness — staged since r645, needs a Looped ×2 workflow with a harsh gate on a healthy free ladder; (b) call-log lineage schema-hardening — every tool-call note carries result status + step id (O1 evidence becomes first-class); (c) radar slice 3 — chain-typed evidence + admission-gate checkboxes.

## 5. "New version's stable fixed update" — the doctrine that keeps it stable

1. **Gates never bend**: `tsc --noEmit` = 0 (rc read unmasked from a file), `lint` = 0 errors (33-warning baseline), golden trio green, console 0 errors — before any commit.
2. **Golden trio every round**: Model Relay intel ladder, Radar Frontier scroll, run-panel long-paste — the three surfaces the Owner actually reported breaking.
3. **Collision protocol**: chain audit first; a round label belongs to whoever committed it — parallel sessions increment (r653 was claimed mid-flight this round; this round is r654; OWN-b's dirty files were left alone).
4. **Quota discipline**: witnesses over marathons — a real run stops the moment the evidence is captured.
5. **Receipts doctrine**: every shipped change lands in the panel the Owner reads (this document §2 is the confession that proves why).

## 6. Session log (append-only)

| Round | Date | Contribution |
|---|---|---|
| r654 | 2026-10-28 | Expert audit 653-a (vault/RSI wiring map); receipts stall root-caused + backfilled (F1); F2–F5 ranked with file anchors; this session document created. Deferred: vault Backup/Restore buttons (OWN-b mid-flight on the file). |
