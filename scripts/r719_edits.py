#!/usr/bin/env python3
# r719 guarded edits (r713 pattern) — the vault backup round trip moves in-app:
#   E1/E2   imports (Dialog, Textarea, Copy icon)
#   E3      states (askBackup, backupText, restoreText, backupTextRef)
#   E4      backupVault: window.confirm gate REMOVED (silently false in
#           sandboxed preview iframes — the export died before running),
#           download best-effort, plaintext ALWAYS lands in the copyable dialog
#   E5      both callers open the in-app confirm; E5b ledger title updated
#   E6      parseBackupText hoisted (shared by file + paste restore)
#   E7      restoreVaultFile slimmed onto postRestoreSlots; restoreVaultText new
#   E8      paste-restore box + both dialogs rendered by the restore section
#   E9/E10  durability ledger truth: "twice" -> three (Oct 27, 28 and 29)
#   E11     shell.tsx cron "?/?" -> honest "n/a" when forensics unreachable
#   E12     FixNote r719 (one-line object)
import pathlib, sys

ROOT = pathlib.Path("/home/z/my-project")


def guarded(rel, old, new, label, count=1):
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if new in t and old not in t:
        print(f"SKIP (already applied): {label}")
        return
    n = t.count(old)
    if n != count:
        print(f"GUARD FAIL ({label}): anchor count {n} != {count} — aborting, nothing forced")
        sys.exit(1)
    p.write_text(t.replace(old, new) if count == 1 else t.replace(old, new), encoding="utf-8")
    print(f"landed: {label}")


AV = "src/components/nexus/settings/automation-vault-card.tsx"

# E1: ui imports
guarded(
    AV,
    'import { Input } from "@/components/ui/input";',
    'import { Input } from "@/components/ui/input";\n'
    'import { Textarea } from "@/components/ui/textarea";\n'
    'import {\n'
    '  Dialog,\n'
    '  DialogContent,\n'
    '  DialogDescription,\n'
    '  DialogHeader,\n'
    '  DialogTitle,\n'
    '} from "@/components/ui/dialog";',
    "E1 ui imports (Dialog + Textarea)",
)

# E2: lucide Copy icon
guarded(AV, "  Download,\n  Eye,", "  Copy,\n  Download,\n  Eye,", "E2 Copy icon")

# E3: states before backupVault
guarded(
    AV,
    "  const backupVault = React.useCallback(async () => {",
    "  // r719: the export round trip moved in-app — window.confirm AND anchor\n"
    "  // downloads are both silently swallowed by sandboxed preview iframes (the\n"
    "  // third wipe's keys left with no file ever arriving while the success\n"
    "  // toast still fired). The confirm dialog and the copyable backup text\n"
    "  // need neither the browser's modal nor its download lane.\n"
    "  const [askBackup, setAskBackup] = React.useState(false);\n"
    "  const [backupText, setBackupText] = React.useState<string | null>(null);\n"
    "  const [restoreText, setRestoreText] = React.useState(\"\");\n"
    "  const backupTextRef = React.useRef<HTMLTextAreaElement | null>(null);\n"
    "  const backupVault = React.useCallback(async () => {",
    "E3 backup states",
)

# E4: backupVault body — confirm gate out, copyable dialog in
guarded(
    AV,
    """    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Export the automation vault as a JSON backup?\\n\\nThe file will contain every stored key UNENCRYPTED — keep it somewhere safe and delete it when you're done.",
      )
    ) {
      return;
    }
    setBackingUp(true);
    try {
      const res = await fetch("/api/vault/backup", {
        cache: "no-store",
        headers: { "x-nexus-csrf": "1" },
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        slots?: unknown[];
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !Array.isArray(json.slots)) {
        toast.error(json?.error ?? "Vault export failed — the server didn't answer.");
        return;
      }
      if (json.slots.length === 0) {
        toast.info("The vault is empty — nothing to back up yet.");
        return;
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexus-vault-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Backed up ${json.slots.length} slot${json.slots.length === 1 ? "" : "s"} — the file holds plaintext keys, store it safely.`,
      );""",
    """    // r719: the confirm moved in-app (the askBackup dialog) — window.confirm
    // is silently blocked in sandboxed preview iframes and returns false,
    // which killed the export before it ever ran.
    setAskBackup(false);
    setBackingUp(true);
    try {
      const res = await fetch("/api/vault/backup", {
        cache: "no-store",
        headers: { "x-nexus-csrf": "1" },
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        slots?: unknown[];
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !Array.isArray(json.slots)) {
        toast.error(json?.error ?? "Vault export failed — the server didn't answer.");
        return;
      }
      if (json.slots.length === 0) {
        toast.info("The vault is empty — nothing to back up yet.");
        return;
      }
      const text = JSON.stringify(json, null, 2);
      // File download stays best-effort: the preview iframe can swallow it
      // silently — the copyable dialog is the road that always works.
      try {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nexus-vault-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        /* the dialog below is the guaranteed road */
      }
      setBackupText(text);
      toast.success(
        `Backed up ${json.slots.length} slot${json.slots.length === 1 ? "" : "s"} — if no file arrived, the dialog holds the plaintext to copy.`,
      );""",
    "E4 backupVault in-app round trip",
)

# E5: both callers open the confirm dialog (count == 2)
guarded(
    AV,
    "onClick={() => void backupVault()}",
    "onClick={() => setAskBackup(true)}",
    "E5 both backup callers -> in-app confirm",
    count=2,
)

# E5b: ledger title truth
guarded(
    AV,
    'title="Back up now — the same export flow as the card\'s Backup button: a confirm dialog, then the plaintext JSON download (an empty vault honestly says so)."',
    'title="Back up now — the same export flow as the card\'s Backup button: an in-app confirm, then the plaintext JSON as a file download AND a copyable dialog (the preview panel can silently block file downloads — an empty vault honestly says so)."',
    "E5b ledger title",
)

# E6: parseBackupText hoisted beside maskOf
guarded(
    AV,
    """function maskOf(raw: string): string {
  return raw.length > 12 ? `${raw.slice(0, 4)}••••${raw.slice(-4)}` : "••••••••";
}""",
    """function maskOf(raw: string): string {
  return raw.length > 12 ? `${raw.slice(0, 4)}••••${raw.slice(-4)}` : "••••••••";
}

/** r719: parse a backup document — either shape the Backup flow writes:
 *  { slots: […] } or a bare slots array. Shared by the file picker and the
 *  new paste-restore path (one mapping, two honest front doors). */
function parseBackupText(text: string): unknown[] | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && Array.isArray((parsed as { slots?: unknown }).slots)
    ? (parsed as { slots?: unknown[] }).slots
    : Array.isArray(parsed)
      ? parsed
      : null;
}""",
    "E6 parseBackupText hoisted",
)

# E7: restoreVaultFile slimmed + postRestoreSlots + restoreVaultText
guarded(
    AV,
    """  const restoreVaultFile = React.useCallback(
    async (file: File) => {
      setRestoring(true);
      try {
        const text = await file.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          toast.error("That file isn't valid JSON — pick a backup made by the Backup button.");
          return;
        }
        const slots =
          parsed && typeof parsed === "object" && Array.isArray((parsed as { slots?: unknown }).slots)
            ? (parsed as { slots?: unknown[] }).slots
            : Array.isArray(parsed)
              ? parsed
              : null;
        if (!slots) {
          toast.error("No slots array in that file — pick a backup made by the Backup button.");
          return;
        }
        const res = await fetch("/api/vault/backup", {
          method: "POST",
          headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
          body: JSON.stringify({ slots }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          imported?: number;
          skipped?: number;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok) {
          toast.error(json?.error ?? "Vault import failed — the server didn't answer.");
          return;
        }
        toast.success(
          `Restored ${json.imported ?? 0} slot${json.imported === 1 ? "" : "s"}${
            json.skipped ? `, ${json.skipped} malformed skipped` : ""
          }.`,
        );
        void load();
      } catch {
        toast.error("Vault import failed — the file couldn't be read.");
      } finally {
        setRestoring(false);
      }
    },
    [load],
  );""",
    """  // r719: the POST half of restore, shared by the file picker and the
  // paste-restore path — one mapping for the write, two honest front doors.
  const postRestoreSlots = React.useCallback(
    async (slots: unknown[]) => {
      setRestoring(true);
      try {
        const res = await fetch("/api/vault/backup", {
          method: "POST",
          headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
          body: JSON.stringify({ slots }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          imported?: number;
          skipped?: number;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok) {
          toast.error(json?.error ?? "Vault import failed — the server didn't answer.");
          return;
        }
        toast.success(
          `Restored ${json.imported ?? 0} slot${json.imported === 1 ? "" : "s"}${
            json.skipped ? `, ${json.skipped} malformed skipped` : ""
          }.`,
        );
        void load();
      } catch {
        toast.error("Vault import failed — the server didn't answer.");
      } finally {
        setRestoring(false);
      }
    },
    [load],
  );

  const restoreVaultFile = React.useCallback(
    async (file: File) => {
      try {
        const slots = parseBackupText(await file.text());
        if (!slots) {
          toast.error(
            "That file isn't a vault backup (no slots array / bad JSON) — pick one made by the Backup button.",
          );
          return;
        }
        await postRestoreSlots(slots);
      } catch {
        toast.error("Vault import failed — the file couldn't be read.");
      }
    },
    [postRestoreSlots],
  );

  // r719: paste-restore — file pickers can be iframe-hostile in the preview
  // panel exactly like downloads; pasted text needs neither.
  const restoreVaultText = React.useCallback(
    async (text: string) => {
      const slots = parseBackupText(text);
      if (!slots) {
        toast.error("That pasted text isn't a vault backup (no slots array / bad JSON).");
        return;
      }
      await postRestoreSlots(slots);
    },
    [postRestoreSlots],
  );""",
    "E7 restore refactor + paste path",
)

# E8: paste box + both dialogs, rendered at the Restore section
guarded(
    AV,
    """              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={restoring}
              >
                {restoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                Restore a backup
              </Button>""",
    """              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={restoring}
              >
                {restoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                Restore a backup
              </Button>
              {/* r719: paste-restore — the third road: no file picker, no
                  download, just text through the same POST. */}
              <div className="mt-1.5 flex flex-col gap-1.5">
                <Textarea
                  aria-label="Paste a backup JSON to restore"
                  placeholder="Or paste a backup JSON here (the same document the Backup dialog shows) — no file picker needed"
                  className="min-h-[52px] font-mono text-[10.5px]"
                  value={restoreText}
                  onChange={(e) => setRestoreText(e.target.value)}
                  spellCheck={false}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-fit gap-1.5 px-2.5 text-xs"
                  onClick={() => void restoreVaultText(restoreText)}
                  disabled={restoring || !restoreText.trim()}
                >
                  {restoring ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Upload className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Restore from pasted text
                </Button>
              </div>
              {/* r719: in-app confirm — window.confirm is silently blocked
                  (returns false) inside sandboxed preview iframes, which
                  killed the export before it ever ran. */}
              <Dialog open={askBackup} onOpenChange={setAskBackup}>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Export the vault backup?</DialogTitle>
                    <DialogDescription>
                      The backup holds every stored key UNENCRYPTED. The file download can be
                      silently blocked inside the preview panel — the next dialog always shows
                      the plaintext to copy, so the backup travels even then.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setAskBackup(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void backupVault()} disabled={backingUp}>
                      {backingUp ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Export backup
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={backupText !== null} onOpenChange={(o) => !o && setBackupText(null)}>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Vault backup — copy it somewhere safe</DialogTitle>
                    <DialogDescription>
                      Plaintext keys below. If the file download never arrived (the preview
                      panel can block it silently), this text IS the backup — copy it out and
                      keep it outside the sandbox.
                    </DialogDescription>
                  </DialogHeader>
                  <Textarea
                    readOnly
                    aria-label="Vault backup JSON"
                    className="max-h-72 min-h-[120px] font-mono text-[10.5px]"
                    value={backupText ?? ""}
                    ref={backupTextRef}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      plaintext · restore via the paste box above
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setBackupText(null)}>
                        Close
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          if (!backupText) return;
                          try {
                            await navigator.clipboard.writeText(backupText);
                            toast.success("Backup copied to the clipboard.");
                          } catch {
                            backupTextRef.current?.focus();
                            toast.info("Clipboard blocked — the text is selected, press Ctrl+C / ⌘C.");
                          }
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                        Copy
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>""",
    "E8 paste box + both dialogs",
)

# E9/E10: durability ledger truth — the THIRD wipe (Oct 29)
guarded(
    AV,
    "This vault has come back empty after two database rebuilds (Oct 27 and Oct 28, 2026) — the backup file below is the bridge.",
    "This vault has come back empty after three database rebuilds (Oct 27, 28 and 29, 2026) — the backup file below is the bridge.",
    "E9 ledger tooltip three rebuilds",
)
guarded(
    AV,
    "rebuild reverts the database file itself — keys here have vanished\n                      that way twice now.",
    "rebuild reverts the database file itself — keys here have vanished\n                      that way three times now.",
    "E10 ledger line three times",
)

# E11: shell.tsx cron chip honesty
guarded(
    "src/components/nexus/shell.tsx",
    '<span className="font-medium">cron {fleet ? `${fleet.n}/${fleet.total}` : "?/?"}</span>',
    '<span className="font-medium">cron {fleet ? `${fleet.n}/${fleet.total}` : "n/a"}</span>',
    "E11 cron chip n/a",
)

# E12: FixNote r719 (one-line; anchor = r718 tail)
FIXNOTE = """  { round: "r719", title: "The vault backup round trip moved entirely in-app — the third wipe left no file, and the browser was why", detail: "The Owner's report named it: export 'not worked', keys gone after the third database rebuild, nothing to import. The code audit found two silent preview-iframe traps in one flow — window.confirm is blocked and returns false (the export died before running, no toast), and the anchor-click file download can be swallowed while the success toast still fires (a backup that never arrives). The confirm is now an in-app dialog, the export always lands the plaintext in a copyable dialog (file download stays best-effort), and a paste-restore box brings the same document back without a file picker — the round trip needs neither the browser's modal nor its download lane. Same round: the sidebar cron chip's cryptic '?/?' became an honest 'n/a' while /api/cron/forensics is unreachable, and the durability ledger's 'twice now' corrected to three (Oct 27, 28 and 29).", lookFor: "Settings → automation vault: Backup opens an in-app confirm (no browser dialog), Export with a keyed vault shows the plaintext in a copyable box, and 'Restore from pasted text' accepts the same JSON without a file; the sidebar footer reads 'cron n/a' (not '?/?') while the forensics route is down." },"""
guarded(
    "src/components/nexus/settings/whats-fixed.tsx",
    'prints the extended count green." },\n];',
    f'prints the extended count green." }},\n{FIXNOTE}\n];',
    "E12 FixNote r719",
)

# ---- verification tail ----
av = (ROOT / AV).read_text(encoding="utf-8")
sh = (ROOT / "src/components/nexus/shell.tsx").read_text(encoding="utf-8")
wf = (ROOT / "src/components/nexus/settings/whats-fixed.tsx").read_text(encoding="utf-8")
dg = (ROOT / "src/components/ui/dialog.tsx").read_text(encoding="utf-8")
ok = (
    "window.confirm" not in av
    and av.count("setAskBackup(true)") == 2
    and "restoreVaultText" in av and "postRestoreSlots" in av
    and "Parse a backup JSON to restore" in av
    and "n/a" in sh and "?/?" not in sh
    and 'round: "r719"' in wf
    and "three database rebuilds" in av
    and all(n in dg for n in ("DialogTitle", "DialogContent", "DialogDescription", "DialogHeader"))
)
print("VERIFY:", "OK" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
