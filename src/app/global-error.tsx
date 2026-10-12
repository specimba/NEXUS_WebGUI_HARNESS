"use client";

// ─── Last-resort boundary (r356): renders when the ROOT LAYOUT itself throws ─
// error.tsx (the page-segment boundary) cannot fire here — it renders INSIDE
// the layout that just crashed. This file must therefore be fully
// self-contained: its own <html>/<body>, inline styles only, and ZERO app
// imports (importing the UI kit or stores here could itself be the broken
// thing). Deliberately plain — recovery beats beauty at this depth.

import * as React from "react";

const BTN_PRIMARY: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #ef4444",
  background: "#ef4444",
  color: "#ffffff",
  cursor: "pointer",
};

const BTN_SECONDARY: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#e4e4e7",
  cursor: "pointer",
};

export default function GlobalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#0c0c0e",
          color: "#e4e4e7",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          role="alert"
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              maxWidth: 480,
              width: "100%",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>
              The app failed to start
            </p>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 12,
                lineHeight: 1.6,
                color: "#a1a1aa",
              }}
            >
              The error came from the app shell itself, so the themed interface
              could not render. Your saved chats, agents, workflows and settings
              live in browser-local storage and are untouched — a reload usually
              recovers.
            </p>
            <p
              style={{
                margin: "0 0 16px",
                fontFamily: "monospace",
                fontSize: 11,
                color: "#a1a1aa",
                wordBreak: "break-word",
              }}
            >
              {error.message || "No error message was provided."}
              {error.digest ? ` — digest ${error.digest}` : ""}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={reset} style={BTN_PRIMARY}>
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={BTN_SECONDARY}
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
