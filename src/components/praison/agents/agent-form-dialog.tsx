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
import { ModelPicker, CapsGlyphs, type PickerOption } from "@/components/praison/model-picker";
import { AUTO_MODEL, TOOL_IDS, TOOL_META } from "@/lib/constants";
import { FREE_PROVIDERS, loadLiveCatalog, providerById, providerModelOptions } from "@/lib/providers";
import { agentLaneKey, laneDisclosure, capsForModel, loadCapsIndex, type CapsIndex } from "@/lib/tracker-caps-index";
import { activeProviderId, laneHints } from "@/lib/llm-config";
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

  // r48: which held catalogs publish each bare model id — positive evidence
  // for the lane-disclosure line's mismatch note (an id in no catalog stays
  // silent). Static curated rosters + persisted live catalogs, same inputs
  // the option list below is built from.
  const publishers = React.useMemo(() => {
    const live = loadLiveCatalog();
    const map: Record<string, string[]> = {};
    for (const p of FREE_PROVIDERS) {
      for (const o of providerModelOptions(p, live)) {
        (map[o.id] ??= []).push(p.id);
      }
    }
    return map;
  }, []);

  // r48 runtime hints — the disclosure line must mirror resolveLlm exactly:
  // a keyless active provider means the model is DORMANT (rides Auto), and a
  // configured legacy custom endpoint runs bare ids on that endpoint.
  const hints = React.useMemo(() => laneHints(providerSettings), [providerSettings]);

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
            {/* r48 group honesty: the groups below are CATALOGS — what each
                provider publishes. The lane that actually runs is disclosed
                reactively beneath the picker. */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Groups list each provider&apos;s catalog. A bare model id runs on your{" "}
              <span className="font-medium text-foreground">
                {activePid === "auto"
                  ? "built-in engine"
                  : activePid === "custom"
                    ? `custom endpoint (${hints.customHost ?? "unconfigured"})`
                    : `${providerById(activePid)?.name ?? activePid} — active`}
              </span>
              , not necessarily the group you picked it from.
            </p>
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
            {/* r48 lane disclosure — the runtime truth, every state honest:
                builtin / dormant (why) / provider (which lane + caps). Unknown
                caps stay silent; mismatch evidence is positive-only. */}
            {(() => {
              const d = laneDisclosure(capsIndex, model, hints, publishers);
              if (d.state === "builtin") {
                return (
                  <p className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    ◌ Built-in lane — the platform engine answers; provider catalogs apply once a keyed provider is active.
                  </p>
                );
              }
              if (d.state === "dormant") {
                const why =
                  d.dormantReason === "no-profile"
                    ? "the built-in profile is active"
                    : d.dormantReason === "no-endpoint"
                      ? "no custom endpoint is configured"
                      : "its provider has no key saved";
                return (
                  <p className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    ◌ Dormant — {why}, so{" "}
                    <span className="font-mono">{d.modelId}</span> rides Auto until that changes.
                  </p>
                );
              }
              const pid = d.providerId as string;
              const pName =
                pid === "custom"
                  ? `custom endpoint (${hints.customHost ?? "custom"})`
                  : providerById(pid)?.name ?? pid;
              return (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[11.5px] leading-relaxed text-sky-700 dark:text-sky-400">
                  <span>
                    → Runs on <span className="font-medium">{pName}</span> · lane{" "}
                    <span className="font-mono">{d.lane}</span>
                  </span>
                  <CapsGlyphs caps={d.caps} />
                  {d.otherPublishers.length > 0 ? (
                    <span className="basis-full text-amber-700 dark:text-amber-400">
                      ⚠ id published by{" "}
                      {d.otherPublishers.map((p) => providerById(p)?.name ?? p).join(", ")}
                      {" "}— not in {pName}&apos;s synced catalog; verify it serves this id
                    </span>
                  ) : null}
                </div>
              );
            })()}
            {/* r46 capability honesty, r48 runtime-faithful: warn only when a
                provider lane IN EFFECT positively lacks tool calling while
                tools are attached. Dormant lanes ride Auto → silence (the
                disclosure line above already says why). Form-scoped wording:
                the shared summary says "this step's" (workflow context) — here
                it is the agent itself that runs the lane. */}
            {tools.length > 0 &&
              (() => {
                const d = laneDisclosure(capsIndex, model, hints, publishers);
                const laneLabel = d.lane.split("::").slice(1).join("::") || d.lane;
                const warns =
                  d.state === "provider" && d.caps !== null && !d.caps.tools;
                return warns ? (
                  <p
                    role="status"
                    className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400"
                  >
                    ⚠ {name.trim() || "This agent"}&apos;s lane ({laneLabel}) does not
                    declare tool calling — this agent&apos;s tools may fail on this
                    lane.
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
