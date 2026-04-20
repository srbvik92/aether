import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',

  // Each test gets a fresh Electron instance — sequential is fine and avoids port conflicts
  workers: 1,

  // Give Electron time to boot
  timeout: 30_000,

  // Retry once in CI to absorb flakiness
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? 'github' : 'list',

  use: {
    // Capture screenshot on failure for debugging
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
