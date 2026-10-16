"use client";

// ─── Root-segment error boundary (r356) ─────────────────────────────────────
// Before this file existed, ANY uncaught render error in the client tree
// (chat view, workflows view, radar, settings — all live under page.tsx)
// unmounted the whole app onto Next.js's bare default error screen: no
// message, no digest, no copy-out, no honest note about what survives. For
// an app whose users run multi-hour in-tab pipeline sessions, that is the
// worst possible failure surface. This boundary is the calm replacement.
//
// Scope honesty: this catches RENDER errors in the page segment. It cannot
// catch crashes inside the root layout's own providers — that is
// global-error.tsx's job — nor async event-handler errors outside React's
// render pass (those stay console/toast concerns).

import * as React from "react";
import { AlertTriangle, Check, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [stackOpen, setStackOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // r356: diagnostics are built lazily inside the click handler — window and
  // navigator are touch-safe there in both dev and prod. Contains NO key
  // material by construction: assembled from this Error object and the
  // browser environment only (keys live in the vault/store layers and never
  // appear in render errors).
  function copyDiagnostics() {
    const text = [
      `NEXUS WebGUI client error — ${new Date().toISOString()}`,
      `path: ${typeof window !== "undefined" ? window.location.pathname : "?"}`,
      `digest: ${error.digest ?? "none"}`,
      `message: ${error.message}`,
      error.stack
        ? `stack (head):\n${error.stack.slice(0, 1200)}`
        : "stack: unavailable",
      `ua: ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
    ].join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {
        console.info(text); // the clipboard-blocked fallback the panel card already uses
      });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div
        role="alert"
        className="w-full max-w-lg space-y-4 rounded-xl border border-red-500/30 bg-red-500/[0.03] p-5"
      >
        <div className="flex items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10"
            aria-hidden
          >
            <AlertTriangle className="h-4 w-4 text-red-400" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold leading-tight">
              The interface hit an unexpected error
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              React unmounted this view to contain the crash. Your chats, agents,
              workflows and settings are stored locally in this browser — a reload
              brings them back.
            </p>
          </div>
        </div>

        <div className="rounded-lg border bg-background/60 p-2.5">
          <p className="line-clamp-3 break-words font-mono text-xs text-muted-foreground">
            {error.message || "No error message was provided."}
          </p>
          {error.digest ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
              digest {error.digest} — matches the entry in the server console
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setCopied(false);
              setStackOpen(false);
              reset();
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Reload app
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={copyDiagnostics}>
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden />
            )}
            {copied ? "Copied" : "Copy diagnostics"}
          </Button>
          {error.stack ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStackOpen((o) => !o)}
              aria-expanded={stackOpen}
            >
              {stackOpen ? "Hide stack" : "Show stack"}
            </Button>
          ) : null}
        </div>

        {stackOpen && error.stack ? (
          <pre className="max-h-48 overflow-auto rounded-lg border bg-background/60 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {error.stack}
          </pre>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          Diagnostics contain no keys — they are built from this error only.
        </p>
      </div>
    </div>
  );
}
