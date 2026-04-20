/**
 * Shared test fixtures and helpers for Playwright E2E tests.
 *
 * Each test gets its own:
 *  - Freshly launched Electron instance
 *  - Isolated userData directory (so settings don't bleed between tests)
 *
 * Usage:
 *   import { test, expect, skipOnboarding } from './helpers'
 */

import { test as base, expect } from '@playwright/test'
import { _electron as electron, ElectronApplication, Page } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'

type Fixtures = {
  electronApp: ElectronApplication
  window: Page
}

export const test = base.extend<Fixtures>({
  // Launch Electron with an isolated temp userData dir
  electronApp: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-e2e-'))

    const app = await electron.launch({
      args: [
        path.join(process.cwd(), 'out/main/index.js'),
        // Chromium flag that also sets Electron's app.getPath('userData')
        `--user-data-dir=${tmpDir}`,
      ],
    })

    await use(app)

    await app.close()
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  },

  // Convenience fixture: the main window, ready after DOM load
  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },
})

export { expect }

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Click "Skip setup" on the onboarding wizard and wait for the chat screen.
 * Call this at the start of any test that needs to be in the chat state.
 */
export async function skipOnboarding(page: Page): Promise<void> {
  await page.getByText('Skip setup, I\'ll configure later').click()
  // Wait for the chat textarea to confirm we're past onboarding
  await page.locator('textarea').waitFor({ state: 'visible', timeout: 10_000 })
}
