"use client";

// ─── r40 MRTR input gate dialog (MCP 2026-07-28 spec) ────────────────────────
// Mounted ONCE in the app shell. When an interactive lane's MCP tool answers
// `resultType: "input_required"`, the gate store opens this dialog: the user
// sees exactly what the server asked for, answers (or declines), and the call
// retries with `inputResponses`. A live countdown makes the auto-decline
// deadline honest — an unattended dialog can never hang a run forever.

import * as React from "react";
import { Check, Hand, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isConfirmRequest, useMcpGateStore } from "@/lib/mcp-input";
import { cn } from "@/lib/utils";

/** One live countdown tick per second while a gate is open. */
function useSecondsLeft(requestedAt: number, timeoutMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((requestedAt + timeoutMs - now) / 1000));
}

function fmtCountdown(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

export function McpInputDialog() {
  const pending = useMcpGateStore((s) => s.pending);
  const answer = useMcpGateStore((s) => s.answer);
  const decline = useMcpGateStore((s) => s.decline);
  const [values, setValues] = React.useState<string[]>([]);
  const open = pending !== null;

  // Fresh answer slots per gate; reset ONLY when a NEW gate opens
  // (keyed on defName + requestedAt, not pending object identity).
  React.useEffect(() => {
    if (pending) setValues(Array.from({ length: pending.requests.length }, () => ""));
  }, [pending?.defName, pending?.requestedAt]);

  const secondsLeft = useSecondsLeft(pending?.requestedAt ?? 0, pending?.timeoutMs ?? 1);
  const totalSecs = Math.max(1, Math.round((pending?.timeoutMs ?? 1) / 1000));
  const pct = Math.max(0, Math.min(100, (secondsLeft / totalSecs) * 100));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) decline("dismissed");
      }}
    >
      {pending ? (
        <DialogContent
          className="max-w-lg border-violet-500/40 bg-background/95 backdrop-blur"
          role="alertdialog"
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-violet-600 dark:text-violet-300">
              <ShieldQuestion className="h-5 w-5 shrink-0" aria-hidden />
              MCP tool needs your input
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1 text-xs">
                <div>
                  <span className="font-mono text-[11px] text-foreground/80">{pending.serverName}</span>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <span className="font-mono text-[11px] text-foreground/80">{pending.toolName}</span>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{pending.defName}</span>
                </div>
                <div>
                  The tool paused mid-run because it cannot continue without answers. Your reply is sent back to
                  the server and the same call retries — nothing else changes.
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
            {pending.requests.map((req, i) => {
              // r44 type-aware gates: confirmations answer with two buttons.
              const confirm = isConfirmRequest(req);
              return (
              <div key={req.id ?? i} className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-2.5">
                <label className="mb-1.5 flex items-start gap-1.5 text-xs font-medium leading-snug" htmlFor={`mcp-input-${i}`}>
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-bold text-violet-600 dark:text-violet-300" aria-hidden>
                    {i + 1}
                  </span>
                  {req.message ??
                    (typeof req.raw.prompt === "string" && req.raw.prompt
                      ? req.raw.prompt
                      : `The server requested ${req.type ?? "input"} (no description given)`)}
                  {req.type ? (
                    <span className="ml-auto shrink-0 rounded border border-violet-500/30 px-1 py-px font-mono text-[10px] font-normal text-violet-600/80 dark:text-violet-300/80">
                      {req.type}
                    </span>
                  ) : null}
                </label>
                {confirm ? (
                  <div className="flex items-center gap-2" role="radiogroup" aria-label={`Answer request ${i + 1}`}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={(values[i] ?? "") === "yes"}
                      onClick={() =>
                        setValues((v) => {
                          const next = [...v];
                          next[i] = "yes";
                          return next;
                        })
                      }
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        (values[i] ?? "") === "yes"
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "border-border bg-background text-muted-foreground hover:border-emerald-500/40 hover:text-foreground"
                      )}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Approve
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={(values[i] ?? "") === "no"}
                      onClick={() =>
                        setValues((v) => {
                          const next = [...v];
                          next[i] = "no";
                          return next;
                        })
                      }
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        (values[i] ?? "") === "no"
                          ? "border-red-500/60 bg-red-500/15 text-red-600 dark:text-red-400"
                          : "border-border bg-background text-muted-foreground hover:border-red-500/40 hover:text-foreground"
                      )}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      Deny
                    </button>
                  </div>
                ) : (
                  <textarea
                    id={`mcp-input-${i}`}
                    value={values[i] ?? ""}
                    onChange={(e) =>
                      setValues((v) => {
                        const next = [...v];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    rows={2}
                    autoFocus={i === 0}
                    placeholder="Type your answer…"
                    className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-violet-500/60 focus-visible:ring-1 focus-visible:ring-violet-500/40"
                  />
                )}
              </div>
              );
            })}
          </div>

          {/* Honest countdown: the gate auto-declines so a run can never hang. */}
          <div className="space-y-1" aria-live="off">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                auto-declines in{" "}
                <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400">
                  {fmtCountdown(secondsLeft)}
                </span>
              </span>
              <span className="tabular-nums">
                {pending.requests.length} request{pending.requests.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500/80 to-amber-500/80 transition-[width] duration-1000 ease-linear"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => decline("declined by user")} className="gap-1.5">
              <X className="h-3.5 w-3.5" aria-hidden />
              Decline
            </Button>
            <Button
              size="sm"
              onClick={() => answer(values)}
              disabled={values.every((v) => !v.trim())}
              className={cn(
                "gap-1.5 bg-violet-600 text-white hover:bg-violet-700",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              <Hand className="h-3.5 w-3.5" aria-hidden />
              {pending.requests.every((req) => isConfirmRequest(req)) ? "Send decision" : "Provide answers"}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
