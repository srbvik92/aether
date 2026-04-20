/**
 * E2E tests — Side Panels & Modals
 *
 * Covers: terminal toggle, log viewer, keyboard shortcuts modal.
 */

import { test, expect, skipOnboarding } from './helpers'

test.describe('Terminal Panel', () => {
  test('terminal toggle button is visible in sidebar', async ({ window }) => {
    await skipOnboarding(window)

    const termBtn = window.getByRole('button', { name: /Toggle terminal/i })
    await expect(termBtn).toBeVisible()
  })

  test('clicking terminal toggle shows terminal panel', async ({ window }) => {
    await skipOnboarding(window)

    await window.getByRole('button', { name: /Toggle terminal/i }).click()

    // Terminal uses xterm.js — its container has class "xterm"
    await expect(window.locator('.xterm')).toBeVisible({ timeout: 8_000 })
  })

  test('clicking terminal toggle again hides it', async ({ window }) => {
    await skipOnboarding(window)

    const termBtn = window.getByRole('button', { name: /Toggle terminal/i })
    await termBtn.click()
    await expect(window.locator('.xterm')).toBeVisible({ timeout: 8_000 })

    await termBtn.click()
    await expect(window.locator('.xterm')).not.toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Log Viewer', () => {
  test('log viewer button is visible in sidebar', async ({ window }) => {
    await skipOnboarding(window)

    await expect(window.getByRole('button', { name: /View logs/i })).toBeVisible()
  })

  test('clicking logs button opens the log viewer modal', async ({ window }) => {
    await skipOnboarding(window)

    await window.getByRole('button', { name: /View logs/i }).click()

    // Log viewer has level filter pills — ALL is always present (exact to avoid "Backup ALL" etc.)
    await expect(window.getByRole('button', { name: 'ALL', exact: true })).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Keyboard Shortcuts Modal', () => {
  test('? key opens the keyboard shortcuts modal', async ({ window }) => {
    await skipOnboarding(window)

    // Dispatch exactly what the keydown handler listens for: ctrlKey + key='?'
    // (keyboard.press can't reliably produce this cross-platform)
    await window.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', ctrlKey: true, bubbles: true }))
    })

    // The modal heading — use role to avoid matching the shortcut description row
    await expect(window.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible({ timeout: 5_000 })
  })
})
