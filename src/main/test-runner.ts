/**
 * Test runner — detect framework, run tests, parse results, watch for changes.
 *
 * Supported frameworks:
 *   Jest · Vitest · Mocha · Playwright · pytest · cargo test · go test · dotnet test
 *
 * Parsing produces structured TestSuite / TestCase objects so the UI can render
 * pass/fail lists without knowing anything about the raw output format.
 */

import { existsSync, readFileSync, watch as fsWatch } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'

// ── Public types ──────────────────────────────────────────────────────────────

export type TestStatus = 'pass' | 'fail' | 'skip' | 'pending'

export interface TestCase {
  name:     string       // individual test name
  suite:    string       // parent describe / class name
  status:   TestStatus
  duration: number       // ms (-1 if unknown)
  error?:   string       // failure message / stack trace
}

export interface TestSuite {
  name:     string
  file?:    string
  status:   TestStatus   // derived: pass if all pass, fail if any fail
  tests:    TestCase[]
  duration: number
}

export interface TestRunResult {
  framework: string
  passed:    number
  failed:    number
  skipped:   number
  total:     number
  duration:  number      // ms
  suites:    TestSuite[]
  rawOutput: string
}

export type TestFramework =
  | 'jest' | 'vitest' | 'mocha'
  | 'playwright'
  | 'pytest'
  | 'cargo'
  | 'go'
  | 'dotnet'
  | 'unknown'

export interface DetectedFramework {
  framework: TestFramework
  command:   string
  label:     string
  icon:      string
}

// ── Framework detection ───────────────────────────────────────────────────────

function hasPackage(workspace: string, pkg: string): boolean {
  try {
    const pkgJson = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf-8'))
    return !!(
      pkgJson.dependencies?.[pkg] ||
      pkgJson.devDependencies?.[pkg] ||
      pkgJson.scripts?.test?.includes(pkg)
    )
  } catch { return false }
}

function fileExists(workspace: string, ...names: string[]): boolean {
  return names.some(n => existsSync(join(workspace, n)))
}

export function detectFrameworks(workspace: string): DetectedFramework[] {
  const found: DetectedFramework[] = []

  const isWin = process.platform === 'win32'
  const npx = isWin ? 'npx.cmd' : 'npx'
  const cargo = 'cargo'
  const go = 'go'

  // Playwright — check before jest because playwright uses jest internally in some setups
  if (
    fileExists(workspace, 'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs') ||
    hasPackage(workspace, '@playwright/test') ||
    hasPackage(workspace, 'playwright')
  ) {
    found.push({
      framework: 'playwright',
      command:   `${npx} playwright test`,
      label:     'Playwright',
      icon:      '🎭'
    })
  }

  // Vitest — before jest (vitest has its own config)
  if (
    fileExists(workspace, 'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts') ||
    hasPackage(workspace, 'vitest')
  ) {
    found.push({
      framework: 'vitest',
      command:   `${npx} vitest run`,
      label:     'Vitest',
      icon:      '⚡'
    })
  }

  // Jest
  if (
    fileExists(workspace, 'jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs') ||
    hasPackage(workspace, 'jest') ||
    hasPackage(workspace, '@jest/core')
  ) {
    found.push({
      framework: 'jest',
      command:   `${npx} jest --no-coverage`,
      label:     'Jest',
      icon:      '🃏'
    })
  }

  // Mocha
  if (hasPackage(workspace, 'mocha') || fileExists(workspace, '.mocharc.js', '.mocharc.yml', '.mocharc.json')) {
    found.push({
      framework: 'mocha',
      command:   `${npx} mocha`,
      label:     'Mocha',
      icon:      '☕'
    })
  }

  // Pytest
  if (
    fileExists(workspace, 'pytest.ini', 'pyproject.toml', 'setup.cfg', 'conftest.py') ||
    existsSync(join(workspace, 'tests')) || existsSync(join(workspace, 'test'))
  ) {
    // Only add if there's a Python file in tests/
    if (fileExists(workspace, 'pytest.ini', 'conftest.py') ||
        (fileExists(workspace, 'pyproject.toml') &&
         readFileSync(join(workspace, 'pyproject.toml'), 'utf-8').includes('pytest'))) {
      found.push({
        framework: 'pytest',
        command:   'python -m pytest -v',
        label:     'pytest',
        icon:      '🐍'
      })
    }
  }

  // Cargo (Rust)
  if (fileExists(workspace, 'Cargo.toml')) {
    found.push({
      framework: 'cargo',
      command:   `${cargo} test`,
      label:     'Cargo',
      icon:      '🦀'
    })
  }

  // Go
  if (fileExists(workspace, 'go.mod')) {
    found.push({
      framework: 'go',
      command:   `${go} test ./... -v`,
      label:     'Go',
      icon:      '🐹'
    })
  }

  // .NET
  if (fileExists(workspace, '*.sln') || existsSync(join(workspace, '*.csproj'))) {
    found.push({
      framework: 'dotnet',
      command:   'dotnet test',
      label:     '.NET',
      icon:      '🔷'
    })
  }

  return found
}

// ── Output parsers ────────────────────────────────────────────────────────────

/** Parse Jest / Vitest text output into structured results */
function parseJestOutput(raw: string, framework: TestFramework): TestRunResult {
  const suites: TestSuite[] = []
  let currentSuite: TestSuite | null = null
  let currentSuiteName = ''
  let currentFile = ''

  const lines = raw.split('\n')
  let totalDuration = 0

  for (const line of lines) {
    // New test file: " PASS src/foo.test.ts" or " FAIL src/bar.test.ts"
    const fileMatch = line.match(/^\s*(PASS|FAIL|RUNS)\s+(.+\.(?:test|spec)\.[jt]sx?)/)
    if (fileMatch) {
      currentFile = fileMatch[2].trim()
      currentSuiteName = currentFile
      currentSuite = {
        name:     currentFile,
        file:     currentFile,
        status:   fileMatch[1] === 'PASS' ? 'pass' : 'fail',
        tests:    [],
        duration: 0
      }
      suites.push(currentSuite)
      continue
    }

    // Describe block: "  Format utils" (indented, before tests)
    const describeMatch = line.match(/^  (\w.+)$/)
    if (describeMatch && currentSuite && !line.match(/[✓✗○×✕✔]/)) {
      // Could be a describe name — set it as current context
      currentSuiteName = describeMatch[1].trim()
    }

    // Individual test: "    ✓ formats currency (5ms)" or "    ✕ fails (3ms)"
    const testMatch = line.match(/^\s+([✓✗×✕✔○●\-]|\d+\))\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/)
    if (testMatch && currentSuite) {
      const sym    = testMatch[1]
      const name   = testMatch[2].trim()
      const ms     = testMatch[3] ? parseInt(testMatch[3]) : -1
      const status: TestStatus =
        (sym === '✓' || sym === '✔' || sym === '●' && line.includes('pass')) ? 'pass' :
        (sym === '✗' || sym === '×' || sym === '✕' || /^\d+\)/.test(sym)) ? 'fail' :
        sym === '○' ? 'skip' : 'pending'
      currentSuite.tests.push({
        name,
        suite:    currentSuiteName,
        status,
        duration: ms,
        error:    undefined
      })
      continue
    }

    // Duration line: "Tests: 3 passed, 1 failed, 4 total (5.3 s)"
    const summaryMatch = line.match(/Time:\s+([\d.]+)\s*s/)
    if (summaryMatch) totalDuration = Math.round(parseFloat(summaryMatch[1]) * 1000)
  }

  // Second pass: attach error messages to failed tests
  let inFailureBlock = false
  let currentFailName = ''
  let errorLines: string[] = []

  for (const line of lines) {
    if (line.match(/^\s+●\s+/)) {
      if (currentFailName && errorLines.length) {
        // Attach to matching test
        for (const suite of suites) {
          const tc = suite.tests.find(t => t.status === 'fail' &&
            (currentFailName.includes(t.name) || t.name.includes(currentFailName)))
          if (tc) { tc.error = errorLines.join('\n').trim(); break }
        }
      }
      currentFailName = line.replace(/^\s+●\s+/, '').trim()
      errorLines = []
      inFailureBlock = true
      continue
    }
    if (inFailureBlock) {
      if (line.match(/^\s+at /) || line.match(/^\s+Expected:/) || line.match(/^\s+Received:/)) {
        errorLines.push(line.trim())
      } else if (line.match(/^\s+(✓|✗|○)/) || line.match(/^\s*PASS|FAIL/)) {
        inFailureBlock = false
      }
    }
  }

  const passed  = suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'pass').length, 0)
  const failed  = suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'fail').length, 0)
  const skipped = suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'skip' || t.status === 'pending').length, 0)

  // Derive suite status
  for (const s of suites) {
    s.status = s.tests.some(t => t.status === 'fail') ? 'fail' : 'pass'
  }

  return { framework, passed, failed, skipped, total: passed + failed + skipped, duration: totalDuration, suites, rawOutput: raw }
}

/** Parse pytest -v output */
function parsePytestOutput(raw: string): TestRunResult {
  const suites = new Map<string, TestSuite>()
  const lines = raw.split('\n')

  for (const line of lines) {
    // "tests/test_api.py::TestCreate::test_post_user PASSED [ 40%]"
    const testLine = line.match(/^([\w/\\.\-]+)::(\w+)(?:::(\w+))?\s+(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)/)
    if (!testLine) continue

    const file      = testLine[1]
    const className = testLine[2]
    const method    = testLine[3]
    const rawStatus = testLine[4]

    const status: TestStatus =
      rawStatus === 'PASSED' || rawStatus === 'XPASS' ? 'pass' :
      rawStatus === 'FAILED' || rawStatus === 'ERROR' ? 'fail' : 'skip'

    const suiteName = method ? className : file
    const testName  = method ?? className

    if (!suites.has(suiteName)) {
      suites.set(suiteName, { name: suiteName, file, status: 'pass', tests: [], duration: 0 })
    }
    const suite = suites.get(suiteName)!
    suite.tests.push({ name: testName, suite: suiteName, status, duration: -1 })
  }

  // Parse short test summary for error messages
  let inSummary = false
  let currentTestKey = ''
  let errorLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('FAILED ') || line.startsWith('ERROR ')) {
      currentTestKey = line.split(' ')[1]?.replace('::', '.') ?? ''
    }
    if (line.startsWith('=')) { inSummary = !inSummary; continue }
    if (inSummary && line.trim()) {
      errorLines.push(line.trim())
    }
  }

  const suiteArr = [...suites.values()]
  for (const s of suiteArr) {
    s.status = s.tests.some(t => t.status === 'fail') ? 'fail' : 'pass'
  }

  // Parse totals: "3 passed, 1 failed, 1 skipped in 2.34s"
  const totalMatch = raw.match(/(\d+) passed(?:,\s+(\d+) failed)?(?:,\s+(\d+) skipped)?.*in ([\d.]+)s/)
  const passed  = totalMatch ? parseInt(totalMatch[1]) : suiteArr.reduce((n, s) => n + s.tests.filter(t => t.status === 'pass').length, 0)
  const failed  = totalMatch?.[2] ? parseInt(totalMatch[2]) : suiteArr.reduce((n, s) => n + s.tests.filter(t => t.status === 'fail').length, 0)
  const skipped = totalMatch?.[3] ? parseInt(totalMatch[3]) : suiteArr.reduce((n, s) => n + s.tests.filter(t => t.status === 'skip').length, 0)
  const duration = totalMatch?.[4] ? Math.round(parseFloat(totalMatch[4]) * 1000) : 0

  return { framework: 'pytest', passed, failed, skipped, total: passed + failed + skipped, duration, suites: suiteArr, rawOutput: raw }
}

/** Parse `cargo test` output */
function parseCargoOutput(raw: string): TestRunResult {
  const tests: TestCase[] = []
  const lines = raw.split('\n')

  for (const line of lines) {
    // "test utils::format_currency ... ok"
    const m = line.match(/^test\s+([\w:]+)\s+\.\.\.\s+(ok|FAILED|ignored)/)
    if (m) {
      tests.push({
        name:     m[1],
        suite:    m[1].split('::').slice(0, -1).join('::') || 'root',
        status:   m[2] === 'ok' ? 'pass' : m[2] === 'ignored' ? 'skip' : 'fail',
        duration: -1,
      })
    }
  }

  // Parse failure details: "failures:\n    module::test_name\n\n---- module::test_name stdout ----"
  let inFailure = false
  let failName = ''
  let failLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('---- ') && line.endsWith(' stdout ----')) {
      failName = line.replace('---- ', '').replace(' stdout ----', '').trim()
      failLines = []
      inFailure = true
      continue
    }
    if (inFailure) {
      if (line.startsWith('----') || line.startsWith('test result:')) { inFailure = false; continue }
      failLines.push(line)
    }
    if (!inFailure && failName && failLines.length) {
      const tc = tests.find(t => t.name === failName)
      if (tc) { tc.error = failLines.join('\n').trim(); failName = ''; failLines = [] }
    }
  }

  // Group into suites by module prefix
  const suiteMap = new Map<string, TestSuite>()
  for (const t of tests) {
    const suiteName = t.suite || 'tests'
    if (!suiteMap.has(suiteName)) {
      suiteMap.set(suiteName, { name: suiteName, status: 'pass', tests: [], duration: 0 })
    }
    suiteMap.get(suiteName)!.tests.push(t)
  }

  const suites = [...suiteMap.values()]
  for (const s of suites) {
    s.status = s.tests.some(t => t.status === 'fail') ? 'fail' : 'pass'
  }

  const resultMatch = raw.match(/test result:\s+(ok|FAILED)\.\s+(\d+) passed;\s+(\d+) failed;\s+(\d+) ignored.*?(?:;.+?finished in ([\d.]+)s)?/)
  const passed  = resultMatch ? parseInt(resultMatch[2]) : tests.filter(t => t.status === 'pass').length
  const failed  = resultMatch ? parseInt(resultMatch[3]) : tests.filter(t => t.status === 'fail').length
  const skipped = resultMatch ? parseInt(resultMatch[4]) : tests.filter(t => t.status === 'skip').length
  const duration = resultMatch?.[5] ? Math.round(parseFloat(resultMatch[5]) * 1000) : 0

  return { framework: 'cargo', passed, failed, skipped, total: passed + failed + skipped, duration, suites, rawOutput: raw }
}

/** Parse `go test -v ./...` output */
function parseGoOutput(raw: string): TestRunResult {
  const suiteMap = new Map<string, TestSuite>()
  const lines = raw.split('\n')

  for (const line of lines) {
    // "--- PASS: TestCreateUser (0.05s)" or "--- FAIL: TestCreateUser (0.05s)"
    const m = line.match(/^---\s+(PASS|FAIL|SKIP):\s+(\w+)\s+\(([\d.]+)s\)/)
    if (m) {
      const pkg = 'tests' // could be refined with package detection
      if (!suiteMap.has(pkg)) {
        suiteMap.set(pkg, { name: pkg, status: 'pass', tests: [], duration: 0 })
      }
      suiteMap.get(pkg)!.tests.push({
        name:     m[2],
        suite:    pkg,
        status:   m[1] === 'PASS' ? 'pass' : m[1] === 'FAIL' ? 'fail' : 'skip',
        duration: Math.round(parseFloat(m[3]) * 1000),
      })
      continue
    }

    // "ok  github.com/foo/bar  0.123s" or "FAIL  github.com/foo/bar [build failed]"
    const pkgResult = line.match(/^(ok|FAIL)\s+([\w./\-]+)\s+([\d.]+)s/)
    if (pkgResult) {
      const pkg = pkgResult[2]
      if (!suiteMap.has(pkg)) {
        suiteMap.set(pkg, {
          name:     pkg,
          status:   pkgResult[1] === 'ok' ? 'pass' : 'fail',
          tests:    [],
          duration: Math.round(parseFloat(pkgResult[3]) * 1000)
        })
      }
    }
  }

  const suites = [...suiteMap.values()]
  for (const s of suites) {
    s.status = s.tests.some(t => t.status === 'fail') ? 'fail' :
               s.tests.length === 0 ? s.status : 'pass'
  }

  const passed  = suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'pass').length, 0)
  const failed  = suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'fail').length, 0)
  const skipped = suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'skip').length, 0)

  return { framework: 'go', passed, failed, skipped, total: passed + failed + skipped, duration: 0, suites, rawOutput: raw }
}

/** Parse Playwright output */
function parsePlaywrightOutput(raw: string): TestRunResult {
  const suiteMap = new Map<string, TestSuite>()
  const lines = raw.split('\n')

  for (const line of lines) {
    // "  ✓  tests/login.spec.ts:5 › Login page › should show form (1.2s)"
    // "  ✗  tests/login.spec.ts:12 › Login page › should login (3.4s)"
    const m = line.match(/^\s+([✓✗○×])\s+([\w/.\-]+\.spec\.[jt]sx?):(\d+)\s+›\s+(.+?)(?:\s+\(([\d.]+)s\))?$/)
    if (m) {
      const sym    = m[1]
      const file   = m[2]
      const title  = m[4].trim()
      const ms     = m[5] ? Math.round(parseFloat(m[5]) * 1000) : -1
      const status: TestStatus = sym === '✓' ? 'pass' : sym === '○' ? 'skip' : 'fail'

      // Split title by › to get suite/test name
      const parts = title.split(' › ')
      const suiteName = parts.length > 1 ? parts.slice(0, -1).join(' › ') : file
      const testName  = parts[parts.length - 1]

      if (!suiteMap.has(suiteName)) {
        suiteMap.set(suiteName, { name: suiteName, file, status: 'pass', tests: [], duration: 0 })
      }
      suiteMap.get(suiteName)!.tests.push({
        name: testName, suite: suiteName, status, duration: ms
      })
    }
  }

  const suites = [...suiteMap.values()]
  for (const s of suites) {
    s.status = s.tests.some(t => t.status === 'fail') ? 'fail' : 'pass'
  }

  // "3 passed (5.7s)" or "1 failed, 2 passed (5.7s)"
  const summaryMatch = raw.match(/(\d+) passed(?:.*?(\d+) failed)?.*?\(([\d.]+)s\)/)
  const failMatch    = raw.match(/(\d+) failed/)
  const passed  = summaryMatch ? parseInt(summaryMatch[1]) : suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'pass').length, 0)
  const failed  = failMatch    ? parseInt(failMatch[1])    : suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'fail').length, 0)
  const skipped = suites.reduce((n, s) => n + s.tests.filter(t => t.status === 'skip').length, 0)
  const duration = summaryMatch?.[3] ? Math.round(parseFloat(summaryMatch[3]) * 1000) : 0

  return { framework: 'playwright', passed, failed, skipped, total: passed + failed + skipped, duration, suites, rawOutput: raw }
}

export function parseTestOutput(raw: string, framework: TestFramework): TestRunResult {
  switch (framework) {
    case 'jest':
    case 'vitest':
    case 'mocha':
      return parseJestOutput(raw, framework)
    case 'pytest':
      return parsePytestOutput(raw)
    case 'cargo':
      return parseCargoOutput(raw)
    case 'go':
      return parseGoOutput(raw)
    case 'playwright':
      return parsePlaywrightOutput(raw)
    default:
      return { framework, passed: 0, failed: 0, skipped: 0, total: 0, duration: 0, suites: [], rawOutput: raw }
  }
}

// ── Process management ────────────────────────────────────────────────────────

let _runningTest: ChildProcess | null = null
let _watcherStop: (() => void) | null = null

export function abortTest(): boolean {
  if (!_runningTest) return false
  try {
    if (process.platform === 'win32' && _runningTest.pid) {
      const { execSync } = require('child_process') as typeof import('child_process')
      try { execSync(`taskkill /pid ${_runningTest.pid} /T /F`, { stdio: 'ignore' }) } catch { /* already gone */ }
    } else {
      _runningTest.kill('SIGTERM')
    }
  } catch { /* already dead */ }
  _runningTest = null
  return true
}

export function runTests(
  command: string,
  workspace: string,
  framework: TestFramework,
  onChunk: (chunk: string) => void,
  onDone: (result: TestRunResult) => void
): void {
  abortTest() // kill any in-progress run

  const startTime = Date.now()
  let combined = ''

  const isWin = process.platform === 'win32'
  const child = isWin
    ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        cwd: workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: 'true' }
      })
    : spawn(command, {
        cwd: workspace,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: 'true' }
      })

  _runningTest = child

  const handleData = (data: Buffer) => {
    const chunk = data.toString('utf-8')
    combined += chunk
    onChunk(chunk)
  }

  child.stdout.on('data', handleData)
  child.stderr.on('data', handleData)

  // Hard timeout: 10 minutes
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL') } catch { /* ok */ }
    onDone({ framework, passed: 0, failed: 0, skipped: 0, total: 0,
             duration: Date.now() - startTime, suites: [],
             rawOutput: combined + '\n\n[timed out after 10 minutes]' })
  }, 600_000)

  child.on('close', () => {
    clearTimeout(timer)
    _runningTest = null
    const result = parseTestOutput(combined, framework)
    result.duration = Date.now() - startTime
    onDone(result)
  })

  child.on('error', (err) => {
    clearTimeout(timer)
    _runningTest = null
    onDone({ framework, passed: 0, failed: 0, skipped: 0, total: 0,
             duration: Date.now() - startTime, suites: [],
             rawOutput: combined + '\n\nProcess error: ' + err.message })
  })
}

// ── File watcher ──────────────────────────────────────────────────────────────

const WATCH_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
                             '.py', '.rs', '.go', '.cs', '.java', '.kt',
                             '.spec.ts', '.test.ts', '.spec.js', '.test.js'])

function shouldWatch(path: string): boolean {
  if (path.includes('node_modules') || path.includes('.git') ||
      path.includes('dist/') || path.includes('build/') || path.includes('__pycache__')) {
    return false
  }
  return WATCH_EXTS.has('.' + path.split('.').pop())
}

export function startTestWatcher(
  workspace: string,
  onFired: (changedFile: string) => void
): () => void {
  if (_watcherStop) _watcherStop()

  let debounce: ReturnType<typeof setTimeout> | null = null

  const watcher = fsWatch(workspace, { recursive: true }, (_event, filename) => {
    if (!filename || !shouldWatch(filename)) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      onFired(filename)
    }, 500)
  })

  _watcherStop = () => {
    if (debounce) clearTimeout(debounce)
    try { watcher.close() } catch { /* ok */ }
    _watcherStop = null
  }

  return _watcherStop
}

export function stopTestWatcher(): void {
  _watcherStop?.()
}
