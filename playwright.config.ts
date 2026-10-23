import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './e2e', timeout: 120000, expect: { timeout: 15000 }, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/jingdu/', trace: 'retain-on-failure' },
  projects: [
    { name: 'chrome-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions: existsSync(chrome) ? { executablePath: chrome } : {} } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: { command: 'node scripts/test-server.mjs', url: 'http://127.0.0.1:4173/jingdu/', reuseExistingServer: !process.env.CI },
});
