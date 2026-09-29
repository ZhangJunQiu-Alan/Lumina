import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration for Lumina
 * Runs end-to-end regression tests on core user journeys.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite --port 3100 --host 127.0.0.1',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    // Hermetic placeholders: every request is served by e2e/fixtures/mockApi.ts, never a real backend.
    env: {
      VITE_SUPABASE_URL: 'https://e2e.supabase.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-publishable-key',
    },
  },
});
