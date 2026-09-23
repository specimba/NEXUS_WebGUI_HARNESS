"use client";

// ─── Image Studio · BYOK AI image generation ─────────────────────────────────
// Generates images through provider image endpoints (Vyce · Grok Imagine 2
// today) using the key from the local vault. Results can be downloaded or
// dropped straight into the active chat as a message attachment (the agent
// can then reason about them — vision attachments are already supported).
// Zero telemetry: prompts travel browser → our API route → provider only.

import * as React from "react";
import { Download, ImagePlus, Loader2, MessageSquarePlus, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConversationsStore, useSettingsStore, useUiStore } from "@/lib/stores";
import { uid } from "@/lib/helpers";
import type { ChatMessage } from "@/lib/types";

interface GenResult {
  imageUrl: string;
  revisedPrompt?: string;
  ms: number;
  size: string;
}

const SIZES = [
  { value: "1024x1024", label: "Square · 1024×1024" },
  { value: "1024x768", label: "Landscape · 1024×768" },
  { value: "768x1024", label: "Portrait · 768×1024" },
] as const;

const IDEAS = [
  "a tiny cute robot mascot holding a wrench, flat vector art, violet accent",
  "isometric illustration of a self-organizing team of AI agents, soft gradients",
  "minimal dashboard hero art, abstract flowing data streams, dark background",
];

export function ImageStudioDialog() {
  const open = useUiStore((s) => s.imageStudioOpen);
  const setOpen = useUiStore((s) => s.setImageStudioOpen);
  const settings = useSettingsStore((s) => s.settings);
  const [prompt, setPrompt] = React.useState("");
  const [size, setSize] = React.useState<string>("1024x1024");
  const [busy, setBusy] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<GenResult | null>(null);

  const vyceKey = settings.providerKeys?.vyce?.key?.trim() ?? "";
  const hasKey = vyceKey.length > 0;

  // Elapsed-seconds ticker while generating (image gen takes 15–60s).
  React.useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const iv = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(iv);
  }, [busy]);

  async function handleGenerate() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "vyce", key: vyceKey, prompt: p, size }),
      });
      const data = (await res.json()) as {
        imageUrl?: string;
        revisedPrompt?: string;
        ms?: number;
        error?: string;
      };
      if (!res.ok || !data.imageUrl) {
        setError(data.error ?? `Generation failed (HTTP ${res.status})`);
      } else {
        setResult({ imageUrl: data.imageUrl, revisedPrompt: data.revisedPrompt, ms: data.ms ?? 0, size });
        toast.success("Image ready", { icon: "🎨", description: `${size} · ${((data.ms ?? 0) / 1000).toFixed(1)}s · Grok Imagine 2` });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation request failed");
    } finally {
      setBusy(false);
    }
  }

  function handleAddToChat() {
    if (!result) return;
    const store = useConversationsStore.getState();
    let convId = store.activeId;
    if (!convId) convId = store.create(undefined, undefined, "🎨 Image Studio");
    const msg: ChatMessage = {
      id: uid("msg"),
      role: "user",
      content: prompt.trim() || "🎨 Generated image",
      createdAt: Date.now(),
      toolCalls: [],
      status: "done",
      attachments: [
        {
          name: `grok-imagine-${new Date().toISOString().slice(0, 10)}-${result.size}.jpg`,
          size: Math.round((result.imageUrl.length * 3) / 4),
          content: result.imageUrl,
          kind: "image",
          mime: "image/jpeg",
        },
      ],
    };
    store.appendMessage(convId, msg);
    useUiStore.getState().setView("chat");
    setOpen(false);
    toast.success("Image added to the chat", { icon: "🖼️", description: "Click it to enlarge · the agent can see it too" });
  }

  function handleDownload() {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.imageUrl;
    a.download = `praison-image-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="bg-violet-500/15 flex h-7 w-7 items-center justify-center rounded-lg" aria-hidden>
              <ImagePlus className="h-4 w-4 text-violet-500" />
            </span>
            Image Studio
          </DialogTitle>
          <DialogDescription>
            Generate art with <span className="font-medium text-foreground">Grok Imagine 2</span> via your Vyce
            key — <span className="text-amber-600 dark:text-amber-400">$0.50/image</span> from the daily $10
            credits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!hasKey && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" role="alert">
              No Vyce key in your vault yet — Settings → Providers → Vyce AI to connect one.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="img-prompt">Prompt</Label>
            <Textarea
              id="img-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image… e.g. a violet-lit control room with holographic agent cards"
              rows={3}
              maxLength={1200}
              disabled={busy}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === "Enter") && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              {IDEAS.map((idea, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(idea)}
                  disabled={busy}
                  className="text-muted-foreground hover:border-violet-500/40 hover:text-violet-500 rounded-full border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-50"
                  title={`Use idea: ${idea}`}
                >
                  <Sparkles className="mr-1 inline h-2.5 w-2.5" />
                  {["Robot mascot", "Agent team", "Dashboard art"][i]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="img-size">Aspect</Label>
              <Select value={size} onValueChange={setSize} disabled={busy}>
                <SelectTrigger id="img-size" aria-label="Image aspect ratio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={busy || !prompt.trim() || !hasKey}
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {elapsed}s…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" /> Generate
                </>
              )}
            </Button>
          </div>

          {busy && (
            <p className="text-muted-foreground text-xs" aria-live="polite">
              Painting… this typically takes 15–45 seconds. Keep this tab open.
            </p>
          )}

          {error && (
            <p className="text-destructive rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs" role="alert">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-2">
              <img
                src={result.imageUrl}
                alt={`Generated for prompt: ${prompt.slice(0, 80)}`}
                className="max-h-72 w-full rounded-lg border object-contain"
              />
              {result.revisedPrompt && result.revisedPrompt !== prompt.trim() && (
                <p className="text-muted-foreground text-[11px] italic">
                  Model-revised prompt: “{result.revisedPrompt}”
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleAddToChat} className="bg-violet-600 text-white hover:bg-violet-700">
                  <MessageSquarePlus className="h-3.5 w-3.5" /> Add to chat
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownload}>
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
