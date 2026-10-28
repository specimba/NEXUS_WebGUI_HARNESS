"use client";

import * as React from "react";
import { Boxes, Database, FileText, Github, Telescope } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/nexus/atoms";
import { ModelRadarTab } from "@/components/nexus/tracker/model-radar-tab";
import { readCache, writeCache } from "./radar-shared";
import { GitHubStarsTab } from "./github-stars-tab";
import { HfTrendingTab } from "./hf-trending-tab";
import { PaperRadarTab } from "./paper-radar-tab";
import { FrontierScoutTab } from "./frontier-scout-tab";

// ─── Trend Radar (r26) ───────────────────────────────────────────────────────
// Four radars in one view — the user's GitHub stars, Hugging Face trending
// and an arXiv paper radar. Local-first: every tab caches its last result in
// localStorage and only phones out on explicit fetches (GitHub/HF public APIs
// + our own /api/radar/papers proxy). Nothing is sent anywhere else.
//
// r511: fifth tab — Frontier Scout (trend ingestion + judge cascade over
// /api/radar/frontier). Same persistence flow, same tab-strip pattern.

// r301: the last-visited radar tab joins the persisted set — r240 taught the
// inner controls to survive remounts (HF kind, GH username, arXiv query);
// this is the same treatment one level up.
const RADAR_TAB_KEY = "nexus-radar-tab";
const RADAR_TABS = ["models", "github", "hf", "papers", "frontier"] as const;
type RadarTab = (typeof RADAR_TABS)[number];

// ─── View shell ──────────────────────────────────────────────────────────────

export function RadarView() {
  // r301: controlled tab + persistence. The view remounts on every view
  // switch (r240's own premise), so the uncontrolled defaultValue="models"
  // yanked the user back to Models each time — the inner controls remembered
  // their state while the tab strip itself forgot. Invalid saved values fall
  // back to Models (the radar never throws on a stale key).
  const [tab, setTabState] = React.useState<RadarTab>(() => {
    const saved = readCache<string>(RADAR_TAB_KEY);
    return (RADAR_TABS as readonly string[]).includes(saved ?? "") ? (saved as RadarTab) : "models";
  });
  const setTab = (t: string) => {
    setTabState(t as RadarTab);
    writeCache(RADAR_TAB_KEY, t);
  };
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Trend Radar"
        description="Free/new models · GitHub stars · HF trending · arXiv papers · frontier scout — fetched on demand, cached locally"
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-4 pt-3 md:px-6">
          <TabsList aria-label="Trend radar sections">
            <TabsTrigger value="models" aria-label="Radar tab: Models" className="gap-1.5">
              <Database className="h-3.5 w-3.5" aria-hidden />
              Models
            </TabsTrigger>
            <TabsTrigger value="github" aria-label="Radar tab: GitHub Stars" className="gap-1.5">
              <Github className="h-3.5 w-3.5" aria-hidden />
              GitHub Stars
            </TabsTrigger>
            <TabsTrigger value="hf" aria-label="Radar tab: HF Trending" className="gap-1.5">
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              HF Trending
            </TabsTrigger>
            <TabsTrigger value="papers" aria-label="Radar tab: Paper Radar" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Paper Radar
            </TabsTrigger>
            <TabsTrigger value="frontier" aria-label="Radar tab: Frontier" className="gap-1.5">
              <Telescope className="h-3.5 w-3.5" aria-hidden />
              Frontier
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="models" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <ModelRadarTab />
        </TabsContent>
        {/* r516: EVERY tab content is its own scroll container — the models tab
            had overflow-y-auto while github/hf/papers/frontier relied on page
            scroll that the app shell (h-full flex) never provides, so tall
            boards clipped with no way to reach the bottom rows. Same class on
            all five — one truth, no per-tab drift (the recurring scroll bug). */}
        <TabsContent value="github" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <GitHubStarsTab />
        </TabsContent>
        <TabsContent value="hf" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <HfTrendingTab />
        </TabsContent>
        <TabsContent value="papers" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <PaperRadarTab />
        </TabsContent>
        <TabsContent value="frontier" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <FrontierScoutTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
