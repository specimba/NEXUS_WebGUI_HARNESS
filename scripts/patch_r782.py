#!/usr/bin/env python3
"""r782: apiJson death-window guard on the surfaces outside the r780-r781 queue.
Asserted single-occurrence replacements; inserts the helper import only when missing."""
import subprocess, sys

FILES = {
    "src/components/nexus/workflows/use-server-runs.ts": [
        (
            '''        const res = await fetch("/api/automation/sync");
        if (!res.ok) return;
        const json = (await res.json()) as { runs?: ServerRunRow[] };''',
            '''        // r782: apiJson death-window guard on the sync poll - idempotent
        // read, retry-safe; a gateway HTML 502 page can no longer hit the
        // raw res.json() parse on the board's 60s poll.
        const { res, json } = await apiJson<{ runs?: ServerRunRow[] }>("/api/automation/sync");
        if (!res.ok) return;''',
        ),
    ],
    "src/components/nexus/workflows/run-kanban.tsx": [
        (
            '''        const res = await fetch("/api/automation/sync");
        if (!res.ok) return;
        const json = (await res.json()) as { runs?: ServerRunRow[] };''',
            '''        // r782: apiJson death-window guard on the sync poll - idempotent
        // read, retry-safe; a gateway HTML 502 page can no longer hit the
        // raw res.json() parse on the board's 60s poll.
        const { res, json } = await apiJson<{ runs?: ServerRunRow[] }>("/api/automation/sync");
        if (!res.ok) return;''',
        ),
        (
            '''      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5"''',
            '''      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 transition-colors focus-within:border-amber-500/45 focus-within:ring-1 focus-within:ring-amber-500/25"''',
        ),
    ],
    "src/components/nexus/shell.tsx": [
        (
            '''    fetch("/api/cron/forensics")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))''',
            '''    // r782: apiJson death-window guard - the chip's read is idempotent and
    // retry-safe; a gateway HTML page self-heals (one retry) instead of
    // rejecting raw, and the !res.ok branch keeps the exact old semantics.
    apiJson<{ registry?: { jobs?: Array<{ kind?: string; enabled?: boolean; schedule?: { expr?: unknown } }> }> }(
      "/api/cron/forensics",
    )
      .then(({ res, json: d }) => {
        if (!res.ok) throw new Error(String(res.status));
        return d;
      })''',
        ),
    ],
}

for path, subs in FILES.items():
    with open(path) as f:
        s = f.read()
    for old, new in subs:
        n = s.count(old)
        assert n == 1, f"ABORT {path}: pattern count={n} for: {old[:70]!r}"
        s = s.replace(old, new)
    if "@/lib/api-fetch" not in s:
        lines = s.split("\n")
        idx = max(i for i, l in enumerate(lines[:60]) if l.startswith("import "))
        lines.insert(idx + 1, 'import { apiJson } from "@/lib/api-fetch";')
        s = "\n".join(lines)
        print(f"{path}: import inserted after line {idx+1}")
    else:
        print(f"{path}: api-fetch import already present")
    with open(path, "w") as f:
        f.write(s)
    print(f"{path}: patched OK")

print("=== leftover raw res.json() check (should be empty for the 3 sites) ===")
subprocess.run(
    ["grep", "-rn", 'fetch("/api/automation/sync")', "src/components/nexus"], check=False
)
subprocess.run(["git", "diff", "--stat"], check=False)
r = subprocess.run(["bunx", "tsc", "--noEmit"], capture_output=True, text=True)
print(f"TSC_EXIT={r.returncode}")
if r.stdout.strip():
    print(r.stdout[-2000:])
sys.exit(r.returncode)
