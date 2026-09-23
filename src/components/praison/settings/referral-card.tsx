"use client";

import * as React from "react";
import { Copy, Gift, Globe, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { copyText } from "@/lib/helpers";
import { REFERRAL_REGISTRY, VYCE_REFERRAL_URL } from "@/lib/referral-registry";

// ─── Settings → Referrals (r28) ──────────────────────────────────────────────
// Transparency surface for the referral-advantage registry: shows which
// programs are active, what each side earns, and the honest-linking rules the
// rewriter follows. Inactive programs are documented slots — paste the owner
// link in src/lib/referral-registry.ts to enable.

export function ReferralCard() {
  const active = REFERRAL_REGISTRY.filter((r) => r.active);
  const inactive = REFERRAL_REGISTRY.filter((r) => !r.active);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Gift className="h-4 w-4 text-violet-400" aria-hidden />
          Referral credits
        </CardTitle>
        <CardDescription className="text-[12px] leading-relaxed">
          Outbound links to these services are transparently decorated with the platform&apos;s public referral code —
          free credits for whoever clicks through, at no cost to anyone. No cloaking, no account automation, and links
          that already carry a code are never touched.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.map((r) => (
          <div key={r.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{r.label}</span>
                <Badge variant="secondary" className="h-4.5 rounded bg-emerald-500/15 px-1.5 text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                  active
                </Badge>
                <Badge variant="secondary" className="h-4.5 rounded px-1.5 text-[9px] font-medium uppercase text-muted-foreground">
                  {r.verified}
                </Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-[11px]"
                onClick={async () => {
                  const ok = await copyText(VYCE_REFERRAL_URL);
                  if (ok) toast("Referral link copied — share it to earn credits", { icon: "🎁" });
                }}
              >
                <Copy className="h-3 w-3" aria-hidden />
                Copy link
              </Button>
            </div>
            <p className="mt-1.5 text-[12px] text-muted-foreground">{r.reward}</p>
            <p className="mt-1 break-all font-mono text-[10.5px] text-violet-400/90">{VYCE_REFERRAL_URL}</p>
          </div>
        ))}

        {inactive.length > 0 && (
          <div className="rounded-lg border border-dashed p-3">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              <Info className="h-3 w-3" aria-hidden />
              Waiting for owner links (stored verbatim — never fabricated):
            </p>
            <ul className="mt-1.5 space-y-1">
              {inactive.map((r) => (
                <li key={r.id} className="text-[11.5px] text-muted-foreground">
                  <span className="font-medium text-foreground/70">{r.label}</span> — {r.reward}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
          <Globe className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Chat links get a small <span className="mx-0.5 rounded bg-violet-500/15 px-1 font-semibold text-violet-400">ref</span>
          chip when they were decorated, anchors carry <code className="font-mono">rel=&quot;sponsored nofollow&quot;</code>, and
          every rewrite is visible in the link target. Registry lives in <code className="font-mono">src/lib/referral-registry.ts</code>.
        </p>
      </CardContent>
    </Card>
  );
}
