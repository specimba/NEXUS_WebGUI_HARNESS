"use client";

import { useSyncExternalStore, useEffect } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { AppSidebar, MobileNav, Splash, TopBar } from "@/components/praison/shell";
import { CommandPalette } from "@/components/praison/command-palette";
import { GlobalSearchDialog } from "@/components/praison/global-search-dialog";
import { ImageStudioDialog } from "@/components/praison/chat/image-studio";
import { ChatView } from "@/components/praison/chat/chat-view";
import { HeartbeatEngine } from "@/components/praison/chat/chat-heartbeat";
import { AgentsView } from "@/components/praison/agents/agents-view";
import { WorkflowsView } from "@/components/praison/workflows/workflows-view";
import { WorkflowScheduler } from "@/components/praison/workflows/workflow-scheduler";
import { AutomationBridge } from "@/components/praison/workflows/automation-bridge";
import { StaleBuildGuard } from "@/components/praison/stale-build-guard";
import { RadarView } from "@/components/praison/radar/radar-view";
import { ModelTicker } from "@/components/praison/tracker/model-ticker";
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
// #/radar            → Trend Radar view (GitHub stars / HF trending / papers)

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
  } else if (head === "radar") {
    ui.setSetupWizardOpen(false);
    ui.setView("radar");
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
    /* reducedMotion="user": every framer slide/fade (view transitions, dialogs)
       honors the OS prefers-reduced-motion setting — pairs with the expanded
       CSS block in globals.css (r271, WCAG 2.3.3). */
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/* r28: always-on model tracker ticker (firsthand free-model advantage) */}
        <ModelTicker />
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
              {view === "radar" && <RadarView />}
              {view === "settings" && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <MobileNav />
      <CommandPalette />
      <GlobalSearchDialog />
      {/* Image Studio — global BYOK image generation dialog. r247: moved here
          from chat-view — the command palette's "Open Image Studio…" action
          flipped the store flag on every view, but the dialog only existed in
          the Chat tree, so the action silently no-opped on 4 of 5 views. */}
      <ImageStudioDialog />
      <WorkflowScheduler />
      <AutomationBridge />
      <StaleBuildGuard />
      <HeartbeatEngine />
      </div>
    </MotionConfig>
  );
}
