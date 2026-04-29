/**
 * E2E tests — Settings Panel
 *
 * Covers: opening settings, the back button, and verifying key sections render.
 */

import { test, expect, skipOnboarding } from './helpers'

test.describe('Settings Panel', () => {
  test('opens when clicking the settings button', async ({ window }) => {
    await skipOnboarding(window)

    await window.getByRole('button', { name: /Settings/i }).click()

    // Settings back button has exact title "Back to chat (Esc)"
    await expect(window.getByTitle('Back to chat (Esc)')).toBeVisible({ timeout: 5_000 })
  })

  test('back button returns to chat screen', async ({ window }) => {
    await skipOnboarding(window)

    await window.getByRole('button', { name: /Settings/i }).click()
    await window.getByTitle('Back to chat (Esc)').click()

    // Should be back to chat
    await expect(window.locator('textarea')).toBeVisible({ timeout: 5_000 })
  })

  test('system prompt toggle shows Default and Custom options', async ({ window }) => {
    await skipOnboarding(window)

    await window.getByRole('button', { name: /Settings/i }).click()

    // Navigate to the System Prompt section in the left nav
    await window.getByRole('button', { name: /System Prompt/i }).click()

    // The toggle UI should have both buttons
    await expect(window.getByRole('button', { name: 'Default' })).toBeVisible({ timeout: 5_000 })
    await expect(window.getByRole('button', { name: 'Custom' })).toBeVisible()
  })

  test('switching to Custom prompt shows textarea', async ({ window }) => {
    await skipOnboarding(window)

    await window.getByRole('button', { name: /Settings/i }).click()

    // Navigate to the System Prompt section in the left nav
    await window.getByRole('button', { name: /System Prompt/i }).click()

    // Click Custom
    await window.getByRole('button', { name: 'Custom' }).click()

    // A textarea for the custom prompt should appear
    await expect(window.locator('textarea[placeholder*="system prompt"]')).toBeVisible({ timeout: 3_000 })
  })
})
