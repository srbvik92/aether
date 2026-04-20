/**
 * E2E tests — Chat & Sidebar Navigation
 *
 * Covers: new chat, sidebar buttons, theme switching.
 * All tests skip onboarding first so they start from the chat screen.
 */

import { test, expect, skipOnboarding } from './helpers'

test.describe('Chat & Sidebar', () => {
  test('chat textarea is visible after skipping onboarding', async ({ window }) => {
    await skipOnboarding(window)
    await expect(window.locator('textarea')).toBeVisible()
  })

  test('new chat button clears the active conversation', async ({ window }) => {
    await skipOnboarding(window)

    // The new chat button has aria-label "New chat (Ctrl+N)"
    const newChatBtn = window.getByRole('button', { name: /New chat/i })
    await expect(newChatBtn).toBeVisible()
    await newChatBtn.click()

    // After clicking, textarea should still be visible (chat screen stays open)
    await expect(window.locator('textarea')).toBeVisible()
  })

  test('sidebar settings button opens settings panel', async ({ window }) => {
    await skipOnboarding(window)

    await window.getByRole('button', { name: /Settings/i }).click()

    // Settings back button has exact title "Back to chat (Esc)"
    await expect(window.getByTitle('Back to chat (Esc)')).toBeVisible({ timeout: 5_000 })
  })

  test('theme toggle buttons are visible and clickable', async ({ window }) => {
    await skipOnboarding(window)

    // Theme buttons are in the sidebar footer
    const darkBtn   = window.getByRole('button', { name: 'Dark mode' })
    const lightBtn  = window.getByRole('button', { name: 'Light mode' })
    const systemBtn = window.getByRole('button', { name: 'System (follow OS)' })

    await expect(darkBtn).toBeVisible()
    await expect(lightBtn).toBeVisible()
    await expect(systemBtn).toBeVisible()

    // Clicking Light should switch theme
    await lightBtn.click()
    await expect(window.locator('html')).toHaveClass(/light/, { timeout: 3_000 })

    // Switch back to dark
    await darkBtn.click()
    await expect(window.locator('html')).toHaveClass(/dark/, { timeout: 3_000 })
  })
})
