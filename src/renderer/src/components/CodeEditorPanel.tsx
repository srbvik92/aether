/**
 * CodeEditorPanel — Monaco-powered code editor embedded in the AI chat app.
 *
 * • File tree on the left (built from workspace file listing)
 * • Monaco editor in the centre (full language support, dark/light theme)
 * • Multi-file tabs with unsaved-changes indicator
 * • Ctrl+S / ⌘S to save
 * • "Ask AI" — sends file context straight to the chat
 * • New file / delete file / refresh tree
 * • Integrated terminal panel at the bottom (toggle with toolbar button)
 */

import '../utils/monacoSetup'        // workers must be wired before Editor renders

import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import React from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type * as MonacoTypes from 'monaco-editor'
import type { AppSettings } from '../../../shared/types'

const TerminalPanel = lazy(() => import('./TerminalPanel'))

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  workspacePath: string | undefined
  theme: 'dark' | 'light' | 'system'
  settings: AppSettings
  onClose: () => void
  /** Called when user clicks "Ask AI about this file/selection" */
  onAskAI: (prompt: string) => void
}

// ── File tree types ───────────────────────────────────────────────────────────
interface FileLeaf { type: 'file'; name: string; path: string }
interface FileDir  { type: 'dir';  name: string; path: string; children: FileNode[] }
type FileNode = FileLeaf | FileDir

// ── Open-file tab ─────────────────────────────────────────────────────────────
interface OpenFile {
  path:         string   // relative to workspace
  content:      string   // current (possibly dirty)
  savedContent: string   // last saved content
  language:     string
}

// ── Language map (extension → Monaco language id) ────────────────────────────
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', swift: 'swift', cs: 'csharp',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
  php: 'php',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', html: 'html', css: 'css', scss: 'scss', sass: 'scss',
  sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  md: 'markdown', mdx: 'markdown', txt: 'plaintext',
  env: 'shell', graphql: 'graphql', proto: 'protobuf',
  prisma: 'plaintext', lock: 'plaintext',
}

function getLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext] ?? 'plaintext'
}

// ── File icon ─────────────────────────────────────────────────────────────────
function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['ts','tsx'].includes(ext)) return '🔷'
  if (['js','jsx','mjs','cjs'].includes(ext)) return '🟨'
  if (ext === 'py') return '🐍'
  if (ext === 'rs') return '🦀'
  if (ext === 'go') return '🐹'
  if (['html','htm'].includes(ext)) return '🌐'
  if (['css','scss','sass'].includes(ext)) return '🎨'
  if (['json','yaml','yml','toml'].includes(ext)) return '⚙️'
  if (['md','mdx'].includes(ext)) return '📝'
  if (['sh','bash','zsh','fish'].includes(ext)) return '💻'
  if (ext === 'sql') return '🗃️'
  if (['png','jpg','jpeg','gif','svg','webp'].includes(ext)) return '🖼️'
  return '📄'
}

// ── Build tree from flat paths ────────────────────────────────────────────────
function buildTree(paths: string[]): FileNode[] {
  const root: FileDir = { type: 'dir', name: '', path: '', children: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const nodePath = parts.slice(0, i + 1).join('/')
      const isFile = i === parts.length - 1
      if (isFile) {
        if (!node.children.find(c => c.path === nodePath)) {
          node.children.push({ type: 'file', name: part, path: nodePath })
        }
      } else {
        let dir = node.children.find(c => c.path === nodePath) as FileDir | undefined
        if (!dir) {
          dir = { type: 'dir', name: part, path: nodePath, children: [] }
          node.children.push(dir)
        }
        node = dir
      }
    }
  }
  // Sort: dirs first, then files, each alphabetically
  function sortNodes(nodes: FileNode[]): FileNode[] {
    return nodes
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map(n => n.type === 'dir' ? { ...n, children: sortNodes(n.children) } : n)
  }
  return sortNodes(root.children)
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  )
}

// ── Context menu helpers ───────────────────────────────────────────────────────
function CtxItem({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
        danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      <span className="text-[13px] leading-none w-4 text-center flex-shrink-0">{icon}</span>
      {label}
    </button>
  )
}
function CtxSep() {
  return <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CodeEditorPanel({ workspacePath, theme, settings, onClose, onAskAI }: Props) {

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(() =>
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : theme === 'dark'
  )
  useEffect(() => {
    if (theme !== 'system') { setIsDark(theme === 'dark'); return }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setIsDark(mq.matches)
    const h = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [theme])
  // Also watch DOM class for instant sync when user toggles theme in the app
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark'))
    )
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // ── File tree state ────────────────────────────────────────────────────────
  const [allFiles,       setAllFiles]       = useState<string[]>([])
  const [treeLoading,    setTreeLoading]    = useState(false)
  const [expandedDirs,   setExpandedDirs]   = useState<Set<string>>(new Set())
  const [treeOpen,       setTreeOpen]       = useState(true)
  const [treeWidth,      setTreeWidth]      = useState(208)   // px, only used when expanded
  const [treeCollapsed,  setTreeCollapsed]  = useState(false) // icon-strip mode
  const treeResizing     = useRef(false)
  const bodyRef          = useRef<HTMLDivElement>(null)

  // ── Tree drag-to-resize ────────────────────────────────────────────────────
  const startTreeResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    treeResizing.current = true
    const startX = e.clientX
    const startW = treeWidth
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(120, Math.min(480, startW + (ev.clientX - startX)))
      setTreeWidth(newW)
      // Auto-expand if user drags out from collapsed state
      if (treeCollapsed) setTreeCollapsed(false)
    }
    const onUp = () => {
      treeResizing.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [treeWidth, treeCollapsed])

  // ── Open files / tabs ──────────────────────────────────────────────────────
  const [openFiles,   setOpenFiles]   = useState<OpenFile[]>([])
  const [activePath,  setActivePath]  = useState<string | null>(null)
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [saveMsg,     setSaveMsg]     = useState<string | null>(null)

  // ── Session persistence ────────────────────────────────────────────────────
  // Key per workspace so different projects have independent tab sessions.
  const isRestoringSession = useRef(false)
  const saveSessionTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore when workspace changes (or on first mount)
  useEffect(() => {
    // Clear tabs immediately when workspace is empty or changes
    setOpenFiles([])
    setActivePath(null)
    if (!workspacePath) return

    const key = `editor-session:${workspacePath}`
    const raw = localStorage.getItem(key)
    if (!raw) return

    let session: { openPaths?: string[]; activePath?: string | null; expandedDirs?: string[]; treeWidth?: number; treeCollapsed?: boolean }
    try { session = JSON.parse(raw) } catch { return }

    isRestoringSession.current = true

    // Restore tree UI preferences immediately (no async needed)
    if (Array.isArray(session.expandedDirs)) setExpandedDirs(new Set(session.expandedDirs))
    if (typeof session.treeWidth    === 'number')  setTreeWidth(session.treeWidth)
    if (typeof session.treeCollapsed === 'boolean') setTreeCollapsed(session.treeCollapsed)

    // Reload file contents from disk
    const paths = Array.isArray(session.openPaths) ? session.openPaths : []
    if (!paths.length) { isRestoringSession.current = false; return }

    Promise.all(
      paths.map(p =>
        window.api.readWorkspaceFile(workspacePath, p)
          .then(res => res.error ? null : { path: p, content: res.content, savedContent: res.content, language: getLang(p) } as OpenFile)
          .catch(() => null)
      )
    ).then(loaded => {
      const valid = loaded.filter(Boolean) as OpenFile[]
      if (!valid.length) { isRestoringSession.current = false; return }
      setOpenFiles(valid)
      // Restore active tab if it still exists, otherwise use first
      const wantActive = session.activePath
      setActivePath(wantActive && valid.some(f => f.path === wantActive) ? wantActive : valid[0].path)
      // Re-enable saves after React has flushed the state updates
      setTimeout(() => { isRestoringSession.current = false }, 50)
    }).catch(() => { isRestoringSession.current = false })
  }, [workspacePath]) // intentionally omits other deps — only re-run on workspace change

  // Save session debounced whenever tabs/tree state changes
  useEffect(() => {
    if (!workspacePath || isRestoringSession.current) return
    if (saveSessionTimer.current) clearTimeout(saveSessionTimer.current)
    saveSessionTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(`editor-session:${workspacePath}`, JSON.stringify({
          openPaths:    openFiles.map(f => f.path),
          activePath,
          expandedDirs: [...expandedDirs],
          treeWidth,
          treeCollapsed,
        }))
      } catch { /* quota exceeded — ignore */ }
    }, 400)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, openFiles, activePath, expandedDirs, treeWidth, treeCollapsed])

  // ── New-file / new-folder inline input ────────────────────────────────────
  const [showNewFile,  setShowNewFile]  = useState(false)
  const [newFilePath,  setNewFilePath]  = useState('')
  const newFileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (showNewFile) newFileInputRef.current?.focus() }, [showNewFile])

  // ── Rename inline input ────────────────────────────────────────────────────
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue,  setRenameValue]  = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (renamingPath) { renameInputRef.current?.focus(); renameInputRef.current?.select() } }, [renamingPath])

  // ── Context menu ──────────────────────────────────────────────────────────
  type CtxTarget = { kind: 'file'; path: string } | { kind: 'dir'; path: string } | { kind: 'blank' }
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: CtxTarget } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape
  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ctxMenuRef.current?.contains(e.target as Node)) return
      setCtxMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown',   close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [ctxMenu])

  // ── Editor refs + AI features state ───────────────────────────────────────
  const editorRef              = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef              = useRef<typeof MonacoTypes | null>(null)
  const onAskAIRef             = useRef(onAskAI)
  const activePathRef          = useRef(activePath)
  const settingsRef            = useRef(settings)
  const completionsEnabledRef  = useRef(false)
  const editorDisposablesRef   = useRef<Array<{ dispose(): void }>>([])
  const completionProviderRef  = useRef<{ dispose(): void } | null>(null)

  const [completionsEnabled, setCompletionsEnabled] = useState(false)
  const [errorCount,         setErrorCount]         = useState(0)
  const [warnCount,          setWarnCount]          = useState(0)

  // Keep refs in sync with props/state
  useEffect(() => { onAskAIRef.current          = onAskAI },          [onAskAI])
  useEffect(() => { activePathRef.current       = activePath },       [activePath])
  useEffect(() => { settingsRef.current         = settings },         [settings])
  useEffect(() => { completionsEnabledRef.current = completionsEnabled }, [completionsEnabled])

  // Inject error-lens CSS once
  useEffect(() => {
    const id = 'chatui-error-lens-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      .error-lens-err  { color: #f87171 !important; opacity: 0.75; margin-left: 2ch; font-style: italic; pointer-events: none; }
      .error-lens-warn { color: #fbbf24 !important; opacity: 0.75; margin-left: 2ch; font-style: italic; pointer-events: none; }
    `
    document.head.appendChild(style)
  }, [])

  // Clean up all Monaco disposables on unmount
  useEffect(() => () => {
    editorDisposablesRef.current.forEach(d => d.dispose())
    completionProviderRef.current?.dispose()
  }, [])

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current   = editor
    monacoRef.current   = monaco as unknown as typeof MonacoTypes

    const disposables: Array<{ dispose(): void }> = []

    // ── Error lens decorations ──────────────────────────────────────────────
    const errorDecos = editor.createDecorationsCollection([])

    const refreshDecos = () => {
      const model = editor.getModel()
      if (!model) { errorDecos.set([]); setErrorCount(0); setWarnCount(0); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markers: MonacoTypes.editor.IMarker[] = (monaco as any).editor.getModelMarkers({ resource: model.uri })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Sev = (monaco as any).MarkerSeverity
      const errors = markers.filter((m: MonacoTypes.editor.IMarker) => m.severity === Sev.Error)
      const warns  = markers.filter((m: MonacoTypes.editor.IMarker) => m.severity === Sev.Warning)
      setErrorCount(errors.length)
      setWarnCount(warns.length)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      errorDecos.set([...errors, ...warns].map((m: MonacoTypes.editor.IMarker) => ({
        range: new (monaco as any).Range(
          m.startLineNumber, Number.MAX_SAFE_INTEGER,
          m.startLineNumber, Number.MAX_SAFE_INTEGER
        ),
        options: {
          after: {
            content: `   ${m.message.split('\n')[0].slice(0, 90)}`,
            inlineClassName: m.severity === Sev.Error ? 'error-lens-err' : 'error-lens-warn',
          }
        }
      })))
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    disposables.push((monaco as any).editor.onDidChangeMarkers(() => refreshDecos()))
    disposables.push(editor.onDidChangeModel(() => {
      errorDecos.set([])
      setErrorCount(0); setWarnCount(0)
      setTimeout(refreshDecos, 400)
    }))

    // ── "Fix with AI" right-click action ────────────────────────────────────
    editor.addAction({
      id:   'chatui.fixWithAI',
      label: '✨ Fix with AI',
      contextMenuGroupId: '1_modification',
      contextMenuOrder:   0.9,
      run: (ed) => {
        const pos   = ed.getPosition()
        const model = ed.getModel()
        if (!pos || !model) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: MonacoTypes.editor.IMarker[] = (monaco as any).editor.getModelMarkers({ resource: model.uri })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Sev2 = (monaco as any).MarkerSeverity
        const lineErrors = markers.filter((m: MonacoTypes.editor.IMarker) =>
          m.startLineNumber <= pos.lineNumber && m.endLineNumber >= pos.lineNumber &&
          m.severity >= Sev2.Warning
        )
        const file = activePathRef.current ?? 'this file'
        if (lineErrors.length) {
          const msgs = lineErrors.map((m: MonacoTypes.editor.IMarker) => `- Line ${m.startLineNumber}: ${m.message}`).join('\n')
          const line = model.getLineContent(pos.lineNumber)
          onAskAIRef.current(
            `Fix the following error in \`${file}\`:\n\n**Errors:**\n${msgs}\n\n` +
            `**Line ${pos.lineNumber}:** \`${line.trim()}\`\n\nPlease show the corrected code.`
          )
        } else {
          // No errors on current line — send all file errors
          const allErrors = markers.filter((m: MonacoTypes.editor.IMarker) => m.severity === Sev2.Error)
          if (!allErrors.length) return
          const errorList = allErrors.map((m: MonacoTypes.editor.IMarker) => `- Line ${m.startLineNumber}: ${m.message}`).join('\n')
          onAskAIRef.current(
            `Fix all TypeScript/lint errors in \`${file}\`:\n\n${errorList}\n\n` +
            `\`\`\`${model.getLanguageId()}\n${model.getValue().slice(0, 8000)}\n\`\`\``
          )
        }
      }
    })

    // ── Inline completions (registered once per panel lifetime) ─────────────
    if (!completionProviderRef.current && window.api?.completionRequest) {
      completionProviderRef.current = (monaco as any).languages.registerInlineCompletionsProvider('*', {
        provideInlineCompletions: async (
          model: MonacoTypes.editor.ITextModel,
          position: MonacoTypes.Position,
          _ctx: unknown,
          token: MonacoTypes.CancellationToken
        ) => {
          if (!completionsEnabledRef.current) return { items: [] }

          const prefix = model.getValueInRange({
            startLineNumber: 1, startColumn: 1,
            endLineNumber: position.lineNumber, endColumn: position.column
          })
          if (prefix.trim().length < 8) return { items: [] }

          // 600 ms debounce
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 600)
            token.onCancellationRequested(() => { clearTimeout(t); reject(new Error('cancelled')) })
          }).catch(() => null)
          if (token.isCancellationRequested) return { items: [] }

          const lc = model.getLineCount()
          const suffix = model.getValueInRange({
            startLineNumber: position.lineNumber, startColumn: position.column,
            endLineNumber:   lc, endColumn: model.getLineMaxColumn(lc)
          })

          try {
            const result = await window.api.completionRequest({
              prefix, suffix,
              language: model.getLanguageId(),
              settings: settingsRef.current
            })
            if (!result.ok || !result.text.trim()) return { items: [] }
            return {
              items: [{
                insertText: result.text,
                range: {
                  startLineNumber: position.lineNumber, startColumn: position.column,
                  endLineNumber:   position.lineNumber, endColumn: position.column
                }
              }]
            }
          } catch { return { items: [] } }
        },
        freeInlineCompletions: () => {}
      })
    }

    // Dispose old per-editor disposables; store new ones
    editorDisposablesRef.current.forEach(d => d.dispose())
    editorDisposablesRef.current = disposables
  }

  // ── Terminal panel ─────────────────────────────────────────────────────────
  const [terminalOpen,   setTerminalOpen]   = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(220)

  const activeFile = openFiles.find(f => f.path === activePath) ?? null

  // ── Load file tree ─────────────────────────────────────────────────────────
  const refreshTree = useCallback(async () => {
    if (!workspacePath) { setAllFiles([]); return }
    setTreeLoading(true)
    try {
      const files = await window.api.listWorkspaceFiles(workspacePath)
      setAllFiles(files)
    } finally {
      setTreeLoading(false)
    }
  }, [workspacePath])

  useEffect(() => { refreshTree() }, [refreshTree])

  const fileTree = useMemo(() => buildTree(allFiles), [allFiles])

  // ── Open a file ────────────────────────────────────────────────────────────
  const openFile = useCallback(async (relPath: string) => {
    // If already open, just switch
    const existing = openFiles.find(f => f.path === relPath)
    if (existing) { setActivePath(relPath); return }
    if (!workspacePath) return
    setLoadingPath(relPath)
    try {
      const res = await window.api.readWorkspaceFile(workspacePath, relPath)
      if (res.error) { console.error('Read error:', res.error); return }
      const file: OpenFile = {
        path: relPath,
        content: res.content,
        savedContent: res.content,
        language: getLang(relPath),
      }
      setOpenFiles(prev => [...prev, file])
      setActivePath(relPath)
    } finally {
      setLoadingPath(null)
    }
  }, [workspacePath, openFiles])

  // ── Close a tab ────────────────────────────────────────────────────────────
  const closeTab = useCallback((path: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setOpenFiles(prev => {
      const idx = prev.findIndex(f => f.path === path)
      const next = prev.filter(f => f.path !== path)
      if (activePath === path) {
        setActivePath(next[Math.min(idx, next.length - 1)]?.path ?? null)
      }
      return next
    })
  }, [activePath])

  // ── Edit content ───────────────────────────────────────────────────────────
  const handleChange = useCallback((value: string | undefined) => {
    if (activePath === null || value === undefined) return
    setOpenFiles(prev => prev.map(f =>
      f.path === activePath ? { ...f, content: value } : f
    ))
  }, [activePath])

  // ── Save file ──────────────────────────────────────────────────────────────
  const saveFile = useCallback(async (path?: string) => {
    const target = path ?? activePath
    if (!target || !workspacePath) return
    const file = openFiles.find(f => f.path === target)
    if (!file) return
    const res = await window.api.writeWorkspaceFile(workspacePath, target, file.content)
    if (res.ok) {
      setOpenFiles(prev => prev.map(f =>
        f.path === target ? { ...f, savedContent: f.content } : f
      ))
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(null), 1500)
    } else {
      setSaveMsg(`Error: ${res.error ?? 'unknown'}`)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }, [activePath, workspacePath, openFiles])

  // ── Ctrl+S / Ctrl+` keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveFile()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        setTerminalOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile])

  // ── Create new file ────────────────────────────────────────────────────────
  const createFile = useCallback(async () => {
    const p = newFilePath.trim().replace(/\\/g, '/')
    if (!p || !workspacePath) return
    const res = await window.api.writeWorkspaceFile(workspacePath, p, '')
    if (res.ok) {
      await refreshTree()
      setShowNewFile(false)
      setNewFilePath('')
      openFile(p)
    }
  }, [newFilePath, workspacePath, refreshTree, openFile])

  // ── Delete a file or folder ────────────────────────────────────────────────
  const deleteFile = useCallback(async (relPath: string) => {
    if (!workspacePath) return
    if (!confirm(`Delete "${relPath}"?\nThis cannot be undone.`)) return
    const res = await window.api.deleteWorkspaceFile(workspacePath, relPath)
    if (res.ok) {
      closeTab(relPath)
      await refreshTree()
    } else {
      alert(`Delete failed: ${res.error}`)
    }
  }, [workspacePath, closeTab, refreshTree])

  // ── Rename a file or folder ────────────────────────────────────────────────
  const commitRename = useCallback(async () => {
    if (!renamingPath || !workspacePath) return
    const newName = renameValue.trim()
    if (!newName || newName === renamingPath.split('/').pop()) { setRenamingPath(null); return }
    const dir = renamingPath.includes('/') ? renamingPath.split('/').slice(0, -1).join('/') + '/' : ''
    const newRelPath = dir + newName
    const res = await window.api.renameWorkspaceFile(workspacePath, renamingPath, newRelPath)
    if (res.ok) {
      // Update open tab if renamed file is open
      setOpenFiles(prev => prev.map(f =>
        f.path === renamingPath ? { ...f, path: newRelPath } : f
      ))
      if (activePath === renamingPath) setActivePath(newRelPath)
      await refreshTree()
    } else {
      alert(`Rename failed: ${res.error}`)
    }
    setRenamingPath(null)
  }, [renamingPath, renameValue, workspacePath, activePath, refreshTree])

  // ── Duplicate a file ────────────────────────────────────────────────────────
  const duplicateFile = useCallback(async (relPath: string) => {
    if (!workspacePath) return
    const res = await window.api.readWorkspaceFile(workspacePath, relPath)
    if (res.error) { alert(`Read failed: ${res.error}`); return }
    const ext = relPath.includes('.') ? '.' + relPath.split('.').pop() : ''
    const base = relPath.slice(0, relPath.length - ext.length)
    const newPath = base + '_copy' + ext
    const wr = await window.api.writeWorkspaceFile(workspacePath, newPath, res.content)
    if (wr.ok) { await refreshTree(); openFile(newPath) }
    else alert(`Duplicate failed: ${wr.error}`)
  }, [workspacePath, refreshTree, openFile])

  // ── Create new folder ──────────────────────────────────────────────────────
  const createFolder = useCallback(async (parentDir: string) => {
    const name = prompt('New folder name:', 'new-folder')?.trim()
    if (!name || !workspacePath) return
    const relPath = parentDir ? `${parentDir}/${name}` : name
    const res = await window.api.newWorkspaceFolder(workspacePath, relPath)
    if (res.ok) await refreshTree()
    else alert(`Create folder failed: ${res.error}`)
  }, [workspacePath, refreshTree])

  // ── Context menu open ──────────────────────────────────────────────────────
  const openCtxMenu = (e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, target })
  }

  // ── Ask AI about current file ─────────────────────────────────────────────
  const askAI = useCallback(() => {
    if (!activeFile) return
    const selection = editorRef.current?.getModel()?.getValueInRange(
      editorRef.current.getSelection()!
    )
    const code = selection?.trim() || activeFile.content
    const label = selection?.trim() ? 'selected code' : `\`${activeFile.path}\``
    onAskAI(
      `I have ${label} open in the editor:\n\n` +
      `\`\`\`${activeFile.language}\n${code.slice(0, 8000)}\n\`\`\`\n\n`
    )
  }, [activeFile, onAskAI])

  // ── Toggle folder ──────────────────────────────────────────────────────────
  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  // ── Render file tree node ─────────────────────────────────────────────────
  const renderNode = (node: FileNode, depth = 0): React.ReactNode => {
    const indent = depth * 12
    const isRenaming = renamingPath === node.path

    if (node.type === 'dir') {
      const open = expandedDirs.has(node.path)
      return (
        <div key={node.path}>
          {isRenaming ? (
            <div className="flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: 8 + indent }}>
              <span className="text-[11px]">📁</span>
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingPath(null) }}
                onBlur={commitRename}
                className="flex-1 text-xs px-1 py-0 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none"
              />
            </div>
          ) : (
            <button
              onClick={() => toggleDir(node.path)}
              onContextMenu={e => openCtxMenu(e, { kind: 'dir', path: node.path })}
              className="w-full flex items-center gap-1 px-2 py-0.5 text-left text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors group"
              style={{ paddingLeft: 8 + indent }}
            >
              <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-[11px]">{open ? '📂' : '📁'}</span>
              <span className="truncate font-medium">{node.name}</span>
            </button>
          )}
          {open && node.children.map(child => renderNode(child, depth + 1))}
        </div>
      )
    }

    // File
    const isActive = activePath === node.path
    const isLoading = loadingPath === node.path
    const openFile_ = openFiles.find(f => f.path === node.path)
    const isDirty = openFile_ ? openFile_.content !== openFile_.savedContent : false
    return (
      <div key={node.path}
        className={`group flex items-center gap-1 px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
          isActive
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        style={{ paddingLeft: 8 + indent }}
        onClick={() => !isRenaming && openFile(node.path)}
        onContextMenu={e => openCtxMenu(e, { kind: 'file', path: node.path })}
      >
        {isRenaming ? (
          <>
            <span className="text-[11px] flex-shrink-0">{fileIcon(node.name)}</span>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingPath(null) }}
              onBlur={commitRename}
              onClick={e => e.stopPropagation()}
              className="flex-1 text-xs px-1 py-0 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none"
            />
          </>
        ) : (
          <>
            {isLoading
              ? <Spinner className="w-3 h-3 flex-shrink-0" />
              : <span className="text-[11px] flex-shrink-0">{fileIcon(node.name)}</span>
            }
            <span className="truncate flex-1">{node.name}</span>
            {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Unsaved" />}
            <button
              onClick={e => { e.stopPropagation(); deleteFile(node.path) }}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 transition-all w-3.5 h-3.5 flex items-center justify-center flex-shrink-0"
              title="Delete file"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </>
        )}
      </div>
    )
  }

  const hasDirty = openFiles.some(f => f.content !== f.savedContent)

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden select-none">

      {/* ── Row 1: drag handle (matches the native titlebar overlay height — keep interactive controls out of here) ── */}
      <div
        className="h-9 flex items-center px-3 bg-gray-50 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-700 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 truncate select-none pointer-events-none">
          {workspacePath ? workspacePath.split(/[/\\]/).pop() : 'No workspace'}
        </span>
      </div>

      {/* ── Row 2: toolbar (safe below the native window controls) ── */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/80 flex-shrink-0">
        {/* Toggle tree */}
        <button
          onClick={() => {
            if (!treeOpen) { setTreeOpen(true); setTreeCollapsed(false) }
            else if (!treeCollapsed) setTreeCollapsed(true)
            else setTreeOpen(false)
          }}
          title={!treeOpen ? 'Show explorer' : treeCollapsed ? 'Expand explorer' : 'Collapse explorer'}
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
            treeOpen && !treeCollapsed
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
              : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>

        <span className="flex-1" />

        {/* Save status */}
        {saveMsg && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            saveMsg.startsWith('Error')
              ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          }`}>
            {saveMsg}
          </span>
        )}

        {/* Unsaved indicator */}
        {hasDirty && !saveMsg && (
          <span className="text-[10px] text-amber-500 px-1">●</span>
        )}

        {/* Error / warning badge */}
        {activeFile && (errorCount > 0 || warnCount > 0) && (
          <button
            onClick={() => {
              if (errorCount > 0) {
                const model = editorRef.current?.getModel()
                const monaco = monacoRef.current
                if (!model || !monaco) return
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const markers: MonacoTypes.editor.IMarker[] = (monaco as any).editor.getModelMarkers({ resource: model.uri })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const errs = markers.filter((m: MonacoTypes.editor.IMarker) => m.severity === (monaco as any).MarkerSeverity.Error)
                const file = activePath ?? 'this file'
                const list = errs.map((m: MonacoTypes.editor.IMarker) => `- Line ${m.startLineNumber}: ${m.message}`).join('\n')
                onAskAI(`Fix all TypeScript/lint errors in \`${file}\`:\n\n${list}\n\n\`\`\`${activeFile.language}\n${activeFile.content.slice(0, 8000)}\n\`\`\``)
              }
            }}
            title={`${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warnCount} warning${warnCount !== 1 ? 's' : ''} — click to fix with AI`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors hover:opacity-80"
          >
            {errorCount > 0 && (
              <span className="flex items-center gap-0.5 text-red-500">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 8v4m0 4h.01"/></svg>
                {errorCount}
              </span>
            )}
            {warnCount > 0 && (
              <span className="flex items-center gap-0.5 text-amber-500">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                {warnCount}
              </span>
            )}
          </button>
        )}

        {/* Inline completions toggle */}
        <button
          onClick={() => setCompletionsEnabled(v => !v)}
          title={completionsEnabled ? 'AI completions ON — click to disable' : 'AI completions OFF — click to enable'}
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors text-[10px] font-bold ${
            completionsEnabled
              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 border border-purple-300 dark:border-purple-700'
              : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          AI
        </button>

        {/* Ask AI */}
        {activeFile && (
          <button
            onClick={askAI}
            title="Ask AI about this file (or selected code)"
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Ask AI
          </button>
        )}

        {/* Save button */}
        {activeFile && (
          <button
            onClick={() => saveFile()}
            title="Save file (Ctrl+S)"
            disabled={activeFile.content === activeFile.savedContent}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 disabled:opacity-40 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2m4-5l5 5 5-5m-5 5V3" />
            </svg>
            Save
          </button>
        )}

        {/* Refresh tree */}
        <button
          onClick={refreshTree}
          title="Refresh file tree"
          className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          {treeLoading
            ? <Spinner className="w-3.5 h-3.5" />
            : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            )
          }
        </button>

        {/* Terminal toggle */}
        <button
          onClick={() => setTerminalOpen(v => !v)}
          title={terminalOpen ? 'Hide terminal' : 'Show integrated terminal (Ctrl+`)'}
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
            terminalOpen
              ? 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40'
              : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>

        {/* Separator */}
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />

        {/* Close panel */}
        <button
          onClick={onClose}
          title="Close editor"
          className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Body: tree + drag handle + editor ── */}
      <div ref={bodyRef} className="flex flex-1 overflow-hidden min-h-0">

        {/* ── File Tree ── */}
        {treeOpen && (
          treeCollapsed ? (
            /* ── Collapsed icon strip ── */
            <div className="flex flex-col items-center border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/70 overflow-y-auto py-1 gap-0.5 flex-shrink-0"
              style={{ width: 32 }}>
              {/* Expand button at top */}
              <button
                onClick={() => setTreeCollapsed(false)}
                title="Expand explorer"
                className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors mb-1 flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {/* File icons */}
              {allFiles.slice(0, 40).map(p => {
                const name = p.split('/').pop() ?? p
                const isActive = activePath === p
                return (
                  <button key={p}
                    onClick={() => { openFile(p); setTreeCollapsed(false) }}
                    title={p}
                    className={`w-6 h-6 flex items-center justify-center rounded text-[13px] transition-colors flex-shrink-0 ${
                      isActive ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {fileIcon(name)}
                  </button>
                )
              })}
            </div>
          ) : (
            /* ── Expanded full tree ── */
            <div className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900/70"
              style={{ width: treeWidth }}>

              {/* Tree toolbar */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 flex-1 truncate">
                  Explorer
                </span>
                {/* Collapse to strip */}
                <button
                  onClick={() => setTreeCollapsed(true)}
                  title="Collapse explorer"
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowNewFile(v => !v)}
                  title="New file"
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>
              </div>

              {/* New-file input */}
              {showNewFile && (
                <div className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
                  <input
                    ref={newFileInputRef}
                    value={newFilePath}
                    onChange={e => setNewFilePath(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') createFile()
                      if (e.key === 'Escape') { setShowNewFile(false); setNewFilePath('') }
                    }}
                    placeholder="src/newFile.ts"
                    className="w-full text-[11px] font-mono px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-emerald-400"
                  />
                  <div className="flex gap-1 mt-1">
                    <button onClick={createFile}
                      className="flex-1 py-0.5 text-[10px] font-medium rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                      Create
                    </button>
                    <button onClick={() => { setShowNewFile(false); setNewFilePath('') }}
                      className="px-2 py-0.5 text-[10px] rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Tree list */}
              <div className="flex-1 overflow-y-auto py-1 select-none"
                onContextMenu={e => { if (e.target === e.currentTarget) openCtxMenu(e, { kind: 'blank' }) }}
              >
                {!workspacePath && (
                  <p className="text-[11px] text-gray-400 text-center mt-4 px-3">No workspace open.</p>
                )}
                {workspacePath && treeLoading && (
                  <div className="flex items-center justify-center mt-4 gap-2 text-gray-400">
                    <Spinner className="w-3.5 h-3.5" /><span className="text-xs">Loading…</span>
                  </div>
                )}
                {workspacePath && !treeLoading && fileTree.length === 0 && (
                  <p className="text-[11px] text-gray-400 text-center mt-4 px-3">No files found.</p>
                )}
                {fileTree.map(node => renderNode(node))}
              </div>
            </div>
          )
        )}

        {/* ── Drag handle between explorer and editor ── */}
        {treeOpen && !treeCollapsed && (
          <div
            onMouseDown={startTreeResize}
            className="w-1 flex-shrink-0 cursor-col-resize bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors active:bg-blue-500"
            title="Drag to resize explorer"
          />
        )}

        {/* ── Editor area ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Tab bar */}
          {openFiles.length > 0 ? (
            <div className="flex items-end border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 overflow-x-auto flex-shrink-0">
              {openFiles.map(file => {
                const name = file.path.split('/').pop() ?? file.path
                const dirty = file.content !== file.savedContent
                const active = file.path === activePath
                return (
                  <div
                    key={file.path}
                    onClick={() => setActivePath(file.path)}
                    title={file.path}
                    className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-gray-200 dark:border-gray-700 whitespace-nowrap flex-shrink-0 transition-colors ${
                      active
                        ? 'bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 border-t-2 border-t-blue-500'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-900/60 border-t-2 border-t-transparent'
                    }`}
                  >
                    <span className="text-[11px]">{fileIcon(name)}</span>
                    <span className="font-medium">{name}</span>
                    {dirty
                      ? (
                        <button
                          onClick={e => closeTab(file.path, e)}
                          title="Unsaved changes — click to close anyway"
                          className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 group-hover:hidden" />
                          <svg className="w-2.5 h-2.5 text-red-400 hidden group-hover:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          onClick={e => closeTab(file.path, e)}
                          title="Close tab"
                          className="w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )
                    }
                  </div>
                )
              })}
            </div>
          ) : null}

          {/* Monaco editor */}
          {activePath && activeFile ? (
            <div className="flex-1 overflow-hidden">
              <Editor
                key={activePath}
                defaultValue={activeFile.content}
                defaultLanguage={activeFile.language}
                theme={isDark ? 'vs-dark' : 'light'}
                onMount={handleEditorMount}
                onChange={handleChange}
                options={{
                  fontSize: 13,
                  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
                  fontLigatures: true,
                  minimap: { enabled: true, scale: 1 },
                  wordWrap: 'off',
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  bracketPairColorization: { enabled: true },
                  formatOnPaste: true,
                  tabSize: 2,
                  insertSpaces: true,
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  padding: { top: 8, bottom: 8 },
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            </div>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-600 gap-4 select-none">
              <svg className="w-16 h-16 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-medium">No file open</p>
                <p className="text-xs mt-1 opacity-70">
                  {workspacePath
                    ? 'Click a file in the tree to open it'
                    : 'Open a workspace folder first'
                  }
                </p>
              </div>
            </div>
          )}

          {/* Status bar */}
          <div className={`flex items-center gap-3 px-3 py-0.5 text-[10px] flex-shrink-0 select-none ${
            activeFile
              ? 'bg-blue-600 dark:bg-blue-700 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600'
          }`}>
            {activeFile ? (
              <>
                <span className="truncate flex-1 opacity-80">{activeFile.path}</span>
                <span className="capitalize opacity-90">{activeFile.language}</span>
                <span className="opacity-70">UTF-8</span>
                {activeFile.content !== activeFile.savedContent && (
                  <span className="text-amber-300 font-medium">● Unsaved</span>
                )}
              </>
            ) : (
              <span className="flex-1">No file open</span>
            )}
            {/* Terminal toggle in status bar */}
            <button
              onClick={() => setTerminalOpen(v => !v)}
              title={terminalOpen ? 'Hide Terminal (Ctrl+`)' : 'Show Terminal (Ctrl+`)'}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                terminalOpen
                  ? activeFile ? 'bg-white/20 text-white' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                  : activeFile ? 'hover:bg-white/10 text-white/70 hover:text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Terminal</span>
            </button>
          </div>

          {/* ── Integrated terminal ── */}
          {terminalOpen && workspacePath && (
            <Suspense fallback={
              <div className="flex items-center justify-center bg-gray-950 text-gray-400 text-xs" style={{ height: terminalHeight }}>
                Loading terminal…
              </div>
            }>
              <TerminalPanel
                workspacePath={workspacePath}
                theme={isDark ? 'dark' : 'light'}
                height={terminalHeight}
                onHeightChange={setTerminalHeight}
              />
            </Suspense>
          )}
          {terminalOpen && !workspacePath && (
            <div className="flex items-center justify-center bg-gray-950 text-gray-400 text-xs" style={{ height: terminalHeight }}>
              Open a workspace folder to use the terminal
            </div>
          )}
        </div>
      </div>

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 min-w-[180px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 text-xs select-none"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          {ctxMenu.target.kind === 'file' && (() => {
            const p = ctxMenu.target.path
            const parentDir = p.includes('/') ? p.split('/').slice(0, -1).join('/') : ''
            return (<>
              <CtxItem icon="📂" label="Open" onClick={() => { openFile(p); setCtxMenu(null) }} />
              <CtxItem icon="✏️" label="Rename" onClick={() => { setRenamingPath(p); setRenameValue(p.split('/').pop()!); setCtxMenu(null) }} />
              <CtxItem icon="📋" label="Copy Relative Path" onClick={() => { navigator.clipboard.writeText(p); setCtxMenu(null) }} />
              {workspacePath && <CtxItem icon="🗂️" label="Copy Absolute Path" onClick={() => { navigator.clipboard.writeText(workspacePath + '/' + p); setCtxMenu(null) }} />}
              <CtxItem icon="⧉" label="Duplicate" onClick={() => { duplicateFile(p); setCtxMenu(null) }} />
              <CtxSep />
              <CtxItem icon="📄" label="New File Here" onClick={() => { setNewFilePath(parentDir ? parentDir + '/' : ''); setShowNewFile(true); setCtxMenu(null) }} />
              <CtxItem icon="💬" label="Ask AI About This" onClick={() => {
                openFile(p).then(() => {
                  const f = openFiles.find(f => f.path === p)
                  if (f) onAskAI(`I have \`${p}\` open in the editor:\n\n\`\`\`${f.language}\n${f.content.slice(0, 8000)}\n\`\`\`\n\n`)
                })
                setCtxMenu(null)
              }} />
              <CtxSep />
              <CtxItem icon="🗑️" label="Delete" danger onClick={() => { deleteFile(p); setCtxMenu(null) }} />
            </>)
          })()}

          {ctxMenu.target.kind === 'dir' && (() => {
            const p = ctxMenu.target.path
            return (<>
              <CtxItem icon="📄" label="New File Here" onClick={() => { setNewFilePath(p + '/'); setShowNewFile(true); setCtxMenu(null) }} />
              <CtxItem icon="📁" label="New Folder Here" onClick={() => { createFolder(p); setCtxMenu(null) }} />
              <CtxSep />
              <CtxItem icon="✏️" label="Rename" onClick={() => { setRenamingPath(p); setRenameValue(p.split('/').pop()!); setCtxMenu(null) }} />
              <CtxItem icon="📋" label="Copy Relative Path" onClick={() => { navigator.clipboard.writeText(p); setCtxMenu(null) }} />
              <CtxSep />
              <CtxItem icon="🗑️" label="Delete Folder" danger onClick={() => { deleteFile(p); setCtxMenu(null) }} />
            </>)
          })()}

          {ctxMenu.target.kind === 'blank' && (<>
            <CtxItem icon="📄" label="New File" onClick={() => { setShowNewFile(true); setCtxMenu(null) }} />
            <CtxItem icon="📁" label="New Folder" onClick={() => { createFolder(''); setCtxMenu(null) }} />
            <CtxSep />
            <CtxItem icon="🔄" label="Refresh" onClick={() => { refreshTree(); setCtxMenu(null) }} />
          </>)}
        </div>
      )}
    </div>
  )
}
