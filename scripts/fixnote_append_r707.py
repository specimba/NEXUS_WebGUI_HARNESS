#!/usr/bin/env python3
"""r707: append the r707 FixNote after r706 (array bottom = panel top)."""
from pathlib import Path

P = Path("src/components/nexus/settings/whats-fixed.tsx")

R707 = (
    '  { round: "r707", '
    'title: "The vault backup works on the host you actually use — and acquisition keys join the mirror bridge", '
    'detail: "The Owner hit the wall in person: the vault export refused the preview gateway host (vault export is localhost-only) — meaning Backup, Restore, and Test 403\'d on the one host the browser actually talks to. The r380 guard now has a second tier: a non-local caller passes only with the full app-JS browser shape — the r321 csrf header a foreign page cannot attach without a never-granted preflight AND a non-cross-site sec-fetch-site; headerless curl-with-the-URL is refused (the CLI pass stays a localhost-machine trust, and the forged-both-headers residual is the documented r138 class). Five-case verified live: no-headers 403, app-shape 200, cross-site 403, forged-half 403, localhost scheduler 200. Second ship (the Owner\'s ask): Exa, Bright Data, and Webshare keys were server-only — a db reset took exactly that class twice. Storing an acquisition key now keeps a browser copy in providerKeys (best-effort, the server slot stays the source of truth), the lanes join the r337 mirror strip, and the r340 drift heal covers their rotation — the same one-click bridge the LLM lanes have. The strip arms on the next key store (the current slots predate the browser-copy write).", '
    'lookFor: "Settings → automation vault from the preview host: Backup downloads instead of 403ing; after storing an acquisition key once more, its Mirror button appears in the violet strip and survives any reset." },\n'
)

t = P.read_text()
lines = t.splitlines(keepends=True)
idx = [i for i, l in enumerate(lines) if 'round: "r706"' in l]
assert len(idx) == 1, f"r706 anchors: {idx}"
i = idx[0]
assert lines[i + 1].strip().startswith("]"), "r706 is not the array tail"
lines.insert(i + 1, R707)
out = "".join(lines)
assert sorted(t.splitlines() + [R707.rstrip("\n")]) == sorted(out.splitlines()), "multiset mismatch"
P.write_text(out)
print("r707 note appended after r706; file written")
