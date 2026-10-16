"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { copyText } from "@/lib/helpers";

/**
 * r405: the #/vault and #/evolution deep links (r403) are only useful if a
 * user can DISCOVER and COPY them where they stand — an address bar is not
 * a feature. This ghost icon button sits in the host card's header row,
 * writes `origin + /#/<anchor>` to the clipboard via the shared copyText
 * helper (legacy execCommand fallback included, r270) and toasts the honest
 * result: success with a paste hint, or the raw URL spelled out when the
 * clipboard is blocked. The check swap is transient feedback, reset via a
 * timer that is cleared on unmount.
 */
export function DeepLinkShare({
  anchor,
  label,
}: {
  anchor: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copyLink() {
    const url = `${location.origin}/#/${anchor}`;
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      toast.success("Deep link copied", {
        description: `Paste it anywhere — it opens this app straight to ${label}.`,
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Clipboard blocked", {
        description: `Copy this manually: ${url}`,
      });
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="ml-auto size-7 text-muted-foreground/60 hover:text-foreground"
      onClick={copyLink}
      title={`Copy a #/${anchor} link — opens the app scrolled to ${label}`}
      aria-label={`Copy a deep link to ${label} settings section`}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-500" aria-hidden />
      ) : (
        <Link2 className="size-3.5" aria-hidden />
      )}
    </Button>
  );
}
