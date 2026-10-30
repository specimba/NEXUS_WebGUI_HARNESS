#!/usr/bin/env python3
"""r784: band docs carry the wave-19 point (122, quoted rendered from the r783
close probes) at every on-page site + two apiJson conversions (cron-observatory
forensics read, stale-build-guard version poll) + the stale-pill focus ring."""
import subprocess, sys, glob

BAND_OLD = "13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58"
BAND_NEW = "13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122"
PROV_LONG = "(bucket 10:00 to 11:00 maxes, landed mid-r780)"
PROV_LONG_NEW = "(bucket 10:00 to 11:00 maxes, landed mid-r780), the 122 is the wave-19 readout (bucket 11:00 to 14:00 maxes, witnessed at the r783 close)"
PROV_SHORT = "(landed mid-r780)"
PROV_SHORT_NEW = "(landed mid-r780), the 122 is the wave-19 readout (witnessed at the r783 close)"

files = subprocess.run(
    ["grep", "-rl", BAND_OLD, "src/"], capture_output=True, text=True
).stdout.split()
total = 0
for path in files:
    s = open(path).read()
    n_band = s.count(BAND_OLD)
    n_long = s.count(PROV_LONG)
    n_short = s.count(PROV_SHORT)
    s = s.replace(BAND_OLD, BAND_NEW)
    s = s.replace(PROV_LONG, PROV_LONG_NEW)
    s = s.replace(PROV_SHORT, PROV_SHORT_NEW)
    open(path, "w").write(s)
    total += n_band
    print(f"{path}: band x{n_band} -> 18 points, prov long x{n_long}, prov short x{n_short}")
assert total >= 4, f"band sites total={total}, expected >= 4"

NEW_IMPORT = 'import { apiJson } from "@/lib/api-fetch";'
FILES = {
    "src/components/nexus/settings/cron-observatory.tsx": [
        (
            '''      const res = await fetch("/api/cron/forensics", { cache: "no-store" });
      const json = (await res.json()) as ForensicsPayload;
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);''',
            '''      // r784: apiJson death-window guard - idempotent read, retry-safe; the
      // !res.ok / !json.ok error paths keep the exact old semantics.
      const { res, json } = await apiJson<ForensicsPayload>("/api/cron/forensics", {
        cache: "no-store",
      });
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);''',
        ),
    ],
    "src/components/nexus/stale-build-guard.tsx": [
        (
            '''        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { stamp?: string };''',
            '''        // r784: apiJson death-window guard - idempotent read, retry-safe;
        // the !r.ok early-return semantics kept exactly (silent retry follows).
        const { res: r, json: j } = await apiJson<{ stamp?: string }>("/api/version", {
          cache: "no-store",
        });
        if (!r.ok) return;''',
        ),
        (
            '''      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-700 shadow-sm backdrop-blur transition-colors hover:bg-amber-500/25 dark:text-amber-300"''',
            '''      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-700 shadow-sm backdrop-blur transition-colors hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:text-amber-300"''',
        ),
    ],
}

for path, subs in FILES.items():
    s = open(path).read()
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
    open(path, "w").write(s)
    print(f"{path}: patched OK")

r = subprocess.run(
    ["node", "node_modules/typescript/lib/tsc.js", "--noEmit"],
    capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=280,
)
print(f"TSC_EXIT={r.returncode}")
if r.stdout.strip():
    print(r.stdout[-1500:])
sys.exit(r.returncode)
