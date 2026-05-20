import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MMR — Reconciliation Dashboard",
  description:
    "Cross-border mobile money reconciliation engine for Nigerian businesses. Real-time payment matching, discrepancy detection, and CBN reporting.",
  keywords: [
    "reconciliation",
    "fintech",
    "Nigeria",
    "Paystack",
    "Flutterwave",
    "mobile money",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
