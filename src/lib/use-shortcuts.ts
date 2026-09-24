"use client";

import * as React from "react";
import { useConversationsStore, useUiStore } from "./stores";
import type { View } from "./types";

const VIEW_ORDER: View[] = ["chat", "agents", "workflows", "settings", "radar", "router"];

/**
 * Global keyboard shortcuts:
 * - Cmd/Ctrl + Shift + N → new chat (and jump to Chat)
 * - Cmd/Ctrl + Shift + F → global search across all chats
 * - Cmd/Ctrl + 1…6       → switch Chat / Agents / Workflows / Settings / Radar / Router
 */
export function useKeyboardShortcuts(): void {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

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
