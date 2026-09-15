// ─── LLM config resolver ─────────────────────────────────────────────────────
// One source of truth for "which brain do agents use right now".
// Order: provider = "auto" → built-in SDK. Otherwise activeProviderId picks a
// registry provider (key from the vault) or the legacy custom endpoint.
// If a registry provider is selected but has no key, we gracefully fall back to
// the auto engine so the app NEVER dead-ends for the user.

import { AUTO_MODEL } from "./constants";
import { providerById, providerBaseUrl } from "./providers";
import type { Settings } from "./types";

export interface ResolvedLlm {
  /** "auto" = built-in SDK engine; "custom" = OpenAI-compatible endpoint. */
  provider: "auto" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Short human label for badges/pickers. */
  label: string;
  /** "auto" | "custom" (legacy) | registry provider id. */
  providerId: string;
  /** True when a registry provider was selected but had no key → auto fallback. */
  fallbackNote?: string;
}

/** The provider the user has currently selected ("auto" | registry id | "custom"). */
export function activeProviderId(settings: Settings): string {
  if (settings.provider === "auto") return "auto";
  const id = settings.activeProviderId?.trim();
  return id && id.length > 0 ? id : "custom";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "custom endpoint";
  }
}

export function resolveLlm(settings: Settings, agentModel?: string): ResolvedLlm {
  const pickModel = (fallback?: string) =>
    agentModel && agentModel !== "auto" ? agentModel : fallback;

  // Built-in engine — zero config.
  if (settings.provider === "auto") {
    return { provider: "auto", label: AUTO_MODEL.label, providerId: "auto" };
  }

  // Registry provider (with vault key).
  const pid = activeProviderId(settings);
  const reg = providerById(pid);
  if (reg) {
    const entry = settings.providerKeys?.[pid];
    const key = entry?.key?.trim() ?? "";
    if (key || reg.noKey) {
      return {
        provider: "custom",
        apiKey: key || undefined,
        baseUrl: providerBaseUrl(reg, entry?.accountId),
        model: pickModel(entry?.model || reg.models[0]?.id),
        label: reg.name,
        providerId: pid,
      };
    }
    // Selected but no key saved → don't dead-end; ride the built-in engine.
    return {
      provider: "auto",
      label: `${reg.name} (no key — using Auto)`,
      providerId: "auto",
      fallbackNote: `Add your ${reg.name} key in Settings to use it.`,
    };
  }

  // Legacy custom endpoint (any OpenAI-compatible URL).
  return {
    provider: "custom",
    apiKey: settings.apiKey?.trim() || undefined,
    baseUrl: settings.baseUrl,
    model: pickModel(settings.defaultModel),
    label: hostOf(settings.baseUrl),
    providerId: "custom",
  };
}

/** True when the given registry provider has a usable key (or needs none). */
export function providerReady(settings: Settings, providerId: string): boolean {
  const reg = providerById(providerId);
  if (!reg) return false;
  if (reg.noKey) return true;
  return !!settings.providerKeys?.[providerId]?.key?.trim();
}
