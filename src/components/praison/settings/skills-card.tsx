"use client";

// ─── Skills gallery (r36, PraisonAI SKILL.md doctrine) ───────────────────────
// Import SKILL.md documents (file picker or paste), toggle them into agent
// context, delete freely. INSTRUCTIONS-ONLY by design: the parsed body rides
// along in chat + pipeline prompts (budgeted); a skill's scripts/ folder is
// never executed — the node:vm sandbox discipline is untouched.

import * as React from "react";
import { toast } from "sonner";
import { FileText, Puzzle, Sparkles, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsStore } from "@/lib/stores";
import { parseSkillMarkdown, skillsInjectChars } from "@/lib/skills";
import { SKILLS_INJECT_MAX_CHARS, SKILLS_MAX, SKILL_BODY_MAX_CHARS } from "@/lib/constants";
import { uid } from "@/lib/helpers";
import type { AgentSkill } from "@/lib/types";
import { cn } from "@/lib/utils";

function importSkillTexts(
  texts: { source: string; body: string }[],
  existing: AgentSkill[],
  add: (rows: AgentSkill[]) => void
): void {
  const added: AgentSkill[] = [];
  const failed: string[] = [];
  for (const t of texts) {
    const parsed = parseSkillMarkdown(t.body);
    if (!parsed.ok) {
      failed.push(`${t.source} — ${parsed.error}`);
      continue;
    }
    // Same-named skill replaces the older copy (re-import = update, not dup).
    const dupeIdx = existing.findIndex(
      (s) => s.name.toLowerCase() === parsed.skill.name.toLowerCase()
    );
    const row: AgentSkill = {
      id: dupeIdx >= 0 ? existing[dupeIdx].id : uid("skill"),
      name: parsed.skill.name,
      description: parsed.skill.description,
      body: parsed.skill.body,
      enabled: true,
      chars: parsed.skill.body.length,
      addedAt: Date.now(),
    };
    if (dupeIdx >= 0) existing.splice(dupeIdx, 1);
    existing.push(row);
    added.push(row);
  }
  if (added.length > 0) add(existing);
  if (added.length > 0 && failed.length === 0) {
    toast.success(
      added.length === 1 ? `Skill "${added[0].name}" installed` : `${added.length} skills installed`,
      { icon: "🧩" }
    );
  } else if (added.length > 0) {
    toast.warning(`${added.length} installed, ${failed.length} failed`, {
      description: failed[0],
    });
  } else {
    toast.error("No skill could be parsed", { description: failed[0] ?? "Unknown parse error." });
  }
}

export function SkillsCard() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const skills = settings.skills ?? [];
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");

  const mutate = (rows: AgentSkill[]) =>
    update({ skills: rows });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const texts: { source: string; body: string }[] = [];
    for (const f of Array.from(files)) {
      texts.push({ source: f.name, body: await f.text() });
    }
    importSkillTexts(texts, [...skills], mutate);
  };

  const handlePaste = () => {
    if (pasteText.trim() === "") {
      toast.error("Paste the SKILL.md content first.");
      return;
    }
    importSkillTexts([{ source: "pasted SKILL.md", body: pasteText }], [...skills], mutate);
    setPasteText("");
    setPasteOpen(false);
  };

  const injectChars = skillsInjectChars(skills);
  const budgetPct = Math.min(100, Math.round((injectChars / SKILLS_INJECT_MAX_CHARS) * 100));

  return (
    <Card className="gap-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-violet-500" aria-hidden />
          Skills
        </CardTitle>
        <CardDescription>
          Import SKILL.md documents and every chat turn + pipeline step inherits
          their instructions (budgeted, {SKILLS_INJECT_MAX_CHARS.toLocaleString()} chars max).
          PraisonAI-repo doctrine: skills teach; they never execute — a skill&apos;s
          scripts/ folder is ignored by design.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" className="h-8" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import SKILL.md
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            onClick={() => setPasteOpen((v) => !v)}
            aria-expanded={pasteOpen}
          >
            <Sparkles className="h-3.5 w-3.5" /> {pasteOpen ? "Hide paste box" : "Paste instead"}
          </Button>
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {skills.length}/{SKILLS_MAX} skills ·{" "}
            <span className={cn(budgetPct > 80 && "font-semibold text-amber-500")}>
              {injectChars.toLocaleString()} chars in context
            </span>
          </span>
        </div>

        {pasteOpen ? (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"---\nname: my-skill\ndescription: What this skill teaches\n---\n\n# My skill\n\n1. Do the thing…"}
              className="min-h-32 font-mono text-xs"
              aria-label="Paste SKILL.md content"
            />
            <div className="flex justify-end">
              <Button size="sm" className="h-8 bg-violet-600 text-white hover:bg-violet-700" onClick={handlePaste}>
                Parse & install
              </Button>
            </div>
          </div>
        ) : null}

        {skills.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            No skills installed yet. Drop in a SKILL.md (frontmatter + markdown body) —
            e.g. a code-review checklist, a research protocol, a writing style guide —
            and every agent picks it up while it is toggled on.
          </p>
        ) : (
          <ul className="space-y-2">
            {skills.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "rounded-lg border p-3 transition-all",
                  s.enabled ? "border-violet-500/30 bg-violet-500/[0.04]" : "border-border/70"
                )}
              >
                <div className="flex items-start gap-2">
                  <FileText
                    className={cn("mt-0.5 h-4 w-4 shrink-0", s.enabled ? "text-violet-500" : "text-muted-foreground")}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{s.name}</span>
                      <Badge variant="outline" className="px-1.5 py-0 text-[9px] tabular-nums">
                        {s.chars.toLocaleString()} chars
                      </Badge>
                      {s.chars >= SKILL_BODY_MAX_CHARS ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 px-1.5 py-0 text-[9px] text-amber-600 dark:text-amber-400"
                        >
                          clipped at {SKILL_BODY_MAX_CHARS.toLocaleString()}
                        </Badge>
                      ) : null}
                    </div>
                    {s.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{s.description}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={(v) =>
                        mutate(skills.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))
                      }
                      aria-label={`${s.enabled ? "Disable" : "Enable"} skill ${s.name}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-red-500"
                      onClick={() => {
                        mutate(skills.filter((x) => x.id !== s.id));
                        toast.success(`Skill "${s.name}" removed`);
                      }}
                      aria-label={`Delete skill ${s.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {skills.length > 0 ? (
          <div className="space-y-1">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted/60"
              role="meter"
              aria-valuenow={budgetPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Enabled skills context budget"
            >
              <div
                className={cn(
                  "block h-full rounded-full transition-all duration-500",
                  budgetPct > 80 ? "bg-amber-500" : "bg-violet-500/70"
                )}
                style={{ width: `${Math.max(budgetPct, 2)}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {budgetPct}% of the per-turn skills budget in use — over-budget skills are
              injected oldest-first and clipped.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
