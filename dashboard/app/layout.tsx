import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { THEME_SCRIPT } from '@/lib/theme-script';
import './globals.css';

// Display face for page titles and headline figures: Mona Sans, variable in
// weight and width, self-hosted from @fontsource-variable (no network at build).
const monaSans = localFont({
  src: '../node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-standard-normal.woff2',
  variable: '--font-mona',
  weight: '200 900',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
  preload: true,
});

export const metadata: Metadata = {
  title: {
    default: 'MMR · Reconciliation console',
    template: '%s · MMR',
  },
  description:
    'Operations console for MMR, a PSP-to-ledger reconciliation reference implementation for Nigerian payments (Paystack and Flutterwave).',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e11' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme, data-theme-pref and data-density are set by THEME_SCRIPT before
    // paint and must not be declared here: React would reset them on hydration.
    <html lang="en-NG" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} ${monaSans.variable}`}>
      <head>
        {/* Applies theme and density before first paint: no flash, no layout shift. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
