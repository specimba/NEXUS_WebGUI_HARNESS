#!/usr/bin/env python3
"""r712 guarded edits: radar tab aria-labels, TASKS.md truth fix, FixNote r712.
Every replace is exact-match with a count guard; abort non-zero on any drift."""
import pathlib, sys

ROOT = pathlib.Path("/home/z/my-project")
ok = True

def guarded(path: pathlib.Path, old: str, new: str, label: str):
    global ok
    t = path.read_text()
    n = t.count(old)
    if n != 1:
        print(f"GUARD FAIL [{label}]: {n} matches (expected 1)")
        ok = False
        return
    path.write_text(t.replace(old, new, 1))
    print(f"ok [{label}]")

# 1. radar-view.tsx — stable accessible names for the five section tabs
rv = ROOT / "src/components/nexus/radar/radar-view.tsx"
for val, name in (("models", "Models"), ("github", "GitHub Stars"), ("hf", "HF Trending"),
                  ("papers", "Paper Radar"), ("frontier", "Frontier")):
    guarded(rv, f'<TabsTrigger value="{val}" className="gap-1.5">',
            f'<TabsTrigger value="{val}" aria-label="Radar tab: {name}" className="gap-1.5">',
            f"radar-tab-{val}")

# 2. TASKS.md — the cortex P1 STATUS stops claiming the executor prefers edge
tm = ROOT / "docs/strategy/TASKS.md"
old_status = ("Remaining: wire the agent TOOLS (memory/sandbox/scrape) to the direct lanes "
              "when the edge URL is empty (the lib's direct lanes exist; the executor still "
              "prefers edge), and the real-key UPSTASH 3/3 DOM witness (awaits the Owner "
              "probing with live trio keys).")
new_status = ("STATUS (r711): tool wiring VERIFIED-WIRED — the full-chain audit (UI → chat-client → "
              "routes → ToolContext → ladders) found the no-URL ordering already correct and the direct "
              "answers already provenance-headed; a live /api/tools/execute dial with fake creds named the "
              "DIRECT lane in its honest failure. The 'executor still prefers edge' claim was stale. "
              "Remaining: the real-key UPSTASH 3/3 DOM witness (awaits the Owner probing with live trio keys).")
guarded(tm, old_status, new_status, "tasks-status")

# 3. whats-fixed.tsx — FixNote r712 (array tail = newest at tail; panel renders reversed)
wf = ROOT / "src/components/nexus/settings/whats-fixed.tsx"
anchor = 'names the DIRECT lane, never an edge that was never configured." },\n];'
entry = ('  { round: "r712", title: "The radar tabs answer to stable names — and the backlog stopped claiming a wall that fell", '
         'detail: "Two rounds of locator friction (r705, r711) traced to one root: the radar\'s five section tabs carried only their '
         'visible text, so aria-label lookups missed and QA fell back to text matching (the r560 doctrine\'s exact hazard — names drift, '
         'roles don\'t). Each tab now carries a stable aria-label (Radar tab: Models / GitHub Stars / HF Trending / Paper Radar / Frontier), '
         'matching the toolbar-button convention, so assistive tech and QA locators get a name that cannot drift. Same round, truth '
         'maintenance: the Cortex P1\'s backlog line still claimed the executor \'still prefers edge\' — r711\'s audit proved the direct-lane '
         'wiring already complete and witnessed it live through the real executor; the backlog now says so. The verdict watch got its proper '
         'mapping too: the gate corpus reads 26 confident verdicts (21 PASS / 5 FAIL) + 25 uncertain + 8 no-judge — grown from r704\'s 7/2, '
         'no regression signal.", '
         'lookFor: "Radar: the five section tabs expose stable aria-labels — an aria-label lookup for \'Radar tab: Frontier\' opens the '
         'Frontier scout directly; docs/strategy/TASKS.md\'s Cortex entry no longer claims the executor prefers edge." },')
guarded(wf, anchor, anchor[:-3] + "\n" + entry + "\n];", "fixnote-r712")

sys.exit(0 if ok else 1)
