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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ModelPicker, type PickerOption } from "@/components/praison/model-picker";
import { AUTO_MODEL, TOOL_IDS, TOOL_META } from "@/lib/constants";
import { FREE_PROVIDERS, loadLiveCatalog, providerModelOptions } from "@/lib/providers";
import { agentLaneKey, agentLaneSummary, capsForModel, loadCapsIndex, type CapsIndex } from "@/lib/tracker-caps-index";
import { activeProviderId } from "@/lib/llm-config";
import type { Agent, AgentColor, ToolId } from "@/lib/types";
import { uid } from "@/lib/helpers";
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
  const [emoji, setEmoji] = React.useState("");
  const [color, setColor] = React.useState<AgentColor>("violet");
  const [role, setRole] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [model, setModel] = React.useState<string>(AUTO_MODEL.id);
  const [temperature, setTemperature] = React.useState(0.7);
  const [maxIterations, setMaxIterations] = React.useState(6);
  const [tools, setTools] = React.useState<ToolId[]>([]);

  // Every registry provider's catalog, grouped and ready-badged, merged with
  // the persisted live :free catalog — searchable via the ModelPicker.
  // r46: rows also carry capability glyphs from the tracker mirror, so a
  // tool-calling lane is recognizable at pick-time.
  // r47 runtime-faithfulness fix: glyphs key on the option's OWN provider
  // entry ("p::model" — what that catalog publishes, same convention the
  // composer uses), and the reactive warning keys on the lane the agent
  // will ACTUALLY run (bare id × active provider — resolveLlm semantics).
  const capsIndex = React.useState<CapsIndex>(() => loadCapsIndex())[0];
  const activePid = activeProviderId(providerSettings);
  const modelOptions = React.useMemo<PickerOption[]>(() => {
    const live = loadLiveCatalog();
    const out: PickerOption[] = [
      { id: AUTO_MODEL.id, label: AUTO_MODEL.label, note: AUTO_MODEL.note, group: "Built-in" },
    ];
    for (const p of FREE_PROVIDERS) {
      const ready = p.noKey || !!providerSettings.providerKeys?.[p.id]?.key?.trim();
      const group = ready ? p.name : `${p.name} — no key yet`;
      for (const o of providerModelOptions(p, live)) {
        out.push({ ...o, group, note: o.note ?? o.id, caps: capsForModel(capsIndex, `${p.id}::${o.id}`) });
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
        caps: capsForModel(capsIndex, agentLaneKey(model, activePid)),
      });
    }
    return out;
  }, [model, providerSettings.providerKeys, capsIndex, activePid]);

  // Re-seed local state each time the dialog opens (create vs edit).
  React.useEffect(() => {
    if (!open) return;
    if (agent) {
      setName(agent.name);
      setEmoji(agent.emoji);
      setColor(agent.color);
      setRole(agent.role);
      setDescription(agent.description);
      setInstructions(agent.instructions);
      setModel(agent.model);
      setTemperature(agent.temperature);
      setMaxIterations(agent.maxIterations);
      setTools([...agent.tools]);
    } else {
      setName("");
      setEmoji("");
      setColor("violet");
      setRole("");
      setDescription("");
      setInstructions("");
      setModel(AUTO_MODEL.id);
      setTemperature(0.7);
      setMaxIterations(6);
      setTools([]);
    }
  }, [open, agent]);

  const toggleTool = (id: ToolId, on: boolean) =>
    setTools((prev) => (on ? [...prev, id] : prev.filter((t) => t !== id)));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Agent needs a name");
      return;
    }
    const payload = {
      name: name.trim(),
      emoji: emoji.trim() || "🤖",
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit Agent" : "Create Agent"}</DialogTitle>
          <DialogDescription>
            {agent
              ? "Update this agent's identity, instructions and tools."
              : "Define a new autonomous agent — identity, instructions and tools."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Name + emoji */}
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Research Scout"
                required
                autoFocus
              />
            </div>
            <div className="w-20 space-y-1.5">
              <Label htmlFor="agent-emoji">Emoji</Label>
              <Input
                id="agent-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={2}
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

          {/* Model — searchable, grouped by provider, status-badged, caps-glyphed */}
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
            {/* r46 capability honesty, r47 runtime-faithful: warn only when
                the lane IN EFFECT (bare id × active provider — built-in lane
                when the profile is on auto) positively lacks tool calling
                while tools are attached. Dormant/unknown lanes stay silent. */}
            {tools.length > 0 &&
              (() => {
                const warning = agentLaneSummary(
                  capsIndex,
                  { name: name.trim() || "This agent", model, tools },
                  activePid
                ).warning;
                return warning ? (
                  <p
                    role="status"
                    className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400"
                  >
                    ⚠ {warning}
                  </p>
                ) : null;
              })()}
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
                onValueChange={([v]) => setTemperature(v)}
                aria-label="Temperature"
              />
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
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{agent ? "Save" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
