import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';

// Captures every page in light and dark, at desktop and mobile widths, into
// docs/screenshots (or SHOT_DIR). Run with: npm run screenshots
// Motion is reduced so every capture shows the settled state.

const OUT = process.env.SHOT_DIR ?? join(__dirname, '..', '..', 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

const PAGES: { name: string; path: string; ready: string; prepare?: (page: Page, viewport: keyof typeof VIEWPORTS) => Promise<void> }[] = [
  { name: 'overview', path: '/', ready: '.recharts-surface' },
  { name: 'inbox', path: '/inbox', ready: '[aria-label="Discrepancies"] li button' },
  {
    name: 'inbox-detail',
    path: '/inbox',
    ready: '[aria-label="Discrepancies"] li button',
    prepare: async (page, viewport) => {
      if (viewport === 'mobile') {
        await page.locator('[aria-label="Discrepancies"] li button').first().click();
        await page.getByRole('dialog').waitFor();
      } else {
        await page.keyboard.press('j');
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await page.getByLabel('Resolution note').fill('Settlement located in the next payout batch.');
      }
    },
  },
  { name: 'transactions', path: '/transactions', ready: '[data-row-button]' },
  {
    name: 'transactions-lineage',
    path: '/transactions?match=matched',
    ready: '[data-row-button]',
    prepare: async (page) => {
      await page.locator('[data-row-button]').first().click();
      await page.getByRole('tab', { name: 'Lineage' }).click();
      await page.getByText('Stored raw').waitFor();
    },
  },
  { name: 'matches', path: '/matches', ready: 'table tbody tr button' },
  {
    name: 'matches-inspector',
    path: '/matches?status=discrepancy',
    ready: 'table tbody tr button',
    prepare: async (page) => {
      await page.locator('table tbody tr button').first().click();
      await page.getByText('Why these were paired').waitFor();
    },
  },
  { name: 'psp-health', path: '/psp-health', ready: 'text=Events, last 24 hours' },
  { name: 'activity', path: '/activity', ready: 'table tbody tr' },
  { name: 'daily-return', path: '/reports', ready: 'table tbody tr' },
  { name: 'system', path: '/system', ready: 'text=How this dashboard is wired' },
  {
    name: 'command-palette',
    path: '/',
    ready: 'text=Needs attention',
    prepare: async (page) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox', { name: 'Search pages, actions and records' }).fill('DEMO-PSK');
      await page.getByRole('option').nth(3).waitFor();
    },
  },
];

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const p of PAGES) {
      test(`${p.name} ${theme} ${viewport}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: VIEWPORTS[viewport],
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
          colorScheme: theme,
          timezoneId: 'Africa/Lagos',
        });
        await context.addInitScript((t) => localStorage.setItem('mmr-theme', t), theme);
        const page = await context.newPage();
        await page.goto(p.path);
        await page.locator(p.ready).first().waitFor();
        await p.prepare?.(page, viewport);
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(OUT, `${p.name}-${theme}-${viewport}.png`) });
        await context.close();
      });
    }
  }
}
