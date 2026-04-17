/**
 * Browser automation tool using Playwright.
 * Keeps a singleton browser alive for speed.
 * Requires: npm install playwright && npx playwright install chromium
 */

import { mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ToolResult } from './tools'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browser: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _page: any = null

async function ensurePage(): Promise<{ ok: true; page: unknown } | { ok: false; error: string }> {
  try {
    if (!_browser) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw: any = await import('playwright').catch(() => null)
      if (!pw) {
        return {
          ok: false,
          error:
            'Playwright is not installed.\n' +
            'Run: npm install playwright && npx playwright install chromium'
        }
      }
      _browser = await pw.chromium.launch({ headless: true })
    }
    if (!_page || _page.isClosed()) {
      const ctx = await _browser.newContext({ viewport: { width: 1280, height: 720 } })
      _page = await ctx.newPage()
    }
    return { ok: true, page: _page }
  } catch (e) {
    return { ok: false, error: `Browser launch failed: ${String(e)}` }
  }
}

export async function browserNavigate(url: string): Promise<ToolResult> {
  const r = await ensurePage()
  if (!r.ok) return { output: r.error, isError: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = r.page as any
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    const title = await page.title()
    return {
      output: `Navigated to: ${url}\nPage title: ${title}\nHTTP status: ${res?.status?.() ?? 'unknown'}`,
      isError: false
    }
  } catch (e) {
    return { output: `Navigation failed: ${String(e)}`, isError: true }
  }
}

export async function browserClick(selector: string): Promise<ToolResult> {
  const r = await ensurePage()
  if (!r.ok) return { output: r.error, isError: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (r.page as any).click(selector, { timeout: 5_000 })
    return { output: `Clicked element: ${selector}`, isError: false }
  } catch (e) {
    return { output: `Click failed on "${selector}": ${String(e)}`, isError: true }
  }
}

export async function browserFill(selector: string, value: string): Promise<ToolResult> {
  const r = await ensurePage()
  if (!r.ok) return { output: r.error, isError: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (r.page as any).fill(selector, value, { timeout: 5_000 })
    return {
      output: `Filled "${selector}" with: ${value.slice(0, 100)}${value.length > 100 ? '…' : ''}`,
      isError: false
    }
  } catch (e) {
    return { output: `Fill failed on "${selector}": ${String(e)}`, isError: true }
  }
}

export async function browserGetText(selector?: string): Promise<ToolResult> {
  const r = await ensurePage()
  if (!r.ok) return { output: r.error, isError: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = r.page as any
    const raw: string = selector
      ? await page.locator(selector).first().innerText({ timeout: 5_000 })
      : await page.evaluate(() => document.body.innerText)
    const text = String(raw ?? '')
    return {
      output: text.slice(0, 8_000) + (text.length > 8_000 ? '\n…(truncated)' : ''),
      isError: false
    }
  } catch (e) {
    return { output: `Get text failed: ${String(e)}`, isError: true }
  }
}

export async function browserScreenshot(): Promise<ToolResult> {
  const r = await ensurePage()
  if (!r.ok) return { output: r.error, isError: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = r.page as any
    const dir = join(app.getPath('userData'), 'browser-screenshots')
    mkdirSync(dir, { recursive: true })
    const filename = `screenshot-${Date.now()}.png`
    const filepath = join(dir, filename)
    const buf: Buffer = await page.screenshot({ path: filepath, type: 'png' })
    const b64 = buf.toString('base64')
    const currentUrl: string = page.url()
    return {
      output:
        `Screenshot saved: ${filepath}\nCurrent URL: ${currentUrl}\n` +
        `Preview (base64, first 500 chars): ${b64.slice(0, 500)}…`,
      isError: false
    }
  } catch (e) {
    return { output: `Screenshot failed: ${String(e)}`, isError: true }
  }
}

export async function browserEval(script: string): Promise<ToolResult> {
  const r = await ensurePage()
  if (!r.ok) return { output: r.error, isError: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (r.page as any).evaluate(script)
    return { output: JSON.stringify(result, null, 2), isError: false }
  } catch (e) {
    return { output: `Eval failed: ${String(e)}`, isError: true }
  }
}

export async function browserClose(): Promise<ToolResult> {
  try {
    if (_page && !_page.isClosed()) { await _page.close(); _page = null }
    if (_browser) { await _browser.close(); _browser = null }
    return { output: 'Browser closed.', isError: false }
  } catch (e) {
    return { output: `Close failed: ${String(e)}`, isError: true }
  }
}
