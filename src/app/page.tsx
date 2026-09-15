"use client";

import { useSyncExternalStore, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppSidebar, MobileNav, Splash, TopBar } from "@/components/praison/shell";
import { CommandPalette } from "@/components/praison/command-palette";
import { GlobalSearchDialog } from "@/components/praison/global-search-dialog";
import { ChatView } from "@/components/praison/chat/chat-view";
import { HeartbeatEngine } from "@/components/praison/chat/chat-heartbeat";
import { AgentsView } from "@/components/praison/agents/agents-view";
import { WorkflowsView } from "@/components/praison/workflows/workflows-view";
import { WorkflowScheduler } from "@/components/praison/workflows/workflow-scheduler";
import { SessionHealth } from "@/components/praison/session-health";
import { SettingsView } from "@/components/praison/settings/settings-view";
import { ensureSeeded, useSettingsStore, useUiStore } from "@/lib/stores";
import { useKeyboardShortcuts } from "@/lib/use-shortcuts";
import { DEFAULT_UI_THEME } from "@/lib/constants";

const noopSubscribe = () => () => {};

/** SSR-safe hydration gate: false on server splash, true after client hydration. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

// ─── In-app hash routes (single-page app; linkable/bookmarkable) ────────────
// #/setup            → guided free-key wizard
// #/guide/<provider> → wizard pre-opened at that provider's registration step
// #/providers        → Settings scrolled to the free provider gallery
// #/local-models     → Settings scrolled to the WebGPU local-model panel

function applyHashRoute(): void {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) return;
  const [head, param] = hash.split("/");
  const ui = useUiStore.getState();
  if (head === "setup") {
    ui.openSetupWizard();
  } else if (head === "guide" && param) {
    ui.openSetupWizard(decodeURIComponent(param));
  } else if (head === "providers" || head === "local-models") {
    // Navigational anchors imply leaving the wizard — dismiss it if open.
    ui.setSetupWizardOpen(false);
    ui.setView("settings");
    ui.setSettingsAnchor(head);
  }
}

if (typeof window !== "undefined") {
  ensureSeeded();
}

export default function Page() {
  const mounted = useIsClient();
  const view = useUiStore((s) => s.view);
  const uiTheme = useSettingsStore((s) => s.settings.uiTheme);
  useKeyboardShortcuts();

  // Keep <html data-theme> in sync with the persisted accent theme.
  useEffect(() => {
    const id = uiTheme ?? DEFAULT_UI_THEME;
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", id);
    }
  }, [uiTheme]);

  // Handle hash routes on load and while the app is open (#/setup, #/guide/<id>, …).
  useEffect(() => {
    if (!mounted) return;
    applyHashRoute();
    const onHash = () => applyHashRoute();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [mounted]);

  if (!mounted) return <Splash />;

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="app-backdrop min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="h-full"
            >
              {view === "chat" && <ChatView />}
              {view === "agents" && <AgentsView />}
              {view === "workflows" && <WorkflowsView />}
              {view === "settings" && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <MobileNav />
      <CommandPalette />
      <GlobalSearchDialog />
      <WorkflowScheduler />
      <HeartbeatEngine />
      <SessionHealth />
    </div>
  );
}
