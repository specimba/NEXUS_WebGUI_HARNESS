"use client";

import * as React from "react";
import { useConversationsStore, useUiStore } from "./stores";
import type { View } from "./types";

const VIEW_ORDER: View[] = ["chat", "agents", "workflows", "radar", "settings"];

/**
 * Global keyboard shortcuts:
 * - Cmd/Ctrl + Shift + N → new chat (and jump to Chat)
 * - Cmd/Ctrl + Shift + F → global search across all chats
 * - Cmd/Ctrl + 1…5       → switch views by SIDEBAR POSITION:
 *                          Chat / Agents / Workflows / Radar / Settings.
 *                          (r249: digits follow NAV_ITEMS order — ⌘N opens the
 *                          Nth sidebar item — instead of the old internal order
 *                          that put Settings on ⌘4 and Radar on ⌘5.)
 */
export function useKeyboardShortcuts(): void {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      // r400: "?" is checked BEFORE the ⌘/Ctrl gate below — the cheat-sheet
      // key carries no modifier (GitHub/Gmail convention). In fields, "?"
      // must type a question mark, not open the sheet.
      if (e.key === "?" && !inField) {
        e.preventDefault();
        useUiStore.getState().setShortcutsOpen(true);
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) return;

      const ui = useUiStore.getState();

      if (e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        useConversationsStore.getState().create(ui.activeAgentId ?? undefined);
        ui.setView("chat");
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        ui.setGlobalSearchOpen(true);
        return;
      }

      const idx = VIEW_ORDER.findIndex((_, i) => e.key === String(i + 1));
      if (idx !== -1 && !e.shiftKey && !e.altKey && !inField) {
        e.preventDefault();
        ui.setView(VIEW_ORDER[idx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
