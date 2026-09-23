"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "next-themes";
import { Check, Copy, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/helpers";
import { applyReferral, referralAnchorProps, type ReferralRewrite } from "@/lib/referral-registry";

// ─── Shared markdown renderer (chat, workflows, test dialogs) ────────────────

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);
  const code = String(children).replace(/\n$/, "");
  const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "code";
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-zinc-950/80 dark:bg-black/40">
      <div className="flex items-center justify-between border-b bg-zinc-900/80 px-3 py-1.5">
        <span className="font-mono text-[11px] text-zinc-400">{lang}</span>
        <button
          type="button"
          aria-label="Copy code"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 opacity-0 transition group-hover/code:opacity-100 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={async () => {
            const ok = await copyText(code);
            if (ok) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className={cn("font-mono text-zinc-200", className)}>{code}</code>
      </pre>
    </div>
  );
}

// ─── Mermaid diagrams (r33, OpenClaw "Mermaid in chat" inspiration) ──────────
// Loaded at RUNTIME from CDN (UMD global) instead of the bundle: the package
// is enormous and melted the sandbox's dev-server memory when it entered the
// compile graph (OOM-killed next-server). CDN loading keeps the / route graph
// lean; an unreachable CDN degrades honestly back to the plain code block.

interface MermaidGlobal {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
let mermaidPromise: Promise<MermaidGlobal> | null = null;

function loadMermaid(): Promise<MermaidGlobal> {
  mermaidPromise ??= new Promise<MermaidGlobal>((resolve, reject) => {
    const w = window as unknown as { mermaid?: MermaidGlobal };
    if (w.mermaid) return resolve(w.mermaid);
    const s = document.createElement("script");
    s.src = MERMAID_CDN;
    s.async = true;
    s.onload = () => {
      const m = (window as unknown as { mermaid?: MermaidGlobal }).mermaid;
      if (m) resolve(m);
      else reject(new Error("mermaid script loaded but global missing"));
    };
    s.onerror = () => reject(new Error("mermaid CDN unreachable"));
    document.head.appendChild(s);
  });
  return mermaidPromise;
}

let mermaidSeq = 0;

function MermaidBlock({ code, dark }: { code: string; dark: boolean }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [showSource, setShowSource] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    setSvg(null);
    setFailed(false);
    let cancelled = false;
    // Debounce: streaming tokens re-parse fast; rendering half a diagram is waste.
    const t = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        // Re-init per render — idempotent, picks up theme flips.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "neutral",
          fontFamily: "inherit",
        });
        const id = `praison-mmd-${++mermaidSeq}`;
        const { svg: out } = await mermaid.render(id, code);
        if (!cancelled) setSvg(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [code, dark]);

  const showDiagram = svg && !failed && !showSource;

  if (showDiagram) {
    return (
      <div className="group/mmd my-3 overflow-hidden rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <Palette className="h-3 w-3" aria-hidden />
            diagram · mermaid
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition group-hover/mmd:opacity-100 hover:bg-muted hover:text-foreground"
              onClick={() => setShowSource(true)}
            >
              Source
            </button>
            <button
              type="button"
              aria-label="Copy mermaid source"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition group-hover/mmd:opacity-100 hover:bg-muted hover:text-foreground"
              onClick={async () => {
                const ok = await copyText(code);
                if (ok) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div
          className="overflow-x-auto p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
          // mermaid's strict securityLevel sanitizes the SVG it emits — this is
          // the library's documented render contract (no HTML labels, no JS).
          dangerouslySetInnerHTML={{ __html: svg }}
          role="img"
          aria-label="Mermaid diagram"
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <CodeBlock className="language-mermaid">{code}</CodeBlock>
      {failed ? (
        <p className="-mt-2 mb-3 rounded-b-lg border border-t-0 border-red-500/30 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-500">
          Mermaid syntax is incomplete or invalid — showing the source instead. Close the code
          fence and check the diagram definition.
        </p>
      ) : null}
    </div>
  );
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <div className={cn("md-body text-[14.5px] leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mb-2 mt-4 text-xl font-bold tracking-tight" {...p} />,
          h2: (p) => <h2 className="mb-2 mt-4 text-lg font-bold tracking-tight" {...p} />,
          h3: (p) => <h3 className="mb-1.5 mt-3 text-base font-semibold" {...p} />,
          p: (p) => <p className="my-2" {...p} />,
          ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
          li: (p) => <li className="pl-0.5" {...p} />,
          // r28 referral registry: known referral-program links get the public
          // owner code appended (harmless anchor decoration) + honest anchor
          // attrs (sponsored/nofollow) + a visible "ref" chip. Everything else
          // passes through untouched.
          a: ({ href, children, ...p }) => {
            const rewrite: ReferralRewrite | null =
              typeof href === "string" ? applyReferral(href) : null;
            const refProps = rewrite ? referralAnchorProps(rewrite) : undefined;
            return (
              <a
                className="font-medium text-violet-400 underline decoration-violet-500/40 underline-offset-2 hover:text-violet-300"
                target="_blank"
                rel={refProps?.rel ?? "noopener noreferrer"}
                href={rewrite?.href ?? href}
                data-ref={refProps?.["data-ref"]}
                title={refProps?.title}
                {...p}
              >
                {children}
                {rewrite && (
                  <sup
                    className="ml-0.5 rounded bg-violet-500/15 px-1 py-px align-super text-[9px] font-semibold uppercase not-italic tracking-wide text-violet-400"
                    aria-label="Referral link (supports the platform)"
                  >
                    ref
                  </sup>
                )}
              </a>
            );
          },
          blockquote: (p) => (
            <blockquote className="my-2 border-l-2 border-violet-500/50 pl-3 italic text-muted-foreground" {...p} />
          ),
          hr: () => <hr className="my-4 border-border" />,
          table: (p) => (
            <div className="my-3 overflow-x-auto rounded-lg border">
              <table className="w-full text-sm" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-muted/60" {...p} />,
          th: (p) => <th className="border-b px-3 py-1.5 text-left font-semibold" {...p} />,
          td: (p) => <td className="border-b px-3 py-1.5 align-top last:border-0" {...p} />,
          code: ({ className, children, ...rest }) => {
            const isBlock = /language-/.test(className ?? "") || String(children).includes("\n");
            // r33: ```mermaid blocks render as diagrams (lazy-loaded, strict security).
            const lang = /language-([\w-]+)/.exec(className ?? "")?.[1]?.toLowerCase();
            if (lang === "mermaid" && isBlock) {
              return <MermaidBlock code={String(children).replace(/\n$/, "")} dark={resolvedTheme === "dark"} />;
            }
            if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px] text-violet-300"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
