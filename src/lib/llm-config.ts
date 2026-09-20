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

/**
 * r27: resolve an EXPLICIT "providerId::model" (or "auto::builtin") pin —
 * the per-chat model override. Never dead-ends: an unknown provider or a
 * keyless one falls back to the global resolution with a note.
 */
export function resolveExplicitLlm(
  settings: Settings,
  override?: string,
  agentModel?: string
): ResolvedLlm {
  const value = override?.trim();
  if (!value || value === "auto::builtin" || value === "auto") {
    return resolveLlm(settings, agentModel);
  }
  const [pid, ...rest] = value.split("::");
  const model = rest.join("::");
  if (!pid || !model) return resolveLlm(settings, agentModel);

  // r26.2: pins against the LEGACY custom endpoint (`custom::<model>`) —
  // the picker now offers these, so the resolver must honor them too.
  if (pid === "custom") {
    const baseUrl = settings.baseUrl?.trim();
    if (baseUrl) {
      return {
        provider: "custom",
        apiKey: settings.apiKey?.trim() || undefined,
        baseUrl,
        model,
        label: `${hostOf(baseUrl)} · ${model}`,
        providerId: "custom",
      };
    }
    const base = resolveLlm(settings, agentModel);
    return {
      ...base,
      fallbackNote: `No custom endpoint configured — used ${base.label} instead.`,
    };
  }

  const reg = providerById(pid);
  const entry = settings.providerKeys?.[pid];
  const key = entry?.key?.trim() ?? "";
  if (reg && (key || reg.noKey)) {
    return {
      provider: "custom",
      apiKey: key || undefined,
      baseUrl: providerBaseUrl(reg, entry?.accountId),
      model,
      label: `${reg.name} · ${model}`,
      providerId: pid,
    };
  }
  const base = resolveLlm(settings, agentModel);
  return {
    ...base,
    fallbackNote: reg
      ? `${reg.name} has no key saved — used ${base.label} instead.`
      : `Unknown provider "${pid}" — used ${base.label} instead.`,
  };
}
