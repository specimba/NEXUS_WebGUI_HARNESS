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

// r458: raw-byte budget for embedding a generated image into chat history —
// ≈400KB as base64 in the conversations store (the r455 byte-budget ladder
// trims beyond that). Bigger images stay provider-hosted with an honest toast.
const EMBED_BUDGET = 300_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("blob read failed"));
    fr.readAsDataURL(blob);
  });
}

// r473: one truth for the image-extension mapping — was duplicated across
// the add-to-chat and download paths with divergence risk. jpeg→jpg, png/webp
// direct, other image/* subtypes sliced raw (gif stays gif), else jpg.
function extFromMime(mime: string | null | undefined): string {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.startsWith("image/")) return mime.slice("image/".length) || "jpg";
  return "jpg";
}

// r473: the anchor-click save was duplicated for the blob and data-URL paths.
function triggerDownload(href: string, filename: string, revokeAfterMs?: number) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revokeAfterMs) setTimeout(() => URL.revokeObjectURL(href), revokeAfterMs);
}

// r473: shared fetch-to-blob for provider-hosted https results (the r458/r432
// pattern) — null on HTTP failure or CORS block; callers keep their divergent
// fallbacks (embed-hosted toast vs open-in-tab).
async function fetchImageBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export function ImageStudioDialog() {
  const open = useUiStore((s) => s.imageStudioOpen);
  const setOpen = useUiStore((s) => s.setImageStudioOpen);
  const settings = useSettingsStore((s) => s.settings);
  const [prompt, setPrompt] = React.useState("");
  const [size, setSize] = React.useState<string>("1024x1024");
  const [busy, setBusy] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
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
    void addToChat();
  }

  // r458: the chat attachment is the DURABLE artifact — but https results
  // carry provider-hosted URLs that typically EXPIRE, which left a dead image
  // in history (plus fabricated metadata: a base64-length "size" computed on
  // a URL string, hardcoded .jpg/.jpeg mime). Now https results are fetched
  // to a blob first: real bytes + real mime → honest name/size/mime, and the
  // image embeds as a data URL when it fits the budget, so it survives expiry
  // and the agent's vision keeps working later. Over-budget or CORS-blocked
  // results stay hosted — with an honest toast instead of silent rot.
  async function addToChat() {
    if (!result || adding) return;
    let content = result.imageUrl;
    let ext = "jpg";
    let mime = "image/jpeg";
    let bytes = 0;
    let embedded = false;
    const dataM = /^data:image\/(\w+);base64,/.exec(result.imageUrl);
    if (dataM) {
      mime = `image/${dataM[1] ?? "jpeg"}`;
      ext = extFromMime(mime);
      // honest byte count: base64 payload only, not the data: header
      bytes = Math.floor(((result.imageUrl.length - dataM[0].length) * 3) / 4);
      embedded = true;
    } else if (/^https:/i.test(result.imageUrl)) {
      setAdding(true);
      try {
        const blob = await fetchImageBlob(result.imageUrl);
        if (!blob) throw new Error("unfetchable");
        bytes = blob.size;
        mime = blob.type || "image/jpeg";
        ext = extFromMime(blob.type);
        if (blob.size <= EMBED_BUDGET) {
          content = await blobToDataUrl(blob);
          embedded = true;
        } else {
          toast.info("Image stays provider-hosted (too large to embed) — the host link may expire; download it to keep it.", { icon: "🖼️" });
        }
      } catch {
        toast.info("Couldn't fetch the image to embed — the provider link may expire; download it to keep it.", { icon: "🖼️" });
      } finally {
        setAdding(false);
      }
    }
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
          name: `grok-imagine-${new Date().toISOString().slice(0, 10)}-${result.size}.${ext}`,
          size: bytes,
          content,
          kind: "image",
          mime,
        },
      ],
    };
    store.appendMessage(convId, msg);
    useUiStore.getState().setView("chat");
    setOpen(false);
    toast.success("Image added to the chat", {
      icon: "🖼️",
      description: embedded
        ? "Embedded in chat — survives provider link expiry · the agent can see it too"
        : "Click it to enlarge · the agent can see it too",
    });
  }

  async function handleDownload() {
    if (!result || downloading) return;
    // r432: browsers IGNORE the download attribute for cross-origin URLs — for
    // provider-hosted https results the button silently navigated to the image
    // instead of saving a file. Route https results through a blob (extension
    // from the blob's mime), keep data: URLs on the direct path, and fall back
    // to an honest "open in a tab" when CORS blocks the fetch.
    if (/^https:/i.test(result.imageUrl)) {
      setDownloading(true);
      try {
        const blob = await fetchImageBlob(result.imageUrl);
        if (!blob) throw new Error("unfetchable");
        triggerDownload(
          URL.createObjectURL(blob),
          `nexus-image-${Date.now()}.${extFromMime(blob.type)}`,
          10_000
        );
      } catch {
        window.open(result.imageUrl, "_blank", "noopener");
        toast.info("Opened in a new tab — the host blocked a direct save; save it from there.", { icon: "🖼️" });
      } finally {
        setDownloading(false);
      }
      return;
    }
    const m = /^data:image\/(\w+);base64,/.exec(result.imageUrl);
    triggerDownload(
      result.imageUrl,
      `nexus-image-${Date.now()}.${extFromMime(m ? `image/${m[1]}` : null)}`
    );
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
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
                <Button size="sm" onClick={handleAddToChat} disabled={adding} className="bg-violet-600 text-white hover:bg-violet-700">
                  {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquarePlus className="h-3.5 w-3.5" />}
                  {adding ? "Embedding…" : "Add to chat"}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading}>
                  {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
