#!/usr/bin/env python3
# r824: derive r824_qa.sh from the proven r823 template (rename r823->r824,
# r=823->r=824) and inject THE SEARCH GUARD LEG (palette -> "Search all chats"
# -> real-keyboard 2-char query -> the dialog must STILL be open afterwards)
# so the search-crash class found in r823 stays guarded in every future
# golden. Verifies 0 stale refs and prints the cache-buster count.
import re
import subprocess
import sys

PROJ = "/home/z/my-project"
SRC = f"{PROJ}/scripts/r823_qa.sh"
DST = f"{PROJ}/scripts/r824_qa.sh"

LEG = r'''# r824: THE SEARCH GUARD LEG - the search-crash class (typed-optional strings
# bricked every query) stays guarded forever: palette -> "Search all chats" ->
# a real-keyboard 2-char query -> the dialog must STILL be open afterwards.
agent-browser open "http://localhost:3000/?r=824g#/workflows/board" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true})); return 'k-dispatched'; })()" || true
sleep 1
agent-browser eval "(() => { const item=[...document.querySelectorAll('[cmdk-item]')].find(e=>/Search all chats/i.test(e.textContent||'')); if(!item) return 'palette-item:missing'; item.click(); return 'palette-item:clicked'; })()" || true
sleep 1
agent-browser keyboard inserttext "mo" >/dev/null 2>&1 || true
sleep 1
SRCH=$(agent-browser eval "(() => { const inp=document.querySelector('[aria-label=\"Search chats, agents and workflows\"]'); return JSON.stringify({dialogOpen:!!inp, options:document.querySelectorAll('[role=\"option\"]').length}); })()" || true)
echo "search-guard: $SRCH"
echo "$SRCH" | tr -d '\\' | grep -q '"dialogOpen":true' || { echo 'GUARD search dialog self-closed'; exit 1; }
'''


def main() -> None:
    raw = open(SRC, encoding="utf-8").read()
    out = raw.replace("r823", "r824").replace("r=823", "r=824")
    marker = "CONSOLE=$(agent-browser console"
    idx = out.find(marker)
    if idx < 0:
        sys.exit("inject marker not found")
    out = out[:idx] + LEG + "\n" + out[idx:]
    open(DST, "w", encoding="utf-8").write(out)
    stale = out.count("r823")
    busters = len(re.findall(r"\?r=824", out))
    print(f"derived {DST} stale_r823={stale} busters_r824={busters}")
    if stale != 0:
        sys.exit("STALE r823 refs remain")


if __name__ == "__main__":
    subprocess.run(["chmod", "+x", DST])
    main()
