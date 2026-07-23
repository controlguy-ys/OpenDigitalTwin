import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 300_000,
  workers: 1,
  expect: { timeout: 15_000 },
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run build:gateway && npm run runtime:gateway',
      url: 'http://127.0.0.1:8081/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run build:e2e && npm run preview -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
