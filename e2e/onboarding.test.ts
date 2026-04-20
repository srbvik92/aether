/**
 * E2E tests — Onboarding Wizard
 *
 * Covers the first-launch experience: welcome screen, provider selection,
 * API key entry, workspace setup, and the skip-all flow.
 */

import { test, expect } from './helpers'

test.describe('Onboarding Wizard', () => {
  test('shows Welcome to Aether on first launch', async ({ window }) => {
    await expect(window.getByRole('heading', { name: 'Welcome to Aether' }))
      .toBeVisible({ timeout: 10_000 })
  })

  test('skip button dismisses onboarding and shows chat screen', async ({ window }) => {
    await window.getByText('Skip setup, I\'ll configure later').click()

    // Onboarding should be gone
    await expect(window.getByRole('heading', { name: 'Welcome to Aether' }))
      .not.toBeVisible()

    // Chat textarea should be visible
    await expect(window.locator('textarea')).toBeVisible({ timeout: 8_000 })
  })

  test('Get started advances to provider selection step', async ({ window }) => {
    await window.getByRole('button', { name: /Get started/i }).click()

    await expect(window.getByText('Choose your AI provider'))
      .toBeVisible({ timeout: 5_000 })
  })

  test('provider step — back button returns to welcome', async ({ window }) => {
    await window.getByRole('button', { name: /Get started/i }).click()
    await expect(window.getByText('Choose your AI provider')).toBeVisible()

    // Use exact text "← Back" to avoid matching "Backup" buttons in the sidebar
    await window.getByRole('button', { name: '← Back' }).click()

    await expect(window.getByRole('heading', { name: 'Welcome to Aether' })).toBeVisible()
  })

  test('can navigate forward through all steps using Custom provider', async ({ window }) => {
    // Welcome → Provider
    await window.getByRole('button', { name: /Get started/i }).click()
    await expect(window.getByText('Choose your AI provider')).toBeVisible()

    // Select Custom (no API key required — best for testing)
    await window.getByText('Custom / OpenAI-compatible').click()
    await window.getByRole('button', { name: /Continue/i }).click()

    // API key step — Custom allows empty key
    await expect(window.getByText('Enter your API key')).toBeVisible()
    await window.getByRole('button', { name: /Continue/i }).click()

    // Workspace step — skip it
    await expect(window.getByText('Set your workspace')).toBeVisible()
    await window.getByRole('button', { name: /Skip for now/i }).click()

    // Done step
    await expect(window.getByText("You're all set!")).toBeVisible()
    await window.getByRole('button', { name: /Start coding/i }).click()

    // Now we should be in the chat
    await expect(window.locator('textarea')).toBeVisible({ timeout: 8_000 })
  })

  test('step progress dots are visible', async ({ window }) => {
    // The progress bar role is on the step dots container
    await expect(window.getByRole('progressbar')).toBeVisible()
  })
})
