# NEXUS WebGUI — Agentic Workflow Automation Platform

*(repo codename: NEXUS_WebGUI_HARNESS)*

A local-first, agentic workflow automation platform: chat with agents, build agent teams, orchestrate
multi-step workflows, watch a trend radar, and manage providers — all served on
`localhost:3000` from this repo. Platform docs: [docs/LOCAL_AUTOMATION.md](docs/LOCAL_AUTOMATION.md)
(local automation — two-lane model & vault contract).

Independent from-scratch build — not affiliated with any similarly named open-source project.

## Views

Navigation lives in `src/components/nexus/shell.tsx` (`NAV_ITEMS` / `VIEW_TITLES`).
Nav labels are short; page titles are descriptive — both names are intentional, not drift:

| Nav label | Page title | Purpose |
|---|---|---|
| Chat | Chat | Talk to agents & workflows |
| Agents | Agents | Create & manage AI agents |
| Workflows | Workflow Studio | Multi-agent pipelines |
| Radar | Trend Radar | GitHub stars · HF trending · arXiv papers |
| Settings | Settings | Provider, profile & data |

## What's inside

- **Chat** — conversations with model picker, image studio, conversation memory,
  full-text search (timestamps via `fmtChatTime`), and a Hermes-style conversation
  heartbeat that keeps idle conversations moving (`src/components/nexus/chat/`).
- **Agents** — agent create/edit dialogs plus a live test dialog; the agent card is
  keyboard-complete (role, tabIndex, Enter/Space, focus ring) (`src/components/nexus/agents/`).
- **Workflows / Workflow Studio** — pipeline grid, step editor dialog (arrow-button
  step reordering with aria-labelled movers), run panel, and the server autopilot
  panel (`src/components/nexus/workflows/`).
- **Radar / Trend Radar** — GitHub stars, Hugging Face trending (proxied), arXiv papers
  (`src/components/nexus/radar/`).
- **Settings** — provider gallery with per-provider cards, in-browser local models
  (WebLLM), model relay, automation vault, referral card (`src/components/nexus/settings/`).
- **Model tracker** — a global ticker over provider/model lanes; polls every 15 min and
  retries failed fetches with a short backoff (5s/15s/60s) so a failed first fetch can't
  leave the strip dark (`src/components/nexus/tracker/model-ticker.tsx`).
- **Shell** — ⌘K command palette (see Keyboard below), TopBar provider switcher
  (keyless providers route you to Settings with a pointing toast instead of doing
  nothing), and a stale-build guard that toasts + pins a refresh pill when the server
  picks up newer code than the tab is running (`src/components/nexus/shell.tsx`,
  `src/components/nexus/stale-build-guard.tsx`).

## Keyboard

- `⌘K` / `Ctrl+K` — command palette: search all chats, run a workflow, open
  Image Studio, or jump to provider settings — from any view.
- `⌘/Ctrl+Shift+N` — new chat (and jump to Chat).
- `⌘/Ctrl+Shift+F` — global search across all chats.
- `⌘/Ctrl+1…5` — switch views by sidebar position: Chat / Agents / Workflows /
  Radar / Settings. Caveat: Chrome reserves `Ctrl+1-8` for tab switching on
  Windows/Linux, so the digit shortcuts are only reliable on macOS or Firefox;
  the rest work everywhere.

Shortcuts live in `src/lib/use-shortcuts.ts` (global) and
`src/components/nexus/command-palette.tsx` (palette).

## Stack & rules

Next.js 16 App Router · shadcn/ui + Tailwind · Prisma/SQLite · Bun for dev.
**API routes only — no server actions.**

## Development

```bash
bun install
bun run dev        # port 3000
bun run lint       # eslint
bun run qa:tsc     # unmasked TypeScript check (tsc --noEmit)
bun run qa:syntax  # static syntax sweep (scripts/qa-syntax-sweep.ts)
bun run a11y:audit # static icon-button/aria gate (scripts/a11y-icon-button-audit.mjs)
bun run db:push    # prisma schema push
```

## Verification harness

- `scripts/cdp-qa-*.mjs` — live QA scripts (CDP over an atomic fresh-chrome run; each
  script is self-contained and prints PASS/FAIL per check). See `scripts/HARNESS.md`.
- `scripts/git-snapshot.sh` — the commit+push used at the end of every dev round.
- `ops/qa/` — QA screenshots kept for review.

## Documentation index

| Doc | Contents |
|---|---|
| [docs/AGENT-HANDBOOK.md](docs/AGENT-HANDBOOK.md) | Operations handbook for agents & humans: architecture, doctrine, verified fixes, protocols |
| [docs/LOCAL_AUTOMATION.md](docs/LOCAL_AUTOMATION.md) | Local automation: two-lane model, vault contract, heartbeat visibility |
| [docs/OPERATING_DOCTRINE.md](docs/OPERATING_DOCTRINE.md) | Round/handoff operating doctrine |
| [docs/decision-log.md](docs/decision-log.md) | Decision log |
| [RESTORE.md](RESTORE.md) | Disaster-recovery / restore guide |
| [worklog.md](worklog.md) | Append-only round changelog (read the tail before every shift) |
