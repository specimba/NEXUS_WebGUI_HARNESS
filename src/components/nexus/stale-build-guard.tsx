"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// r189 — stale-tab guard. Schedules fire IN THIS TAB with the bundle the tab
// loaded at page-open. Dev HMR dies silently in throttled background tabs, so
// the tab can keep running pre-fix scheduler/relay logic for hours after the
// fix shipped — exactly how the r185/r186 depth-degradation looked "not
// working" while the user's board kept materializing 0/11 deep runs. This
// guard polls the server's code-freshness stamp every 60s; when it changes
// (any edit under src/, or a server restart), it toasts once (sticky) and
// shows a floating pill until the user reloads.
//
// r201 — assertiveness. The r189 toast fires while the tab is BACKGROUND
// (that is exactly when schedules fire and the build goes stale), so the
// user may never have seen it: background tabs bury sonner toasts under
// everything else. Three upgrades, all self-limited:
//   1. Foreground return = immediate re-poll. Background tabs clamp timers
//      to >=1/min; waiting up to a minute after the user comes back is the
//      wrong window — check the stamp the moment the tab is visible again.
//   2. If already stale, the toast is re-asserted on every foreground
//      return. Same sonner id → replaces in place, never stacks. If the
//      user dismissed the sticky toast while away, the situation (running
//      old code) is still true, so re-showing it is honest, not nagging.
//   3. The tab TITLE pings while stale (two 🔄 variants alternating every
//      2s) — the tab strip is visible even when the page is buried behind
//      other windows, and the original title is restored on unmount/reload.

export function StaleBuildGuard() {
  const [stale, setStale] = useState(false);
  const stamp = useRef<string | null>(null);
  const staleRef = useRef(false);

  useEffect(() => {
    let alive = true;

    const announce = () => {
      toast("App updated — this tab runs old code", {
        icon: "🔄",
        id: "stale-build",
        duration: Infinity,
        description:
          "The server picked up new changes (scheduler, relay ladder, fixes) after this tab loaded. Schedules keep firing the OLD logic until you refresh — click the pill to reload now.",
      });
    };

    const poll = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { stamp?: string };
        if (!alive || !j.stamp) return;
        if (stamp.current == null) {
          stamp.current = j.stamp;
        } else if (stamp.current !== j.stamp) {
          stamp.current = j.stamp;
          staleRef.current = true;
          setStale(true);
          announce();
        }
      } catch {
        /* server briefly unavailable — retry next tick */
      }
    };

    // r201: foreground return → freshness check NOW + re-assert if stale.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void poll();
      if (staleRef.current) announce();
    };

    void poll();
    const t = setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // r201: title ping while stale — both variants start with 🔄 so the tab
  // strip always shows the marker; the blink (motion) is what catches the eye.
  useEffect(() => {
    if (!stale) return;
    const original = document.title;
    let flip = false;
    document.title = "🔄 New build — refresh this tab";
    const t = setInterval(() => {
      flip = !flip;
      document.title = flip
        ? "🔄 App updated — old code running"
        : "🔄 New build — refresh this tab";
    }, 2_000);
    return () => {
      clearInterval(t);
      document.title = original;
    };
  }, [stale]);

  if (!stale) return null;
  return (
    <button
      type="button"
      data-testid="stale-build-pill"
      onClick={() => window.location.reload()}
      aria-label="Refresh to load the updated app build"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-700 shadow-sm backdrop-blur transition-colors hover:bg-amber-500/25 dark:text-amber-300"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      New build — refresh tab
    </button>
  );
}
