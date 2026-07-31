import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: '.playwright-artifacts',
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: '.playwright-report/results.xml' }]]
    : [
        ['list'],
        ['html', { outputFolder: '.playwright-report', open: 'never' }],
      ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
