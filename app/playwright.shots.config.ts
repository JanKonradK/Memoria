import { defineConfig, devices } from '@playwright/test';

/**
 * `npm run shots`: every page, sheet and state drawn at each screen the app
 * ships to, into build/shots, with a report of what the layout gets wrong
 * (overflow, small touch targets, clipped text). Pictures to look at, not a
 * pass/fail gate: the e2e suite is the gate.
 */
const port = Number(process.env.MEMORIA_SHOTS_PORT ?? '5193');
const baseURL = `http://127.0.0.1:${port}`;

const touch = { hasTouch: true, isMobile: true };
const screens = [
  // A large phone (Galaxy S23 Ultra-like) and a small one.
  { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, ...touch } },
  { name: 'phone-small', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, ...touch } },
  { name: 'phone-side', use: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, ...touch } },
  // The owner's Galaxy Tab S7 FE (1752×2800 at display size 256 dpi: 1095×1750 CSS px), upright and on its side,
  // and a smaller tablet at the stock 800px.
  { name: 'tablet', use: { viewport: { width: 1095, height: 1750 }, deviceScaleFactor: 1.6, ...touch } },
  { name: 'tablet-side', use: { viewport: { width: 1750, height: 1095 }, deviceScaleFactor: 1.6, ...touch } },
  { name: 'tablet-small', use: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, ...touch } },
  { name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  { name: 'pc-wide', use: { ...devices['Desktop Chrome'], viewport: { width: 2560, height: 1440 } } },
  {
    name: 'pc-light',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' as const },
  },
  {
    name: 'phone-light',
    use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, ...touch, colorScheme: 'light' as const },
  },
];

export default defineConfig({
  testDir: './shots',
  fullyParallel: true,
  reporter: 'list',
  timeout: 240_000,
  use: {
    baseURL,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    timezoneId: 'Europe/Warsaw',
    locale: 'en-GB',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: screens,
});
