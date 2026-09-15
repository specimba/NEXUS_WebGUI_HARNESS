# Disaster-recovery / restore guide

This repo is the full source backup of the NEXUS_WebGUI_HARNESS (PraisonAI-style multi-agent web GUI).

## Restore into a fresh sandbox

```bash
git clone https://github.com/specimba/NEXUS_WebGUI_HARNESS.git my-project
cd my-project
cp .env.example .env   # then paste your Groq key into GROQ_API_KEY (optional — BYOK also works via Settings UI)
bun install
bun run dev            # http://localhost:3000
```

## Where user data lives (NOT in git, by design)

| Data | Location |
|------|----------|
| Chats, agents, workflows, settings | Browser `localStorage` keys `praison-*` |
| Per-device session health | `localStorage` `praison-session-health` |

Use **Settings → Your Data → Export** in the running app to back up all localStorage data as JSON; Import restores it.

## Secrets policy

- `.env` is gitignored and never committed (GitHub push protection blocks leaked keys on public repos).
- The bundled free Groq key is documented in the project chat log; paste it into `.env` (server fallback) or Settings → Provider (browser).
