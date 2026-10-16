"use client";

import { toast } from "sonner";
import { useConversationsStore, useUiStore } from "@/lib/stores";
import { providerMeta, type TrackedModelRow } from "@/lib/tracker-types";

/**
 * One-click "pin this model in the active chat", shared by the tracker
 * surfaces. r469: extracted from the ticker (pin since r28) and the radar tab
 * (r467), which carried near-identical copies — the radar even shipped a
 * comment pointing back at the ticker's implementation. Classic drift risk,
 * now one contract.
 *
 * Contract: with no active conversation, toast honestly + redirect to chat
 * and pin NOTHING; otherwise set the conversation's model override, redirect,
 * and toast with a caller-supplied origin so the user knows where the pin
 * happened ("pinned from the model tracker / model radar"). `onPinned` (the
 * ticker closes its popover) fires on the success path ONLY — the no-chat
 * branch deliberately leaves the surface open so the redirect is visible.
 */
export function usePinModel(origin: string, onPinned?: () => void) {
  const setView = useUiStore((s) => s.setView);
  const activeId = useConversationsStore((s) => s.activeId);
  const setModelOverride = useConversationsStore((s) => s.setModelOverride);

  function pinModel(m: TrackedModelRow) {
    if (!activeId) {
      toast("Open a chat first, then pin the model", { icon: "💬" });
      setView("chat");
      return;
    }
    setModelOverride(activeId, m.id);
    setView("chat");
    onPinned?.();
    toast(`This chat now runs on ${m.modelId}`, {
      description: `${providerMeta(m.providerId).label} — pinned from ${origin}.`,
      icon: "📌",
    });
  }

  return pinModel;
}
