"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/helpers";

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

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
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
          a: (p) => (
            <a
              className="font-medium text-violet-400 underline decoration-violet-500/40 underline-offset-2 hover:text-violet-300"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
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
