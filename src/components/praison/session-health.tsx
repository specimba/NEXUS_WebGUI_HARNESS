"use client";

// ─── Session health: gentle break nudges during long agent activity ─────────
// Inspired by rcaelers/workrave — micro-break reminders for marathon agent
// sessions. Tracks cumulative "busy" time (chat streams + workflow runs) per
// calendar day in localStorage; a dismissible pill appears at the threshold.

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Coffee, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BREAK_SNOOZE_MS,
  BREAK_THRESHOLD_MS,
  SESSION_HEALTH_KEY,
  SESSION_HEALTH_TICK_MS,
} from "@/lib/constants";
import { useUiStore } from "@/lib/stores";

interface SessionHealthData {
  /** YYYY-MM-DD the counter belongs to (resets daily). */
  day: string;
  /** Cumulative ms of agent activity today. */
  activeMs: number;
}

function readData(): SessionHealthData {
  try {
    const raw = localStorage.getItem(SESSION_HEALTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionHealthData>;
      if (typeof parsed.day === "string" && typeof parsed.activeMs === "number") {
        return { day: parsed.day, activeMs: parsed.activeMs };
      }
    }
  } catch {
    /* corrupt — start fresh */
  }
  return { day: new Date().toISOString().slice(0, 10), activeMs: 0 };
}

function writeData(data: SessionHealthData): void {
  try {
    localStorage.setItem(SESSION_HEALTH_KEY, JSON.stringify(data));
  } catch {
    /* quota — non-critical */
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SessionHealth() {
  const [visible, setVisible] = React.useState(false);
  const [activeMin, setActiveMin] = React.useState(0);
  const snoozeUntilRef = React.useRef(0);

  React.useEffect(() => {
    const tick = () => {
      const data = readData();
      const today = todayKey();
      if (data.day !== today) {
        data.day = today;
        data.activeMs = 0;
      }
      if (useUiStore.getState().busy) {
        data.activeMs += SESSION_HEALTH_TICK_MS;
      }
      writeData(data);
      setActiveMin(Math.round(data.activeMs / 60_000));
      if (
        data.activeMs >= BREAK_THRESHOLD_MS &&
        Date.now() >= snoozeUntilRef.current
      ) {
        setVisible(true);
      }
    };
    tick();
    const t = setInterval(tick, SESSION_HEALTH_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const dismiss = React.useCallback(() => {
    setVisible(false);
    const data = readData();
    data.activeMs = 0;
    writeData(data);
    setActiveMin(0);
  }, []);

  const snooze = React.useCallback(() => {
    setVisible(false);
    snoozeUntilRef.current = Date.now() + BREAK_SNOOZE_MS;
  }, []);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          role="alert"
          aria-label="Break reminder"
          className="fixed bottom-24 left-4 z-50 max-w-xs rounded-2xl border border-emerald-500/30 bg-card/95 p-4 shadow-xl shadow-emerald-500/10 backdrop-blur md:bottom-6 md:left-6"
        >
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500"
              aria-hidden
            >
              <Coffee className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">
                Long session — time for a break?
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Agents have been active for{" "}
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {activeMin} min
                </span>{" "}
                today. A short pause keeps you sharp.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={dismiss}
                  className="h-7 gap-1.5 rounded-lg px-2.5 text-xs shadow-sm shadow-emerald-500/20"
                >
                  Taking a break
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={snooze}
                  className="h-7 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Snooze 10m
                </Button>
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss break reminder"
              onClick={snooze}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
