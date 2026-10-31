"use client";

import { useSyncExternalStore, useEffect, useRef } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { AppSidebar, MobileNav, Splash, TopBar } from "@/components/nexus/shell";
import { CommandPalette } from "@/components/nexus/command-palette";
import { GlobalSearchDialog } from "@/components/nexus/global-search-dialog";
import { ShortcutSheet } from "@/components/nexus/shortcut-sheet";
import { ImageStudioDialog } from "@/components/nexus/chat/image-studio";
import { ChatView } from "@/components/nexus/chat/chat-view";
import { HeartbeatEngine } from "@/components/nexus/chat/chat-heartbeat";
import { AgentsView } from "@/components/nexus/agents/agents-view";
import { WorkflowsView } from "@/components/nexus/workflows/workflows-view";
import { WorkflowScheduler } from "@/components/nexus/workflows/workflow-scheduler";
import { AutomationBridge } from "@/components/nexus/workflows/automation-bridge";
import { StaleBuildGuard } from "@/components/nexus/stale-build-guard";
import { RadarView } from "@/components/nexus/radar/radar-view";
import { RADAR_TABS, RADAR_TAB_KEY } from "@/components/nexus/radar/radar-view";
import { writeCache } from "@/components/nexus/radar/radar-shared";
import { ModelTicker } from "@/components/nexus/tracker/model-ticker";
import { SettingsView } from "@/components/nexus/settings/settings-view";
import { ensureSeeded, useConversationsStore, useSettingsStore, useUiStore } from "@/lib/stores";
import { maybeAutoCompact } from "@/lib/storage-hygiene";
import { toast } from "sonner";
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
// #/chat/<id>        → Chat opened on that conversation (stale ids degrade to no-selection)
// #/providers        → Settings scrolled to the free provider gallery
// #/local-models     → Settings scrolled to the WebGPU local-model panel
// #/vault            → Settings scrolled to the Automation vault (server-lane keys)
// #/evolution        → Settings scrolled to the Evolution proposals panel
// #/radar            → Trend Radar view (GitHub stars / HF trending / papers)
// #/radar/<tab>      → Trend Radar opened on that tab (r802: models/github/
//                        hf/papers/frontier — the persisted tab is written in
//                        the view's own JSON envelope before the remount, so
//                        the entry is deterministic and bookmarkable)
// #/chat | #/agents | #/workflows | #/settings → bare view deep-links (r272)
// #/workflows/board → Workflows with the Runs board layout forced open (r747):
//   the layout bit is localStorage-persisted (nexus-ui.workflowBoardOpen, default
//   false) — a wiped profile left the patrol QA probing the card grid, where the
//   board subtree (kanban + corpus-only-runs strip witness) cannot render at all.
//   The sub-path deep-link makes the board deterministic again.

// r427: the bare view heads the URL-reflect bridge may rewrite (see the
// effect in Page). Parameterized heads (chat/<id>, guide/<p>) and wizard
// heads (setup) are deliberately NOT in this set — the bridge must not
// erase their parameters.
const VIEW_KEYS: readonly string[] = ["chat", "agents", "workflows", "settings", "radar"];

function applyHashRoute(): void {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) return;
  const [head, param] = hash.split("/");
  const ui = useUiStore.getState();
  if (head === "setup") {
    ui.openSetupWizard();
  } else if (head === "guide" && param) {
    ui.openSetupWizard(decodeURIComponent(param));
  } else if (
    head === "providers" ||
    head === "local-models" ||
    head === "vault" ||
    head === "evolution"
  ) {
    // Navigational anchors imply leaving the wizard — dismiss it if open.
    // vault/evolution complete the anchor set: the store union already had them
    // and r402's lane-blocked CTA scrolls via the same setter — the hash
    // router was the only surface that couldn't reach those two sections.
    ui.setSetupWizardOpen(false);
    ui.setView("settings");
    ui.setSettingsAnchor(head);
  } else if (head === "radar") {
    ui.setSetupWizardOpen(false);
    ui.setView("radar");
    // r802: #/radar/<tab> — linkable tab deep links. The RadarView remounts on
    // every view switch and reads the persisted tab at its useState init, so
    // writing the SAME JSON envelope its writeCache uses makes the hash the
    // deterministic entry. Invalid tabs are ignored (the view's own fallback
    // to Models stays the single source of truth for staleness).
    if (param && (RADAR_TABS as readonly string[]).includes(param)) {
      writeCache(RADAR_TAB_KEY, param);
    }
  } else if (head === "chat" && param) {
    // r406: shareable/bookmarkable conversation link — the chat analog of
    // guide/<provider>. An unknown/stale id is safe BY DESIGN: chat-view
    // resolves activeId with `?? null` (the same no-selection state a fresh
    // session has), so a rotted bookmark still lands on a usable Chat.
    // Route-time validation would instead race zustand persist hydration.
    ui.setSetupWizardOpen(false);
    ui.setView("chat");
    useConversationsStore.getState().setActive(decodeURIComponent(param));
  } else if (head === "chat" || head === "agents" || head === "workflows" || head === "settings") {
    // r272: every view is linkable/bookmarkable, not just radar. Navigational
    // anchors imply leaving the wizard — dismiss it if open.
    ui.setSetupWizardOpen(false);
    ui.setView(head);
    if (head === "settings") ui.setSettingsAnchor(null); // bare link: top, no section scroll
    // r747: #/workflows/board forces the Runs board layout on — the layout bit
    // is persisted and defaults false, so a fresh/wiped profile lands on the
    // card grid where the kanban (and the corpus-only-runs strip) never mounts.
    // The sub-path beats the persisted bit deterministically; bare #/workflows
    // keeps honoring whatever the profile persisted.
    if (head === "workflows" && param === "board") ui.setWorkflowBoardOpen(true);
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
  // r485: flips once the router effect has consumed the initial hash (see the
  // bridge note below) — declared with the other hooks, before first use.
  const hashConsumedRef = useRef(false);

  // Keep <html data-theme> in sync with the persisted accent theme.
  useEffect(() => {
    const id = uiTheme ?? DEFAULT_UI_THEME;
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", id);
    }
  }, [uiTheme]);

  // r800: boot-time storage pressure responder — the Owner's profile sat at
  // 4.81/5.00 MB. maybeAutoCompact() clears ONLY the refillable caches (radar
  // fetches, intel ladder, free-catalog) and ONLY above 92% of the per-origin
  // character budget; under the threshold it is a silent no-op. Callers own
  // the disclosure: the toast names every freed unit honestly.
  useEffect(() => {
    if (!mounted) return;
    const result = maybeAutoCompact();
    if (result && result.cleared.length > 0) {
      toast.success(
        `Storage auto-compacted: freed ${result.freedChars.toLocaleString()} chars from ${result.cleared.length} refillable cache${result.cleared.length === 1 ? "" : "s"} — they rehydrate on next visit.`,
      );
    }
  }, [mounted]);

  // r427: reflect in-app navigation into the URL. The r272 router was
  // one-way (hash → view): a sidebar / command-palette switch left the hash
  // stale, so a refresh or a copied link landed on an OLDER view than the
  // one on screen. Write-only bridge: history.replaceState (no hashchange
  // event — the listener above stays the sole driver; no history spam).
  // Guarded so parameterized deep links survive: #/chat/<id> keeps its
  // conversation id while chat is active, and #/setup | #/guide/<provider>
  // are never overwritten by this effect.
  // r485: the bridge must not rewrite the hash before the router has
  // CONSUMED the deep link the page loaded with — both effects fire on the
  // same mount flush, and this effect's closure still holds the pre-route
  // view, so a fresh #/settings link was rewritten to #/chat (the default
  // view) before applyHashRoute ever saw it. Bookmarks/shared links to
  // bare views bounced to Chat on any profile whose persisted (or default)
  // view differed — witnessed live in r484. The ref gate skips the bridge
  // until the router effect below has consumed the initial hash.
  useEffect(() => {
    if (!mounted || !hashConsumedRef.current) return;
    const [head] = window.location.hash.replace(/^#\/?/, "").split("/");
    const known = head === "" || VIEW_KEYS.includes(head);
    if (known && head !== view) {
      window.history.replaceState(null, "", `#/${view}`);
    }
  }, [mounted, view]);

  // Handle hash routes on load and while the app is open (#/setup, #/guide/<id>, …).
  useEffect(() => {
    if (!mounted) return;
    applyHashRoute();
    hashConsumedRef.current = true;
    // r796: the r747 board force-open can lose the zustand-persist
    // rehydration race on a cold/rolled profile - witnessed live this round:
    // the view switched to Workflows but the forced workflowBoardOpen bit
    // landed absent, leaving the card grid (no kanban, no corpus strip).
    // Re-apply the route after the rehydration window: two post-mount
    // macrotasks, idempotent reads of the same hash, timers cleaned up.
    const t1 = setTimeout(applyHashRoute, 0);
    const t2 = setTimeout(applyHashRoute, 400);
    // r799: the fixed timers are belt-and-braces, not the mechanism - a slow
    // cold boot can still finish rehydrating AFTER the 400ms re-apply (the
    // r798 open flake: fresh agent-browser profiles sometimes stayed on home
    // past both timers). The deterministic arm is the persist hydration gate:
    // when the async storage has not rehydrated by mount, re-apply the exact
    // same hash the moment hydration lands. When the store hydrated
    // synchronously this registers nothing (the applyHashRoute() above already
    // saw final state). Unsubscribed in the cleanup below.
    let offHydration: (() => void) | null = null;
    if (!useUiStore.persist.hasHydrated()) {
      offHydration = useUiStore.persist.onFinishHydration(() => applyHashRoute());
    }
    const onHash = () => applyHashRoute();
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      clearTimeout(t1);
      clearTimeout(t2);
      offHydration?.();
    };
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
      <ShortcutSheet />
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
