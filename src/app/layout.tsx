import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PraisonAI — Multi-Agent AI Platform",
  description:
    "Create autonomous AI agents, wire them into workflows and chat with them. Local-first, BYOK, powered by Groq-compatible providers.",
  keywords: ["PraisonAI", "AI agents", "multi-agent", "workflows", "Groq", "BYOK"],
  manifest: "/manifest.webmanifest",
  applicationName: "PraisonAI",
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PraisonAI",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0c0e",
  width: "device-width",
  initialScale: 1,
};

/** Pre-hydration accent theme: reads the persisted settings before React boots
 *  so the splash already renders in the chosen Fallout/Matrix/Cyber theme. */
const THEME_BOOT = `try{(function(){var s=localStorage.getItem("praison-settings");var t=s?JSON.parse(s)?.state?.settings?.uiTheme:null;var ok=["nexus","matrix","fallout","cyber"];if(ok.indexOf(t)>-1){document.documentElement.setAttribute("data-theme",t);}})();}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning on <body>: browser extensions (Grammarly, Monica,
          etc.) inject data-* attributes before React hydrates, which otherwise logs
          a hydration-attribute mismatch console error. */}
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="praison-theme">
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
