import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Runs against the demo-mode build (no backend). See playwright.config.ts.

const PAGES = [
  { path: '/', heading: 'Overview' },
  { path: '/inbox', heading: 'Inbox' },
  { path: '/transactions', heading: 'Transactions' },
  { path: '/matches', heading: 'Matches' },
  { path: '/psp-health', heading: 'PSP health' },
  { path: '/activity', heading: 'Activity' },
  { path: '/reports', heading: 'Daily return' },
  { path: '/system', heading: 'System' },
];

const rows = (page: Page) => page.getByRole('region', { name: 'Discrepancies' }).locator('li button');

async function openInbox(page: Page, query = '') {
  await page.goto(`/inbox${query}`);
  await expect(rows(page).first()).toBeVisible();
}

test.describe('pages', () => {
  for (const p of PAGES) {
    test(`${p.heading} renders with the demo banner and no errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await expect(page.getByRole('note', { name: 'Demo data' })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
    });
  }

  test('the old discrepancies URL redirects to the inbox', async ({ page }) => {
    await page.goto('/discrepancies');
    await expect(page).toHaveURL(/\/inbox/);
  });
});

test.describe('command palette', () => {
  test('opens with Ctrl+K and navigates to a page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox', { name: 'Search pages, actions and records' });
    await expect(input).toBeFocused();
    await input.fill('matches');
    await expect(page.getByRole('option').first()).toContainText('Matches');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/matches$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Matches' })).toBeVisible();
  });

  test('runs an action: inbox filtered to critical', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search pages, actions and records' }).fill('critical');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/inbox\?severity=critical/);
    await expect(page.getByLabel('Severity')).toHaveValue('critical');
  });

  test('searches records live and opens one', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search pages, actions and records' }).fill('DEMO-FLW');
    const record = page.getByRole('group', { name: 'Records' }).getByRole('option').first();
    await expect(record).toContainText('DEMO-FLW');
    await record.click();
    await expect(page).toHaveURL(/\/transactions\?id=/);
    await expect(page.getByRole('dialog')).toContainText('DEMO-FLW');
  });

  test('closes with Escape and shows shortcuts on ?', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
    await page.keyboard.press('Shift+?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });

  test('g then t goes to transactions', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/transactions/);
  });
});

test.describe('inbox triage', () => {
  test('j and k move the cursor, the URL follows, x selects', async ({ page }) => {
    await openInbox(page);
    const first = rows(page).nth(0);
    const second = rows(page).nth(1);
    await expect(first).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('j');
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-current', 'true');
    await expect(page).toHaveURL(/[?&]id=/);
    const urlAfterJ = page.url();
    await page.keyboard.press('k');
    await expect(first).toBeFocused();
    expect(page.url()).not.toEqual(urlAfterJ);

    await page.keyboard.press('x');
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('1 selected');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeHidden();
  });

  test('filters live in the URL and survive a reload', async ({ page }) => {
    await openInbox(page);
    await page.getByLabel('Severity').selectOption('high');
    await expect(page).toHaveURL(/severity=high/);
    await page.reload();
    await expect(page.getByLabel('Severity')).toHaveValue('high');
    await page.getByRole('tab', { name: 'Resolved' }).click();
    await expect(page).toHaveURL(/status=resolved/);
  });

  test('resolving is optimistic: the row leaves at once, then the server confirms', async ({ page }) => {
    await openInbox(page);
    const before = await rows(page).count();
    const ref = (await rows(page).first().locator('.t-mono').textContent())?.trim() ?? '';
    await page.keyboard.press('e');
    const note = page.getByLabel('Resolution note');
    await expect(note).toBeFocused();
    await note.fill('Found in the next payout batch, reference checked.');
    await page.keyboard.press('Control+Enter');
    // The demo engine takes ~450ms to answer; the row is gone before that.
    await expect(rows(page).filter({ hasText: ref })).toHaveCount(0, { timeout: 300 });
    await expect(page.getByRole('status').filter({ hasText: `Resolved: ${ref}` })).toBeVisible();
    await expect(rows(page)).toHaveCount(before - 1);

    await page.getByRole('tab', { name: 'Resolved' }).click();
    await expect(rows(page).filter({ hasText: ref })).toHaveCount(1);
  });

  test('a failed resolve rolls back and says why', async ({ page }) => {
    await openInbox(page);
    const ref = (await rows(page).first().locator('.t-mono').textContent())?.trim() ?? '';
    await page.keyboard.press('Shift+E');
    await page.getByLabel('Resolution note').fill('Not a real break [simulate-failure]');
    await page.getByRole('button', { name: /Mark false positive/ }).click();
    await expect(rows(page).filter({ hasText: ref })).toHaveCount(0, { timeout: 300 });
    await expect(page.getByRole('alert').filter({ hasText: `Couldn’t close ${ref}` })).toBeVisible();
    await expect(rows(page).filter({ hasText: ref })).toHaveCount(1);
  });

  test('a short note is rejected before anything is sent', async ({ page }) => {
    await openInbox(page);
    await page.keyboard.press('e');
    await page.getByLabel('Resolution note').fill('too short');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('Add a little more detail.')).toBeVisible();
    await expect(page.getByLabel('Resolution note')).toHaveAttribute('aria-invalid', 'true');
  });

  test('bulk resolve closes every selected discrepancy', async ({ page }) => {
    await openInbox(page);
    const before = await rows(page).count();
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    const bar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Resolve' }).click();
    const dialog = page.getByRole('dialog', { name: 'Close 2 discrepancies' });
    await dialog.getByLabel('Resolution note').fill('Batch settled by the PSP on the next cycle.');
    await dialog.getByRole('button', { name: 'Resolve 2' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Resolved: 2 discrepancies' })).toBeVisible();
    await expect(rows(page)).toHaveCount(before - 2);
  });
});

test.describe('explorers', () => {
  test('transactions: search narrows, a row opens its lineage', async ({ page }) => {
    await page.goto('/transactions');
    const table = page.getByRole('table');
    await expect(table.locator('tbody tr').first()).toBeVisible();
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search by PSP reference or transaction ID')).toBeFocused();
    await page.keyboard.type('DEMO-PSK');
    await expect(page).toHaveURL(/q=DEMO-PSK/);
    await expect(table.locator('tbody tr').first()).toContainText('DEMO-PSK');
    await table.locator('tbody tr button').first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('tab', { name: 'Lineage' }).click();
    await expect(sheet.getByText('Stored raw')).toBeVisible();
    await expect(sheet.getByText('Received from the PSP')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/id=/);
  });

  test('transactions: 200 rows render and stay interactive', async ({ page }) => {
    await page.goto('/transactions?size=200');
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(200);
    const started = Date.now();
    await page.getByRole('table').locator('tbody tr button').nth(150).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('matches: the inspector shows both legs and the evidence', async ({ page }) => {
    await page.goto('/matches?status=discrepancy');
    await page.getByRole('table').locator('tbody tr button').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Leg A')).toBeVisible();
    await expect(sheet.getByText('Leg B')).toBeVisible();
    await expect(sheet.getByRole('table')).toContainText('Amount');
    await expect(sheet.getByRole('table')).toContainText('Confidence (threshold 0.75)');
  });
});

test.describe('performance', () => {
  for (const p of PAGES) {
    test(`${p.heading} loads without layout shift (CLS < 0.1)`, async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { __cls: number }).__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, `${p.path} CLS`).toBeLessThan(0.1);
    });
  }
});

test.describe('preferences', () => {
  test('theme and density persist across reloads without a flash', async ({ page }) => {
    await page.goto('/system');
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.getByRole('button', { name: 'Compact rows' }).click();
    await page.reload();
    // Read before hydration could change anything: the pre-paint script set these.
    const attrs = await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.density]);
    expect(attrs).toEqual(['dark', 'compact']);
  });

  test('with reduced motion, every page hydrates cleanly and keeps the theme', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('mmr-theme', 'dark'));
    for (const p of PAGES) {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.dataset.theme), p.path).toBe('dark');
    }
    expect(errors).toEqual([]);
  });
});

test.describe('proxy', () => {
  test('forwards only allow-listed routes and rejects cross-origin writes', async ({ request }) => {
    const blocked = await request.get('/api/mmr/v1/admin/keys');
    expect(blocked.status()).toBe(404);
    expect((await blocked.json()).detail).toBe('Not proxied');

    for (const path of ['/api/mmr/v1/search?q=abc', '/api/mmr/v1/system/pipeline-runs?limit=1']) {
      const res = await request.get(path);
      // No backend in this test run: allowed routes reach the upstream and fail with 502, not 404.
      expect(res.status(), path).not.toBe(404);
    }

    const write = await request.post('/api/mmr/v1/reconciliation/discrepancies/bulk-resolve', {
      headers: { origin: 'https://evil.example' },
      data: { ids: ['x'], resolution_note: 'xxxxxxxxxxxx', outcome: 'resolved' },
    });
    expect(write.status()).toBe(403);
  });
});

test.describe('accessibility (axe, WCAG 2.1 AA)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const p of PAGES) {
      test(`${p.heading} in ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('mmr-theme', t), theme);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(p.path);
        await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
      });
    }

    test(`open overlays in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('mmr-theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/matches?status=discrepancy');
      await page.getByRole('table').locator('tbody tr button').first().click();
      await expect(page.getByText('Why these were paired')).toBeVisible();
      let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);

      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox', { name: 'Search pages, actions and records' }).fill('DEMO');
      await expect(page.getByRole('group', { name: 'Records' })).toBeVisible();
      results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
