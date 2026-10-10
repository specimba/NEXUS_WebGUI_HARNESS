"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUiStore } from "@/lib/stores";

// r400: the five global shortcuts existed (r249 view digits, r272-era
// new-chat/search) but no surface listed them — undiscoverable unless a
// user read the source. "?" now opens this sheet; the shortcut lives in
// src/lib/use-shortcuts.ts, the store flag in useUiStore.
const ROWS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "⇧", "N"], label: "New chat (and jump to Chat)" },
  { keys: ["⌘", "⇧", "F"], label: "Global search across all chats" },
  {
    keys: ["⌘", "1…5"],
    label: "Switch view — Chat / Agents / Workflows / Radar / Settings",
  },
  { keys: ["?"], label: "Open this cheat sheet" },
];

export function ShortcutSheet() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Global shortcuts work on every view. On Windows and Linux, use Ctrl
            instead of ⌘.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2.5 pb-1">
          {ROWS.map((row) => (
            <li
              key={row.label}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {row.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
