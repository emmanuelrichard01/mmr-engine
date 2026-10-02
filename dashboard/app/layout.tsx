import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "MMR Engine — Reconciliation Dashboard",
  description:
    "Cross-border mobile money reconciliation engine for Nigerian businesses. Real-time payment matching, discrepancy detection, and CBN reporting.",
  keywords: [
    "reconciliation",
    "fintech",
    "Nigeria",
    "Paystack",
    "Flutterwave",
    "mobile money",
    "MMR",
  ],
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fa" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="font-sans bg-[var(--color-surface-0)] text-[var(--color-surface-900)] antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
