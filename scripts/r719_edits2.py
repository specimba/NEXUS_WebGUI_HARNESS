#!/usr/bin/env python3
# r719 fixup — applies the edits the first pass aborted on (E7-E12), using
# PROGRAMMATIC self-locating anchors (the r715 lesson: hand-transcribed
# anchors drift; slice by marker instead). Verifies every anchor BEFORE
# applying anything; one failure = nothing written.
import pathlib, sys

ROOT = pathlib.Path("/home/z/my-project")
AV = ROOT / "src/components/nexus/settings/automation-vault-card.tsx"
SH = ROOT / "src/components/nexus/shell.tsx"
WF = ROOT / "src/components/nexus/settings/whats-fixed.tsx"

av = AV.read_text(encoding="utf-8")
sh = SH.read_text(encoding="utf-8")
wf = WF.read_text(encoding="utf-8")

# ---- pre-flight: every anchor must be found and sane ----
errs = []
if "postRestoreSlots" in av:
    print("SKIP E7 (already applied)")
    e7_done = True
else:
    e7_done = False
    try:
        i = av.index("  const restoreVaultFile")
        j = av.index("  const onRestoreFile")
        seg = av[i:j]
        assert '"/api/vault/backup"' in seg and "couldn't be read" in seg, "E7 segment sanity"
    except (ValueError, AssertionError) as e:
        errs.append(f"E7 marker: {e}")
if "Paste a backup JSON to restore" in av:
    print("SKIP E8 (already applied)")
    e8_done = True
else:
    e8_done = False
    try:
        # r719 fixup: fileInputRef.click() appears TWICE (header "Restore" +
        # empty-state "Restore a backup") — anchor on the unique label.
        lab = av.index("Restore a backup")
        b_start = av.rindex("<Button", 0, lab)
        b_end = av.index("</Button>", lab) + len("</Button>")
        blk = av[b_start:b_end]
        assert "fileInputRef" in blk and "Restore a backup" in blk, "E8 block sanity"
    except (ValueError, AssertionError) as e:
        errs.append(f"E8 marker: {e}")
e9_n = av.count("two database rebuilds (Oct 27 and Oct 28, 2026)")
e10_n = av.count("that way twice now.")
e11_n = sh.count(': "?/?"}')
e12_n = wf.count('extended count green." },\n];')
if not e7_done and not e8_done:
    pass  # counts checked below
if e9_n != 1: errs.append(f"E9 count {e9_n} != 1")
if e10_n != 1: errs.append(f"E10 count {e10_n} != 1")
if e11_n != 1: errs.append(f"E11 count {e11_n} != 1")
if e12_n != 1: errs.append(f"E12 count {e12_n} != 1")

if errs:
    print("PRE-FLIGHT FAILED — nothing written:"); [print(" -", e) for e in errs]; sys.exit(1)
print("pre-flight OK — applying")

# ---- E7: restore refactor + paste path (slice replace) ----
if not e7_done:
    NEW7 = """  // r719: the POST half of restore, shared by the file picker and the
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
  );

"""
    i = av.index("  const restoreVaultFile")
    j = av.index("  const onRestoreFile")
    av = av[:i] + NEW7 + av[j:]
    print("landed: E7 restore refactor + paste path (slice)")

# ---- E8: paste box + both dialogs (after the Restore-a-backup Button) ----
if not e8_done:
    INSERT = """
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
              </Dialog>"""
    lab = av.index("Restore a backup")
    b_end = av.index("</Button>", lab) + len("</Button>")
    av = av[:b_end] + INSERT + av[b_end:]
    print("landed: E8 paste box + both dialogs (slice)")

# ---- E9/E10: the THIRD wipe truth ----
av = av.replace(
    "two database rebuilds (Oct 27 and Oct 28, 2026)",
    "three database rebuilds (Oct 27, 28 and 29, 2026)", 1)
av = av.replace("that way twice now.", "that way three times now.", 1)
print("landed: E9+E10 three rebuilds")

AV.write_text(av, encoding="utf-8")

# ---- E11: shell.tsx cron honesty ----
sh = sh.replace(': "?/?"}', ': "n/a"}', 1)
SH.write_text(sh, encoding="utf-8")
print("landed: E11 cron n/a")

# ---- E12: FixNote r719 ----
FIXNOTE = """  { round: "r719", title: "The vault backup round trip moved entirely in-app — the third wipe left no file, and the browser was why", detail: "The Owner's report named it: export 'not worked', keys gone after the third database rebuild, nothing to import. The code audit found two silent preview-iframe traps in one flow — window.confirm is blocked and returns false (the export died before running, no toast), and the anchor-click file download can be swallowed while the success toast still fires (a backup that never arrives). The confirm is now an in-app dialog, the export always lands the plaintext in a copyable dialog (file download stays best-effort), and a paste-restore box brings the same document back without a file picker — the round trip needs neither the browser's modal nor its download lane. Same round: the sidebar cron chip's cryptic '?/?' became an honest 'n/a' while /api/cron/forensics is unreachable, and the durability ledger's 'twice now' corrected to three (Oct 27, 28 and 29).", lookFor: "Settings → automation vault: Backup opens an in-app confirm (no browser dialog), Export with a keyed vault shows the plaintext in a copyable box, and 'Restore from pasted text' accepts the same JSON without a file; the sidebar footer reads 'cron n/a' (not '?/?') while the forensics route is down." },"""
wf = wf.replace('extended count green." },\n];', f'extended count green." }},\n{FIXNOTE}\n];', 1)
WF.write_text(wf, encoding="utf-8")
print("landed: E12 FixNote r719")

# ---- verification ----
ok = (
    "window.confirm" not in av
    and av.count("setAskBackup(true)") == 2
    and "restoreVaultText" in av and "postRestoreSlots" in av
    and 'aria-label="Paste a backup JSON to restore"' in av
    and "three database rebuilds" in av and "three times now" in av
    and ': "n/a"' in sh and '?/?' not in sh
    and 'round: "r719"' in wf
)
print("VERIFY:", "OK" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
