#!/usr/bin/env bash
# NEXUS WebGUI — fail-closed secret scanner (C2-lite, ported from the NEXUS OS
# r514 adaptation wave; snapshot-backup chain deliberately NOT ported).
# Run before any public push (wired as the `prepush` npm script).
# Scans TRACKED files only. Exit 1 on ANY hit.
# P7: on a hit, print file:line + pattern name + masked prefix ONLY — never full values.
set -uo pipefail
cd "$(dirname "$0")/.."

# TRACKED files only — untracked/ignored working files (upload/, db seeds,
# tool-results, …) are out of scope by design.
FILES=$(git ls-files \
  | grep -vE '\.(png|jpg|jpeg|webp|db|sqlite|tar|gz|zip|log|tsbuildinfo)$')

# Index-guard: refuse to run (fail CLOSED) if any forbidden path is still
# INDEXED (tracked). Survives .gitignore regressions — the guard is what
# fail-closed the whole chain in the source project's platform-sync incident.
if git ls-files | grep -qE '^(\.env$|\.next/|upload/|tool-results/|agent-ctx/)|\.tsbuildinfo$|^db/[^/]*\.db$'; then
  echo "SECRET-HIT [index-guard] forbidden path still tracked: untrack it before pushing"
  exit 1
fi
if [[ -z "$FILES" ]]; then echo "SCAN: no files"; exit 0; fi

declare -A PATTERNS=(
  [github-token]='gh[pousr]_[A-Za-z0-9]{20,}'
  [github-finegrained]='github_pat_[A-Za-z0-9_]{20,}'
  [aws-access-key]='AKIA[0-9A-Z]{16}'
  [openai-style-key]='sk-[A-Za-z0-9_-]{20,}'
  [slack-bot-token]='xoxb-[A-Za-z0-9-]{10,}'
  [private-key-block]='-----BEGIN[A-Z ]*PRIVATE KEY-----'
  [bearer-literal]='Authorization["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?Bearer[[:space:]]+[A-Za-z0-9_.\-]{25,}'
  [hex-secret-assignment]='(SECRET|TOKEN|API_KEY|PASSWORD|PASSWD)[A-Za-z0-9_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[0-9a-fA-F]{32,}'
  # Literal env assignments of known secret var names (RHS = plain token at EOL).
  # Code that READS the var (process.env.X, "$VAR", printf) must not trip it.
  [env-secret-assignment]='(PANEL_PASSWORD|SESSION_SECRET|ENCRYPTION_KEY|QSTASH_TOKEN|UPSTASH_[A-Z_]*TOKEN|VYCE_API_KEY|GROQ_API_KEY|WEBSHARE_TOKEN|SUPABASE_SECRET_KEY)=[A-Za-z0-9_/@+=.-]{6,}[[:space:]]*$'
)

EXIT=0
declare -A HITCOUNT
for name in "${!PATTERNS[@]}"; do
  # shellcheck disable=SC2086
  HITS=$(printf '%s\n' "$FILES" | xargs grep -nE -i "${PATTERNS[$name]}" 2>/dev/null \
    | grep -vE 'localhost|proxy-host|example\.com|postgresql://[^:]+:\*|sk-\.\.\.|sk-xxx|sk-your|xxxxxxxx' || true)
  if [[ -n "$HITS" ]]; then
    while IFS= read -r line; do
      FILE=$(echo "$line" | cut -d: -f1)
      LINENO_=$(echo "$line" | cut -d: -f2)
      PREFIX=$(echo "$line" | cut -d: -f3- | grep -oE "${PATTERNS[$name]}" | head -1 | cut -c1-8)
      # BASELINE (r514): pre-existing, documented, owner-decision-pending hits.
      # Exact file:pattern:line match only — ANY drift in that file re-fails the
      # scan (fail-closed both ways). Baseline lives in .secret-baseline.
      if [[ -f .secret-baseline ]] && grep -qE "^${FILE}:${name}:${LINENO_}$" .secret-baseline; then
        echo "BASELINE-HIT [$name] $FILE:$LINENO_ masked=${PREFIX}*** (known entry — owner decision pending)"
        continue
      fi
      EXIT=1
      echo "SECRET-HIT [$name] $FILE:$LINENO_ masked=${PREFIX}***"
    done <<< "$HITS"
  fi
done

# Stale-baseline guard: a baseline entry whose file:line no longer hits means
# the file changed — re-review and re-baseline (or celebrate a removal).
if [[ -f .secret-baseline ]]; then
  while IFS= read -r entry; do
    [[ -z "$entry" || "$entry" == \#* ]] && continue
    BF=$(echo "$entry" | cut -d: -f1)
    BN=$(echo "$entry" | cut -d: -f2)
    BL=$(echo "$entry" | cut -d: -f3)
    STILL=$(printf '%s\n' "$FILES" | xargs grep -nE -i "${PATTERNS[$BN]}" 2>/dev/null | grep -E "^${BF}:${BL}:" || true)
    if [[ -z "$STILL" ]]; then
      echo "STALE-BASELINE [$BN] $BF:$BL no longer hits — remove the entry or re-baseline after review."
      EXIT=1
    fi
  done < .secret-baseline
fi

if [[ $EXIT -eq 0 ]]; then
  echo "SCAN OK: no secret-shaped hits in $(echo "$FILES" | wc -l) tracked files ($(date '+%Y-%m-%d %H:%M %Z'))"
fi
exit $EXIT
