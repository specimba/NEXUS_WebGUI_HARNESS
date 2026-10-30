#!/usr/bin/env python3
"""r783: apiJson guard on the run-kanban evals ledger chain + the tracker trio.
Asserted single-occurrence replacements; .tsx lesson honored: the type rides as
an as-cast at the use site (no inline object-literal generics)."""
import subprocess, sys

NEW_IMPORT = 'import { apiJson } from "@/lib/api-fetch";'

FILES = {
    "src/components/nexus/workflows/run-kanban.tsx": [
        (
            '''      void fetch("/api/evals")
        .then(async (res) => {
          if (!res.ok) throw new Error(`ledger census HTTP ${res.status}`);
          const j = (await res.json()) as {''',
            '''      // r783: apiJson death-window guard - idempotent read; the type rides
      // as an as-cast (inline object-literal generics are parser-fragile in
      // .tsx) and the HTML-page detect joins the 3s retry ladder below.
      void apiJson("/api/evals")
        .then(({ res, json }) => {
          if (!res.ok) throw new Error(`ledger census HTTP ${res.status}`);
          const j = json as {''',
        ),
    ],
    "src/components/nexus/tracker/model-ticker.tsx": [
        (
            '''        const res = await fetch("/api/tracker", { cache: "no-store" });
        if (!res.ok) throw new Error(`tracker HTTP ${res.status}`);
        const fresh = (await res.json()) as TrackerData;''',
            '''        // r783: apiJson death-window guard - idempotent read, retry-safe;
        // the HTML-page detect joins the 5s/15s/60s backoff ladder below.
        const { res, json } = await apiJson<TrackerData>("/api/tracker", { cache: "no-store" });
        if (!res.ok) throw new Error(`tracker HTTP ${res.status}`);
        const fresh = json;''',
        ),
        (
            '''        const res = await fetch("/api/tracker", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-nexus-csrf": "1" },
          body: JSON.stringify(vyceKey ? { force: true, vyceKey } : { force: true }),
        });
        const out = (await res.json()) as { skipped?: boolean; reason?: string; newModels?: number };''',
            '''        // r783: apiJson guard, retries 0 - action route (forces an external
        // source sync), the retry decision stays with the user button.
        const { json } = await apiJson(
          "/api/tracker",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-nexus-csrf": "1" },
            body: JSON.stringify(vyceKey ? { force: true, vyceKey } : { force: true }),
          },
          { retries: 0 },
        );
        const out = json as { skipped?: boolean; reason?: string; newModels?: number };''',
        ),
    ],
    "src/components/nexus/tracker/model-odds-card.tsx": [
        (
            '''      const res = await fetch("/api/tracker/odds", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as OddsPayload);''',
            '''      // r783: apiJson death-window guard - idempotent read, retry-safe;
      // the res.ok gate keeps the exact old keep-previous semantics.
      const { res, json } = await apiJson<OddsPayload>("/api/tracker/odds", { cache: "no-store" });
      if (res.ok) setData(json);''',
        ),
        (
            '''            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-[12px]"
              disabled={refreshing}''',
            '''            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-[12px] transition-colors hover:border-violet-500/40 hover:text-violet-600 dark:hover:text-violet-400"
              disabled={refreshing}''',
        ),
    ],
    "src/components/nexus/tracker/model-radar-tab.tsx": [
        (
            '''      const res = await fetch("/api/tracker", { cache: "no-store" });
      if (res.ok) {
        const next = (await res.json()) as TrackerData;''',
            '''      // r783: apiJson death-window guard - idempotent read, retry-safe;
      // the res.ok / loadFailed branches keep the exact old semantics.
      const { res, json } = await apiJson<TrackerData>("/api/tracker", { cache: "no-store" });
      if (res.ok) {
        const next = json;''',
        ),
        (
            '''      const res = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify(vyceKey ? { force: true, vyceKey } : { force: true }),
      });
      const out = (await res.json()) as { skipped?: boolean; reason?: string; newModels?: number; sources?: { id: string; ok: boolean; models: number }[] };''',
            '''      // r783: apiJson guard, retries 0 - action route (forces an external
      // source sync), the retry decision stays with the user button.
      const { json } = await apiJson(
        "/api/tracker",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-nexus-csrf": "1" },
          body: JSON.stringify(vyceKey ? { force: true, vyceKey } : { force: true }),
        },
        { retries: 0 },
      );
      const out = json as {
        skipped?: boolean;
        reason?: string;
        newModels?: number;
        sources?: { id: string; ok: boolean; models: number }[];
      };''',
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
        lines.insert(idx + 1, NEW_IMPORT)
        s = "\n".join(lines)
        print(f"{path}: import inserted after line {idx+1}")
    else:
        print(f"{path}: api-fetch import already present")
    with open(path, "w") as f:
        f.write(s)
    print(f"{path}: patched OK")

r = subprocess.run(
    ["node", "node_modules/typescript/lib/tsc.js", "--noEmit"],
    capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=280,
)
print(f"TSC_EXIT={r.returncode}")
if r.stdout.strip():
    print(r.stdout[-1500:])
sys.exit(r.returncode)
