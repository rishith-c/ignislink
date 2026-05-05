import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { Providers } from "./providers";

// System font stack — avoids the network round-trip to Google Fonts for the
// dispatcher console (24/7 ops should not be blocked on a CDN). The CSS
// variables are declared in globals.css so Tailwind's font-sans / font-mono
// utilities resolve correctly.

export const metadata: Metadata = {
  title: {
    default: "SENTRY — Real-time wildfire detection & dispatch",
    template: "%s · SENTRY",
  },
  description:
    "Satellite-driven wildfire detection, ML-predicted spread, and dispatch routing for fire departments and the public.",
  applicationName: "SENTRY",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0d" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased" suppressHydrationWarning>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <Providers>
          <div id="main">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
