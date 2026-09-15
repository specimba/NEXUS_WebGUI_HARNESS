"use client";

import { useSettingsStore } from "@/lib/stores";
import { UI_THEMES, uiThemeById } from "@/lib/constants";
import type { UiThemeId } from "@/lib/types";
import { toast } from "sonner";
import { Check } from "lucide-react";

/**
 * Accent-theme picker: four generated-art cards (Nexus / Matrix / Fallout /
 * Cyberpunk). Selecting one persists `settings.uiTheme`; the [data-theme]
 * CSS layer (globals.css) remaps every accent token + violet utility live.
 */
export function ThemePicker() {
  const uiTheme = useSettingsStore((s) => s.settings.uiTheme);
  const update = useSettingsStore((s) => s.update);
  const active = uiThemeById(uiTheme);

  const pick = (id: UiThemeId, label: string) => {
    if (id === active.id) return;
    update({ uiTheme: id });
    toast.success(`${label} theme engaged`, {
      description:
        id === "matrix"
          ? "Wake up, operator — the rain is green now."
          : id === "fallout"
            ? "War never changes. Amber does."
            : id === "cyber"
              ? "Neon nights ahead — chrome and code."
              : "Back to the violet nebula.",
    });
  };

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="radiogroup" aria-label="Accent theme">
      {UI_THEMES.map((t) => {
        const isActive = t.id === active.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${t.label} theme — ${t.tagline}`}
            onClick={() => pick(t.id, t.label)}
            className={`group relative overflow-hidden rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isActive
                ? "border-transparent ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "hover:border-primary/40 hover:shadow-lg"
            }`}
          >
            {/* Art thumbnail */}
            <div
              className="h-16 w-full bg-cover bg-center transition-transform duration-300 group-hover:scale-105"
              style={{ backgroundImage: `url(${t.art})` }}
              aria-hidden
            />
            <div className="space-y-0.5 bg-card p-2.5">
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-semibold">{t.label}</span>
                {isActive && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                )}
              </div>
              <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{t.tagline}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
