/**
 * TestRunnerPanel — interactive test runner with live output streaming.
 *
 * Features:
 *  - Auto-detects test frameworks (Jest, Vitest, Playwright, pytest, cargo, go)
 *  - Live streaming output with ANSI-stripped text
 *  - Visual pass/fail results per test suite and individual test
 *  - "Auto-fix" button on each failed test — sends failure to AI chat
 *  - Watch mode: reruns on file save (like vitest --watch)
 *  - Playwright HTML report button
 *  - Custom command override
 */

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types (mirrors main/test-runner.ts) ───────────────────────────────────────
type TestStatus = 'pass' | 'fail' | 'skip' | 'pending'

interface TestCase {
  name:     string
  suite:    string
  status:   TestStatus
  duration: number
  error?:   string
}

interface TestSuite {
  name:     string
  file?:    string
  status:   TestStatus
  tests:    TestCase[]
  duration: number
}

interface TestRunResult {
  framework: string
  passed:    number
  failed:    number
  skipped:   number
  total:     number
  duration:  number
  suites:    TestSuite[]
  rawOutput: string
}

interface DetectedFramework {
  framework: string
  command:   string
  label:     string
  icon:      string
}

interface Props {
  workspacePath: string | undefined
  onClose:       () => void
  onAutoFix:     (prompt: string) => void
}

// ── Strip ANSI escape codes ───────────────────────────────────────────────────
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
            .replace(/\x1B\[\?25[lh]/g, '')
            .replace(/\x1B\[[\d;]*[A-Za-z]/g, '')
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, size = 'md' }: { status: TestStatus; size?: 'sm' | 'md' }) {
  const cfg: Record<TestStatus, { icon: string; cls: string }> = {
    pass:    { icon: '✓', cls: 'text-green-600 dark:text-green-400' },
    fail:    { icon: '✗', cls: 'text-red-500 dark:text-red-400' },
    skip:    { icon: '○', cls: 'text-gray-400 dark:text-gray-600' },
    pending: { icon: '◌', cls: 'text-gray-400 dark:text-gray-600' },
  }
  const { icon, cls } = cfg[status]
  return (
    <span className={`font-bold flex-shrink-0 ${cls} ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
      {icon}
    </span>
  )
}

// ── Duration pill ─────────────────────────────────────────────────────────────
function DurationPill({ ms }: { ms: number }) {
  if (ms < 0) return null
  const label = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  return (
    <span className="text-[9px] text-gray-400 dark:text-gray-600 ml-1">{label}</span>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function SummaryBar({ result }: { result: TestRunResult }) {
  const total = result.total || 1
  const passPct = Math.round((result.passed / total) * 100)
  const failPct = Math.round((result.failed / total) * 100)
  const skipPct = 100 - passPct - failPct

  const allPass = result.failed === 0 && result.total > 0

  return (
    <div className={`px-4 py-3 border-b flex-shrink-0 ${
      allPass
        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
        : result.failed > 0
          ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3 text-sm font-semibold">
          {result.passed > 0 && (
            <span className="text-green-600 dark:text-green-400">
              ✓ {result.passed} passed
            </span>
          )}
          {result.failed > 0 && (
            <span className="text-red-500 dark:text-red-400">
              ✗ {result.failed} failed
            </span>
          )}
          {result.skipped > 0 && (
            <span className="text-gray-400 dark:text-gray-500">
              ○ {result.skipped} skipped
            </span>
          )}
          {result.total === 0 && (
            <span className="text-gray-400">No tests found</span>
          )}
        </div>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {result.duration > 0 ? (result.duration < 1000 ? `${result.duration}ms` : `${(result.duration / 1000).toFixed(1)}s`) : ''}
        </span>
      </div>
      {/* Progress bar */}
      {result.total > 0 && (
        <div className="flex h-1.5 rounded-full overflow-hidden gap-px bg-gray-200 dark:bg-gray-700">
          {passPct > 0 && <div className="bg-green-500 rounded-l-full" style={{ width: `${passPct}%` }} />}
          {failPct > 0 && <div className="bg-red-500" style={{ width: `${failPct}%` }} />}
          {skipPct > 0 && <div className="bg-gray-300 dark:bg-gray-600 rounded-r-full" style={{ width: `${skipPct}%` }} />}
        </div>
      )}
    </div>
  )
}

// ── Individual test case row ───────────────────────────────────────────────────
function TestCaseRow({ test, onAutoFix }: { test: TestCase; onAutoFix: (t: TestCase) => void }) {
  const [expanded, setExpanded] = useState(test.status === 'fail')

  return (
    <div className={`border-b border-gray-100 dark:border-gray-800/50 last:border-0 ${
      test.status === 'fail' ? 'bg-red-50/40 dark:bg-red-900/10' : ''
    }`}>
      <button
        onClick={() => test.error && setExpanded(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${
          test.error ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : 'cursor-default'
        } transition-colors`}
      >
        <StatusBadge status={test.status} size="sm" />
        <span className={`flex-1 text-[12px] truncate ${
          test.status === 'fail' ? 'text-red-700 dark:text-red-300 font-medium' :
          test.status === 'skip' ? 'text-gray-400 dark:text-gray-500 italic' :
          'text-gray-700 dark:text-gray-300'
        }`}>
          {test.name}
        </span>
        <DurationPill ms={test.duration} />
        {test.status === 'fail' && (
          <button
            onClick={(e) => { e.stopPropagation(); onAutoFix(test) }}
            className="ml-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors whitespace-nowrap flex-shrink-0"
            title="Send this failure to AI for auto-fix"
          >
            ✨ Auto-fix
          </button>
        )}
        {test.error && (
          <svg className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {expanded && test.error && (
        <div className="mx-3 mb-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2">
          <pre className="text-[11px] font-mono text-red-700 dark:text-red-300 whitespace-pre-wrap break-all leading-relaxed max-h-36 overflow-y-auto">
            {test.error}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Test suite section ────────────────────────────────────────────────────────
function TestSuiteSection({ suite, onAutoFix }: { suite: TestSuite; onAutoFix: (t: TestCase) => void }) {
  const [collapsed, setCollapsed] = useState(suite.status === 'pass' && suite.tests.length > 0)

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-0">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <StatusBadge status={suite.status} />
        <span className={`flex-1 text-xs font-semibold truncate ${
          suite.status === 'fail' ? 'text-red-600 dark:text-red-400' :
          'text-gray-700 dark:text-gray-200'
        }`}>
          {suite.file ?? suite.name}
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-600 flex-shrink-0">
          {suite.tests.filter(t => t.status === 'pass').length}/{suite.tests.length}
        </span>
        <DurationPill ms={suite.duration} />
        <svg className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && suite.tests.length > 0 && (
        <div className="ml-4">
          {suite.tests.map((test, i) => (
            <TestCaseRow key={i} test={test} onAutoFix={onAutoFix} />
          ))}
        </div>
      )}

      {!collapsed && suite.tests.length === 0 && (
        <p className="ml-8 px-2 py-1 text-[11px] text-gray-400 italic">No individual tests captured</p>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function TestRunnerPanel({ workspacePath, onClose, onAutoFix }: Props) {
  const [frameworks,       setFrameworks]       = useState<DetectedFramework[]>([])
  const [selectedFw,       setSelectedFw]       = useState<DetectedFramework | null>(null)
  const [customCmd,        setCustomCmd]        = useState('')
  const [useCustom,        setUseCustom]        = useState(false)
  const [running,          setRunning]          = useState(false)
  const [watchMode,        setWatchMode]        = useState(false)
  const [result,           setResult]           = useState<TestRunResult | null>(null)
  const [liveOutput,       setLiveOutput]       = useState('')
  const [showRaw,          setShowRaw]          = useState(false)
  const [lastWatchFile,    setLastWatchFile]    = useState('')
  const [activeTab,        setActiveTab]        = useState<'results' | 'output'>('results')

  const outputRef = useRef<HTMLDivElement>(null)
  const isElectron = typeof window !== 'undefined' && !!window.api

  // ── Detect frameworks on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!workspacePath || !isElectron) return
    window.api.testDetectFrameworks(workspacePath).then(fws => {
      setFrameworks(fws)
      if (fws.length > 0) setSelectedFw(fws[0])
    })
  }, [workspacePath])

  // ── IPC listeners ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return

    window.api.onTestChunk((chunk: string) => {
      setLiveOutput(prev => prev + stripAnsi(chunk))
      // Auto-scroll raw output
      setTimeout(() => {
        if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
      }, 0)
    })

    window.api.onTestDone((r: unknown) => {
      const result = r as TestRunResult
      setResult(result)
      setRunning(false)
      if (result.failed > 0 || result.total === 0) setActiveTab('results')
    })

    window.api.onTestWatchFired((file: string) => {
      setLastWatchFile(file)
      // Auto-rerun
      handleRun()
    })

    return () => {
      window.api.removeTestListeners()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFw, useCustom, customCmd, workspacePath])

  // ── Watch mode toggle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!workspacePath || !isElectron) return
    window.api.testWatchToggle(watchMode, workspacePath)
  }, [watchMode, workspacePath])

  // Cleanup watchers on unmount
  useEffect(() => {
    return () => {
      if (isElectron) {
        window.api.testWatchToggle(false, workspacePath ?? '')
        window.api.removeTestListeners()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRun = useCallback(() => {
    if (!workspacePath || !isElectron) return
    const cmd = useCustom ? customCmd : selectedFw?.command
    if (!cmd) return
    setRunning(true)
    setLiveOutput('')
    setResult(null)
    setActiveTab('output')
    window.api.testRun(cmd, workspacePath, selectedFw?.framework ?? 'unknown')
  }, [workspacePath, useCustom, customCmd, selectedFw])

  const handleStop = useCallback(() => {
    if (!isElectron) return
    window.api.testAbort()
    setRunning(false)
  }, [])

  const handleAutoFix = useCallback((test: TestCase) => {
    const prompt = [
      `Fix the failing test: **${test.name}**`,
      test.suite ? `Suite: ${test.suite}` : '',
      '',
      test.error ? `Error output:\n\`\`\`\n${test.error}\n\`\`\`` : '',
      '',
      'Please:',
      '1. Find the test file and the code being tested',
      '2. Understand why the test is failing',
      '3. Fix the implementation (not the test, unless the test is wrong)',
      '4. Re-run the test to verify it passes',
    ].filter(l => l !== undefined).join('\n')
    onAutoFix(prompt)
    onClose()
  }, [onAutoFix, onClose])

  const handleAutoFixAll = useCallback(() => {
    if (!result) return
    const failedTests = result.suites.flatMap(s => s.tests.filter(t => t.status === 'fail'))
    if (failedTests.length === 0) return

    const errors = failedTests.slice(0, 5).map(t =>
      `**${t.name}** (suite: ${t.suite})\n${t.error ? '```\n' + t.error + '\n```' : 'No error details'}`
    ).join('\n\n')

    const prompt = [
      `Fix ${failedTests.length} failing test${failedTests.length > 1 ? 's' : ''}:`,
      '',
      errors,
      '',
      'For each failing test:',
      '1. Find the source code being tested',
      '2. Understand why it fails',
      '3. Fix the implementation',
      '4. Run tests again to verify',
    ].join('\n')
    onAutoFix(prompt)
    onClose()
  }, [result, onAutoFix, onClose])

  const noWorkspace = !workspacePath

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">🧪</span>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Test Runner</h2>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {frameworks.length > 0
                  ? `${frameworks.map(f => f.icon + ' ' + f.label).join(' · ')} detected`
                  : 'No test framework detected'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Watch mode toggle */}
            <button
              onClick={() => setWatchMode(v => !v)}
              disabled={noWorkspace || running}
              title={watchMode ? 'Stop watch mode' : 'Enable watch mode — auto-reruns on file save'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                watchMode
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:text-blue-600 dark:hover:text-blue-400'
              } disabled:opacity-50`}
            >
              <svg className={`w-3.5 h-3.5 ${watchMode ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {watchMode ? 'Watching' : 'Watch'}
            </button>

            {/* Playwright report button (if playwright detected) */}
            {frameworks.some(f => f.framework === 'playwright') && (
              <button
                onClick={() => workspacePath && window.api.playwrightOpenReport(workspacePath)}
                title="Open Playwright HTML report in browser"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-700 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
              >
                🎭 Report
              </button>
            )}

            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 flex-wrap">
          {/* Framework selector */}
          {!useCustom && frameworks.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {frameworks.map(fw => (
                <button
                  key={fw.framework}
                  onClick={() => setSelectedFw(fw)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    selectedFw?.framework === fw.framework
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400'
                  }`}
                >
                  <span>{fw.icon}</span>
                  <span>{fw.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Custom command toggle */}
          <button
            onClick={() => setUseCustom(v => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-colors ${
              useCustom
                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-700'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border border-dashed border-gray-300 dark:border-gray-700'
            }`}
          >
            ⌨️ Custom
          </button>

          {useCustom && (
            <input
              type="text"
              value={customCmd}
              onChange={e => setCustomCmd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRun()}
              placeholder="e.g. npx jest --testPathPattern=auth"
              className="flex-1 min-w-0 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-orange-400 font-mono"
            />
          )}

          {!useCustom && selectedFw && (
            <code className="text-[10px] font-mono text-gray-400 dark:text-gray-600 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
              {selectedFw.command}
            </code>
          )}

          <div className="ml-auto flex items-center gap-2">
            {running ? (
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </button>
            ) : (
              <button
                onClick={handleRun}
                disabled={noWorkspace || (!selectedFw && !customCmd.trim())}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                </svg>
                Run Tests
              </button>
            )}
          </div>
        </div>

        {/* ── Watch fired notification ──────────────────────────────────────── */}
        {watchMode && lastWatchFile && (
          <div className="px-4 py-1.5 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 flex-shrink-0">
            <p className="text-[11px] text-blue-600 dark:text-blue-400">
              🔄 File changed: <code className="font-mono">{lastWatchFile}</code> — rerunning…
            </p>
          </div>
        )}

        {/* ── Running indicator ─────────────────────────────────────────────── */}
        {running && (
          <div className="px-4 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-700 flex-shrink-0 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 animate-spin text-yellow-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-[11px] text-yellow-700 dark:text-yellow-400 font-medium">
              Running {selectedFw?.icon} {useCustom ? 'custom command' : selectedFw?.label}…
            </span>
          </div>
        )}

        {/* ── Results summary ───────────────────────────────────────────────── */}
        {result && <SummaryBar result={result} />}

        {/* ── Auto-fix all button (when failures exist) ─────────────────────── */}
        {result && result.failed > 0 && (
          <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex items-center justify-between bg-red-50 dark:bg-red-900/10">
            <p className="text-xs text-red-600 dark:text-red-400">
              {result.failed} test{result.failed > 1 ? 's' : ''} failed
            </p>
            <button
              onClick={handleAutoFixAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
            >
              ✨ Auto-fix all {result.failed} failures
            </button>
          </div>
        )}

        {/* ── Tab bar ───────────────────────────────────────────────────────── */}
        {(result || liveOutput) && (
          <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            {['results', 'output'].map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t as 'results' | 'output')}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors capitalize ${
                  activeTab === t
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {t === 'results' ? `Results ${result ? `(${result.total})` : ''}` : 'Live Output'}
              </button>
            ))}
          </div>
        )}

        {/* ── Content area ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden">

          {/* No workspace */}
          {noWorkspace && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
              <span className="text-4xl opacity-30">🧪</span>
              <p className="text-sm">Set a workspace folder to run tests.</p>
            </div>
          )}

          {/* No framework detected */}
          {!noWorkspace && frameworks.length === 0 && !running && !result && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 px-8 text-center">
              <span className="text-4xl opacity-30">🔍</span>
              <p className="text-sm font-medium">No test framework detected</p>
              <p className="text-xs text-gray-400 dark:text-gray-600">
                Add a test framework (Jest, pytest, cargo test, etc.) or use the custom command field above.
              </p>
            </div>
          )}

          {/* Results tab */}
          {activeTab === 'results' && result && (
            <div className="h-full overflow-y-auto">
              {result.suites.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
                  <p className="text-sm">No individual test results parsed.</p>
                  <button
                    onClick={() => setActiveTab('output')}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    View raw output →
                  </button>
                </div>
              ) : (
                result.suites.map((suite, i) => (
                  <TestSuiteSection key={i} suite={suite} onAutoFix={handleAutoFix} />
                ))
              )}
            </div>
          )}

          {/* Live output tab */}
          {activeTab === 'output' && (
            <div
              ref={outputRef}
              className="h-full overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-gray-700 dark:text-gray-300 bg-gray-950 whitespace-pre-wrap"
            >
              {liveOutput || (running ? (
                <span className="text-gray-500">Waiting for output…</span>
              ) : (
                <span className="text-gray-600">No output yet. Run tests to see output here.</span>
              ))}
            </div>
          )}

          {/* Initial idle state */}
          {!running && !result && !liveOutput && !noWorkspace && frameworks.length > 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400">
              <span className="text-5xl opacity-20">▶</span>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Ready to run</p>
                <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
                  Press <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] font-mono border border-gray-200 dark:border-gray-700">Run Tests</kbd> to start
                  {watchMode && ' · Watch mode active'}
                </p>
              </div>
              {watchMode && (
                <p className="text-[11px] text-blue-500 dark:text-blue-400 text-center">
                  🔄 Watching for file changes — tests will rerun automatically
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
