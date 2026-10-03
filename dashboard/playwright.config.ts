import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a demo-mode production build (no backend):
// NEXT_PUBLIC_DEMO_MODE=true, built into .next-e2e so it never replaces the
// real build. Set E2E_SKIP_BUILD=1 to reuse an existing .next-e2e.
const PORT = Number(process.env.E2E_PORT ?? 3210);
const env = { NEXT_PUBLIC_DEMO_MODE: 'true', NEXT_DIST_DIR: '.next-e2e', NEXT_TELEMETRY_DISABLED: '1' };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    timezoneId: 'Africa/Lagos',
    locale: 'en-NG',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /screenshots\.spec\.ts/,
    },
    {
      name: 'screenshots',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /screenshots\.spec\.ts/,
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? `npx next start -p ${PORT}` : `npx next build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/system`,
    env,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
