"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ModelPicker, type PickerOption } from "@/components/nexus/model-picker";
import { AUTO_MODEL, TOOL_IDS, TOOL_META } from "@/lib/constants";
import { FREE_PROVIDERS, loadLiveCatalog, providerModelOptions } from "@/lib/providers";
import { relayHealthSnapshot } from "@/lib/relay";
import { withRelayHealth } from "@/lib/relay-health";
import type { Agent, AgentColor, ToolId } from "@/lib/types";
import { firstGrapheme, uid } from "@/lib/helpers";
import { useAgentsStore, useSettingsStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

// ─── Agent create / edit form dialog ─────────────────────────────────────────

const COLOR_SWATCHES: { id: AgentColor; gradient: string; ring: string }[] = [
  { id: "violet", gradient: "from-violet-500 to-purple-600", ring: "ring-violet-500" },
  { id: "emerald", gradient: "from-emerald-500 to-teal-600", ring: "ring-emerald-500" },
  { id: "amber", gradient: "from-amber-500 to-orange-600", ring: "ring-amber-500" },
  { id: "rose", gradient: "from-rose-500 to-pink-600", ring: "ring-rose-500" },
  { id: "cyan", gradient: "from-cyan-500 to-sky-600", ring: "ring-cyan-500" },
  { id: "fuchsia", gradient: "from-fuchsia-500 to-pink-600", ring: "ring-fuchsia-500" },
];

// First user-perceived character — shared from lib/helpers (r226): the
// import sanitizer needs the exact same notion of "one emoji"; a local
// copy here could drift from it.
export function AgentFormDialog({
  open,
  onOpenChange,
  agent = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: Agent | null;
}) {
  const addAgent = useAgentsStore((s) => s.add);
  const updateAgent = useAgentsStore((s) => s.update);
  const providerSettings = useSettingsStore((s) => s.settings);

  const [name, setName] = React.useState("");
  // r225: the two name-validation paths used to be split — an EMPTY name got
  // the browser's native `required` bubble (unstyled, silent to screen
  // readers until focus) while a WHITESPACE-ONLY name sailed past `required`
  // and got only a transient toast with zero field-level feedback. Both now
  // land on one honest inline state: error text under the field,
  // aria-invalid + describedby, destructive ring, and focus pulled to it.
  const [nameError, setNameError] = React.useState(false);
  const [emoji, setEmoji] = React.useState("");
  const [color, setColor] = React.useState<AgentColor>("violet");
  const [role, setRole] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [model, setModel] = React.useState<string>(AUTO_MODEL.id);
  const [temperature, setTemperature] = React.useState(0.7);
  const [maxIterations, setMaxIterations] = React.useState(6);
  const [tools, setTools] = React.useState<ToolId[]>([]);
  const nameRef = React.useRef<HTMLInputElement | null>(null);

  // Dirty tracking: a baseline snapshot is seeded on every open; any drift
  // arms a discard confirmation instead of silently losing typed instructions.
  const [baseline, setBaseline] = React.useState("");
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const current = JSON.stringify({
    name,
    emoji,
    color,
    role,
    description,
    instructions,
    model,
    temperature,
    maxIterations,
    tools,
  });
  const dirty = open && baseline !== "" && current !== baseline;

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  };

  // Every registry provider's catalog, grouped and ready-badged, merged with
  // the persisted live :free catalog — searchable via the ModelPicker.
  const modelOptions = React.useMemo<PickerOption[]>(() => {
    const live = loadLiveCatalog();
    // r73: relay health memory → live per-model badges (same doctrine as the
    // chat composer): a rotator verdict overrides static row badges; lanes
    // never dialed keep theirs. Snapshot read ONCE per rebuild.
    const health = relayHealthSnapshot();
    // r75: badge application consolidated into lib/relay-health (same doctrine
    // as the chat composer — one shared implementation, zero copies).
    const withHealth = (o: PickerOption): PickerOption => withRelayHealth(o, health);
    const out: PickerOption[] = [
      { id: AUTO_MODEL.id, label: AUTO_MODEL.label, note: AUTO_MODEL.note, group: "Built-in" },
    ];
    for (const p of FREE_PROVIDERS) {
      const ready = p.noKey || !!providerSettings.providerKeys?.[p.id]?.key?.trim();
      const group = ready ? p.name : `${p.name} — no key yet`;
      for (const o of providerModelOptions(p, live)) {
        out.push(withHealth({ ...o, group, note: o.note ?? o.id }));
      }
    }
    if (model && model !== AUTO_MODEL.id && !out.some((o) => o.id === model)) {
      out.push({
        id: model,
        label: model,
        note: "saved on this agent",
        badge: "saved",
        badgeTone: "amber",
        group: "Built-in",
      });
    }
    return out;
  }, [model, providerSettings.providerKeys]);

  // Re-seed local state each time the dialog opens (create vs edit).
  React.useEffect(() => {
    if (!open) return;
    const next = agent
      ? {
          name: agent.name,
          emoji: agent.emoji,
          color: agent.color,
          role: agent.role,
          description: agent.description,
          instructions: agent.instructions,
          model: agent.model,
          temperature: agent.temperature,
          maxIterations: agent.maxIterations,
          tools: [...agent.tools],
        }
      : {
          name: "",
          emoji: "",
          color: "violet" as AgentColor,
          role: "",
          description: "",
          instructions: "",
          model: AUTO_MODEL.id,
          temperature: 0.7,
          maxIterations: 6,
          tools: [] as ToolId[],
        };
    setName(next.name);
    setEmoji(next.emoji);
    setColor(next.color);
    setRole(next.role);
    setDescription(next.description);
    setInstructions(next.instructions);
    setModel(next.model);
    // r474: round to step precision on load too — agents saved before the
    // r471/r472 slider hygiene may carry Radix Float32Array dirt
    // (0.699999988079071); the form must not re-save it.
    setTemperature(Math.round(next.temperature * 10) / 10);
    setMaxIterations(next.maxIterations);
    setTools(next.tools);
    setNameError(false);
    setBaseline(JSON.stringify(next));
    setConfirmDiscard(false);
  }, [open, agent]);

  const toggleTool = (id: ToolId, on: boolean) =>
    setTools((prev) => (on ? [...prev, id] : prev.filter((t) => t !== id)));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      // Inline, at the field — the transient toast never pointed anywhere.
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    const payload = {
      name: name.trim(),
      emoji: firstGrapheme(emoji) || "🤖",
      color,
      role: role.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      model,
      temperature,
      maxIterations,
      tools,
    };
    if (agent) {
      updateAgent(agent.id, payload);
      toast.success("Agent updated", { description: `${payload.emoji} ${payload.name}` });
    } else {
      addAgent({
        ...payload,
        id: uid("agent"),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      toast.success("Agent created", { description: `${payload.emoji} ${payload.name}` });
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) requestClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit Agent" : "Create Agent"}</DialogTitle>
          <DialogDescription>
            {agent
              ? "Update this agent's identity, instructions and tools."
              : "Define a new autonomous agent — identity, instructions and tools."}
          </DialogDescription>
        </DialogHeader>

        {/* noValidate: native `required` stays for semantics, but validation
            is handled in code so empty and whitespace-only names get the SAME
            inline, focus-managed feedback instead of a browser bubble. */}
        <form onSubmit={handleSave} noValidate className="space-y-4">
          {/* Name + emoji */}
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                ref={nameRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // Typing a real name clears the error immediately.
                  if (e.target.value.trim()) setNameError(false);
                }}
                placeholder="e.g. Research Scout"
                required
                autoFocus
                aria-invalid={nameError || undefined}
                aria-describedby={nameError ? "agent-name-error" : undefined}
                className={cn(nameError && "border-destructive focus-visible:ring-destructive/40")}
              />
              {nameError ? (
                <p id="agent-name-error" className="text-xs text-destructive">
                  Name is required — give this agent something to be called.
                </p>
              ) : null}
            </div>
            <div className="w-20 space-y-1.5">
              <Label htmlFor="agent-emoji">Emoji</Label>
              <Input
                id="agent-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={8}
                placeholder="🤖"
                className="text-center"
              />
            </div>
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex items-center gap-2.5">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={`Color ${c.id}`}
                  aria-pressed={color === c.id}
                  onClick={() => setColor(c.id)}
                  className={cn(
                    "h-8 w-8 rounded-full bg-gradient-to-br shadow-sm transition-transform",
                    c.gradient,
                    color === c.id
                      ? cn("scale-105 ring-2 ring-offset-2 ring-offset-background", c.ring)
                      : "hover:scale-110"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-role">Role</Label>
            <Input
              id="agent-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Web research specialist"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-description">Description</Label>
            <Textarea
              id="agent-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-liner shown on the agent card"
              className="field-sizing-fixed min-h-0"
            />
          </div>

          {/* Instructions */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-instructions">Instructions</Label>
            <Textarea
              id="agent-instructions"
              rows={5}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="You are…"
              className="field-sizing-fixed min-h-0"
            />
            <p className="text-xs text-muted-foreground">
              System prompt that defines behavior, tone and rules
            </p>
          </div>

          {/* Model — searchable, grouped by provider, status-badged */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-model">Model</Label>
            <ModelPicker
              value={model}
              options={modelOptions}
              onSelect={setModel}
              ariaLabel="Model"
              placeholder="Pick a model…"
              searchPlaceholder="Search models & providers…"
              emptyTitle="No model matches"
              emptyHint="Try a different search — every registry provider's catalog is listed above."
            />
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2.5">
              <Label htmlFor="agent-temperature">Temperature · {temperature.toFixed(1)}</Label>
              <Slider
                id="agent-temperature"
                value={[temperature]}
                min={0}
                max={1.5}
                step={0.1}
                onValueChange={([v]) => setTemperature(Math.round(v * 10) / 10)}
                aria-label="Temperature"
              />
              <p className="text-xs text-muted-foreground">
                Lower = focused and repeatable, higher = loose and creative
              </p>
            </div>
            <div className="space-y-2.5">
              <Label htmlFor="agent-iterations">Max tool iterations · {maxIterations}</Label>
              <Slider
                id="agent-iterations"
                value={[maxIterations]}
                min={1}
                max={10}
                step={1}
                onValueChange={([v]) => setMaxIterations(v)}
                aria-label="Max tool iterations"
              />
              <p className="text-xs text-muted-foreground">
                Tool roundtrips per run — the engine may spend a couple of
                grace steps to land a final answer
              </p>
            </div>
          </div>

          {/* Tools */}
          <div className="space-y-1.5">
            <Label>Tools</Label>
            <div className="space-y-2">
              {TOOL_IDS.map((id) => {
                const meta = TOOL_META[id];
                const checked = tools.includes(id);
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 text-lg leading-none" aria-hidden>
                        {meta.emoji}
                      </span>
                      <div className="min-w-0">
                        <Label className="text-sm">{meta.label}</Label>
                        <p className="text-xs text-muted-foreground">{meta.description}</p>
                      </div>
                    </div>
                    <Switch
                      checked={checked}
                      onCheckedChange={(v) => toggleTool(id, v)}
                      aria-label={`Enable ${meta.label}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit">{agent ? "Save changes" : "Create agent"}</Button>
          </DialogFooter>
        </form>

        <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard changes?</AlertDialogTitle>
              <AlertDialogDescription>
                This agent's edits haven't been saved — closing now loses them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
                onClick={() => onOpenChange(false)}
              >
                Discard
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
