import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
// @ts-expect-error plain ESM helper without types
import { ANON_KEY } from './tests/supabase-local/keys.mjs';

// Runs tests/e2e/supabase.spec.ts against the app built in Supabase mode,
// talking to the local stand-in (tests/supabase-local/start.sh must be running).
// Use a preinstalled Chromium when there is one; otherwise Playwright's own (npx playwright install).
const preinstalled = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'supabase.spec.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'supabase', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { executablePath } } }],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY },
  },
});
