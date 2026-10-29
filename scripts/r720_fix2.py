#!/usr/bin/env python3
# r720 fixer #2 — the QA-caused bug: the backup/restore cluster (Back up now,
# Restore a backup, paste box, both dialogs, CLI note) renders ONLY when the
# vault is EMPTY (slots.length === 0 gated the whole container; else = null).
# With keys stored — exactly when a backup matters — the road vanished.
# Fix: container mounts whenever the vault is loaded; empty-only pieces wrap
# in their own conditional; the populated state gets its own Back up now row
# (same ONE askBackup confirm — no second mapping). Literal anchors, idempotent.
import re
import sys

PATH = "src/components/nexus/settings/automation-vault-card.tsx"
s = open(PATH, encoding="utf-8").read()
fails = []


def sub_once(name, old, new):
    global s
    if new in s:
        print(f"SKIP {name} (already applied)")
        return
    n = s.count(old)
    if n == 1:
        s = s.replace(old, new, 1)
        print(f"PASS {name}")
    else:
        fails.append(name)
        print(f"ABORT {name} (matched {n}, expected 1)")


# 1. container condition: render whenever the vault is loaded
sub_once(
    "container-always",
    "          {!loading && !loadFailed && slots.length === 0 ? (",
    "          {/* r720: the container mounts in BOTH vault states — the\n"
    "              backup road used to vanish exactly when keys existed. */}\n"
    "          {!loading && !loadFailed ? (",
)

# 2. empty-only pieces (prose + durability ledger) get their own conditional
sub_once(
    "empty-only-wrap-start",
    '            <div className="mt-1.5 space-y-1.5">\n'
    '              <p className="text-[10px] leading-relaxed text-muted-foreground/70">\n'
    "                Empty vault",
    '            <div className="mt-1.5 space-y-1.5">\n'
    "              {/* r720: empty-vault prose + durability ledger stay\n"
    "                  empty-only — they explain a vault with nothing in it. */}\n"
    "              {slots.length === 0 ? (\n"
    "                <>\n"
    '              <p className="text-[10px] leading-relaxed text-muted-foreground/70">\n'
    "                Empty vault",
)

sub_once(
    "empty-only-wrap-end",
    '                  not — the backup file is the bridge for keys.\n'
    "                </p>\n"
    "              </div>\n",
    '                  not — the backup file is the bridge for keys.\n'
    "                </p>\n"
    "              </div>\n"
    "                </>\n"
    "              ) : null}\n",
)

# 3. populated-state Back up now twin (same ONE askBackup confirm)
sub_once(
    "backup-populated-row",
    '              <Button\n'
    '                variant="outline"\n'
    '                size="sm"\n'
    '                className="h-7 gap-1.5 px-2.5 text-xs"\n'
    "                onClick={() => fileInputRef.current?.click()}\n"
    "                disabled={restoring}\n"
    "              >\n",
    "              {/* r720: the populated-state twin of the ledger's r705 row —\n"
    "                  both open the ONE askBackup confirm; no second mapping. */}\n"
    '              <div className="flex items-center justify-end">\n'
    "                <Button\n"
    '                  variant="ghost"\n'
    '                  size="sm"\n'
    '                  data-testid="vault-backup-populated"\n'
    '                  className="h-5 gap-1 px-1.5 text-[10px] font-medium text-emerald-600 transition-colors duration-500 hover:bg-emerald-500/15 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-300"\n'
    "                  onClick={() => setAskBackup(true)}\n"
    "                  disabled={backingUp || restoring}\n"
    '                  title="Back up now — an in-app confirm, then the plaintext JSON as a file download AND a copyable dialog (the preview panel can silently block file downloads — the dialog always shows the text to copy). Keep the text outside the sandbox."\n'
    "                >\n"
    "                  {backingUp ? (\n"
    '                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />\n'
    "                  ) : (\n"
    '                    <FileDown className="h-3 w-3" aria-hidden />\n'
    "                  )}\n"
    "                  Back up now\n"
    "                </Button>\n"
    "              </div>\n"
    '              <Button\n'
    '                variant="outline"\n'
    '                size="sm"\n'
    '                className="h-7 gap-1.5 px-2.5 text-xs"\n'
    "                onClick={() => fileInputRef.current?.click()}\n"
    "                disabled={restoring}\n"
    "              >\n",
)

if fails:
    print(f"FIXER2 FAILED: {fails} — tree untouched")
    sys.exit(1)
open(PATH, "w", encoding="utf-8").write(s)
print("fixer2: all edits landed")
