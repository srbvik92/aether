/**
 * DatabaseBrowserPanel — MySQL Workbench-style data browser.
 *
 * • Saved connections (localStorage) — one-click reconnect
 * • Multiple persistent tabs — each tab is an independent connection/session
 * • Double-click cells to edit inline, Apply / Revert changes
 * • Delete / insert rows, sort columns
 * • SQL Editor for arbitrary queries
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import React from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
type DbType = 'sqlite' | 'postgres' | 'mysql'

interface Props {
  workspacePath:  string | undefined
  defaultConnStr: string
  onClose:        () => void
  onAskAI:        (prompt: string) => void
}

interface TableInfo { name: string; rowCount: number | null }

interface GridRow {
  id:            string
  originalCells: string[]
  cells:         string[]
  isNew:         boolean
  isDeleted:     boolean
  dirtyCols:     Set<number>
}

// Persisted: tab config (no runtime data)
interface DbTab {
  id:                string
  name:              string   // display label in tab bar
  savedConnectionId?: string
  connMode:          'url' | 'fields'
  connStr:           string
  dbType:            DbType
  host:              string
  port:              string
  user:              string
  pass:              string
  dbName:            string
  sqliteFile:        string
  lastTable:         string
  lastSql:           string
  lastRightTab:      'grid' | 'sql'
}

// Persisted: saved connection entry
interface SavedConnection {
  id:        string
  name:      string
  connMode:  'url' | 'fields'
  connStr:   string
  dbType:    DbType
  host:      string
  port:      string
  user:      string
  pass:      string
  dbName:    string
  sqliteFile:string
  lastUsed:  number
}

// In-memory only: runtime state per tab
interface TabRuntime {
  connected:    boolean
  tables:       TableInfo[]
  tableLoading: boolean
  tableError:   string
  columns:      string[]
  pkCols:       string[]
  rows:         GridRow[]
  gridLoading:  boolean
  gridError:    string
  applyMsg:     { ok: boolean; text: string } | null
  sqlResult:    { columns: string[]; rows: string[][] } | null
  rawOutput:    string
  queryError:   string
  running:      boolean
  applying:     boolean
  editCell:     { rowId: string; colIdx: number } | null
  editValue:    string
  sortCol:      string | null
  sortDir:      'asc' | 'desc'
  rightTab:     'grid' | 'sql'
  currentTable: string
}

// ── Storage keys ──────────────────────────────────────────────────────────────
const SK = {
  tabs:      'chatui_db_tabs',
  activeTab: 'chatui_db_active_tab',
  savedConn: 'chatui_db_saved_connections',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10) }

function detectDbType(cs: string): DbType {
  if (cs.startsWith('postgres://') || cs.startsWith('postgresql://')) return 'postgres'
  if (cs.startsWith('mysql://') || cs.startsWith('mysql2://')) return 'mysql'
  return 'sqlite'
}

function quoteIdent(name: string, dt: DbType) {
  return dt === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`
}

function sqlVal(v: string) {
  if (v === '' || v.toUpperCase() === 'NULL') return 'NULL'
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return v
  return `'${v.replace(/'/g, "''")}'`
}

function buildConnStr(type: DbType, host: string, port: string, user: string, pass: string, db: string, file: string) {
  if (type === 'sqlite') return file.trim()
  const scheme = type === 'mysql' ? 'mysql' : 'postgres'
  return `${scheme}://${user}:${encodeURIComponent(pass)}@${host}${port ? `:${port}` : ''}/${db}`
}

function parseMarkdownTable(md: string): { columns: string[]; rows: string[][] } | null {
  const lines = md.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2 || !lines[0].includes('|')) return null
  const parse = (line: string) =>
    line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
  return { columns: parse(lines[0]), rows: lines.slice(2).map(parse).filter(r => r.length > 0) }
}

const DEFAULT_PORTS: Record<DbType, string> = { sqlite: '', postgres: '5432', mysql: '3306' }

function newTabDefaults(): Omit<DbTab, 'id' | 'name'> {
  return {
    connMode: 'url', connStr: '', dbType: 'postgres',
    host: 'localhost', port: '5432', user: '', pass: '', dbName: '', sqliteFile: '',
    lastTable: '', lastSql: '', lastRightTab: 'sql',
  }
}

function defaultRuntime(): TabRuntime {
  return {
    connected: false, tables: [], tableLoading: false, tableError: '',
    columns: [], pkCols: [], rows: [], gridLoading: false, gridError: '', applyMsg: null,
    sqlResult: null, rawOutput: '', queryError: '', running: false, applying: false,
    editCell: null, editValue: '', sortCol: null, sortDir: 'asc',
    rightTab: 'sql', currentTable: '',
  }
}

function loadTabs(defaultConnStr: string): DbTab[] {
  try {
    const raw = localStorage.getItem(SK.tabs)
    if (raw) { const t = JSON.parse(raw); if (Array.isArray(t) && t.length) return t }
  } catch { /* ignore */ }
  return [{ id: uid(), name: 'New Connection', ...newTabDefaults(), connStr: defaultConnStr }]
}

function loadActiveTabId(tabs: DbTab[]): string {
  try { const s = localStorage.getItem(SK.activeTab); if (s && tabs.find(t => t.id === s)) return s } catch { /* ignore */ }
  return tabs[0]?.id ?? ''
}

function loadSavedConnections(): SavedConnection[] {
  try { const s = localStorage.getItem(SK.savedConn); if (s) return JSON.parse(s) } catch { /* ignore */ }
  return []
}

function connLabel(tab: DbTab): string {
  if (tab.connMode === 'fields') {
    const db = tab.dbType === 'sqlite' ? tab.sqliteFile || 'SQLite' : `${tab.host}/${tab.dbName}`
    return db || tab.name
  }
  try { return new URL(tab.connStr).pathname.replace('/', '') || tab.connStr } catch { return tab.connStr || 'New Connection' }
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-blue-500`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DatabaseBrowserPanel({ workspacePath, defaultConnStr, onClose, onAskAI }: Props) {
  const isElectron = typeof window !== 'undefined' && !!window.api

  // ── Tabs + saved connections (persisted) ──────────────────────────────────
  const [tabs,       setTabs]       = useState<DbTab[]>(() => loadTabs(defaultConnStr))
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const t = loadTabs(defaultConnStr); return loadActiveTabId(t)
  })
  const [savedConns, setSavedConns] = useState<SavedConnection[]>(loadSavedConnections)

  // Persist tabs whenever they change
  useEffect(() => {
    try { localStorage.setItem(SK.tabs, JSON.stringify(tabs)) } catch { /* ignore */ }
  }, [tabs])
  useEffect(() => {
    try { localStorage.setItem(SK.activeTab, activeTabId) } catch { /* ignore */ }
  }, [activeTabId])
  useEffect(() => {
    try { localStorage.setItem(SK.savedConn, JSON.stringify(savedConns)) } catch { /* ignore */ }
  }, [savedConns])

  // ── Per-tab runtime state (in-memory only) ────────────────────────────────
  const [tabRuntimes, setTabRuntimes] = useState<Record<string, TabRuntime>>({})

  const updateRT = useCallback((tabId: string, updates: Partial<TabRuntime>) => {
    setTabRuntimes(prev => ({
      ...prev,
      [tabId]: { ...(prev[tabId] ?? defaultRuntime()), ...updates },
    }))
  }, [])

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]
  const rt: TabRuntime = tabRuntimes[activeTab?.id ?? ''] ?? defaultRuntime()

  // ── Form state (mirrors active tab; synced on tab switch) ─────────────────
  const [connMode,    setConnMode]    = useState(activeTab?.connMode    ?? 'url')
  const [connStr,     setConnStr]     = useState(activeTab?.connStr     ?? defaultConnStr)
  const [dbType,      setDbType]      = useState<DbType>(activeTab?.dbType ?? 'postgres')
  const [host,        setHost]        = useState(activeTab?.host        ?? 'localhost')
  const [port,        setPort]        = useState(activeTab?.port        ?? '5432')
  const [user,        setUser]        = useState(activeTab?.user        ?? '')
  const [pass,        setPass]        = useState(activeTab?.pass        ?? '')
  const [dbName,      setDbName]      = useState(activeTab?.dbName      ?? '')
  const [sqliteFile,  setSqliteFile]  = useState(activeTab?.sqliteFile  ?? '')
  const [sql,         setSql]         = useState(activeTab?.lastSql     ?? '')

  // When the active tab changes, reload form state from that tab
  const prevActiveTabRef = useRef('')
  useEffect(() => {
    if (!activeTab || activeTab.id === prevActiveTabRef.current) return
    prevActiveTabRef.current = activeTab.id
    setConnMode(activeTab.connMode)
    setConnStr(activeTab.connStr)
    setDbType(activeTab.dbType)
    setHost(activeTab.host)
    setPort(activeTab.port)
    setUser(activeTab.user)
    setPass(activeTab.pass)
    setDbName(activeTab.dbName)
    setSqliteFile(activeTab.sqliteFile)
    setSql(activeTab.lastSql)
  }, [activeTabId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Helper: sync form changes back to the active tab
  const updateFormField = (field: Partial<Pick<DbTab,
    'connMode'|'connStr'|'dbType'|'host'|'port'|'user'|'pass'|'dbName'|'sqliteFile'>>) => {
    if (!activeTab) return
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, ...field } : t))
  }

  // ── Refs for getActiveConnStr (avoids stale closures) ─────────────────────
  const connModeRef   = useRef(connMode);    connModeRef.current   = connMode
  const connStrRef    = useRef(connStr);     connStrRef.current    = connStr
  const dbTypeRef     = useRef(dbType);      dbTypeRef.current     = dbType
  const hostRef       = useRef(host);        hostRef.current       = host
  const portRef       = useRef(port);        portRef.current       = port
  const userRef       = useRef(user);        userRef.current       = user
  const passRef       = useRef(pass);        passRef.current       = pass
  const dbNameRef     = useRef(dbName);      dbNameRef.current     = dbName
  const sqliteFileRef = useRef(sqliteFile);  sqliteFileRef.current = sqliteFile

  const getActiveConnStr = () =>
    connModeRef.current === 'url'
      ? connStrRef.current.trim()
      : buildConnStr(dbTypeRef.current, hostRef.current, portRef.current,
                     userRef.current, passRef.current, dbNameRef.current, sqliteFileRef.current)

  // ── Saved connections UI state ─────────────────────────────────────────────
  const [savedOpen,     setSavedOpen]     = useState(true)
  const [editingSaved,  setEditingSaved]  = useState<string | null>(null)  // id being edited
  const [saveNameInput, setSaveNameInput] = useState('')

  // ── Tab management ────────────────────────────────────────────────────────
  const addTab = () => {
    const t: DbTab = { id: uid(), name: 'New Connection', ...newTabDefaults() }
    setTabs(prev => [...prev, t])
    setActiveTabId(t.id)
  }

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId)
      if (next.length === 0) {
        const fresh: DbTab = { id: uid(), name: 'New Connection', ...newTabDefaults() }
        setActiveTabId(fresh.id)
        return [fresh]
      }
      if (tabId === activeTabId) setActiveTabId(next[next.length - 1].id)
      return next
    })
    setTabRuntimes(prev => { const n = { ...prev }; delete n[tabId]; return n })
  }

  const switchTab = (tabId: string) => {
    if (tabId === activeTabId) return
    setActiveTabId(tabId)
  }

  // ── Saved connections management ──────────────────────────────────────────
  const saveCurrentConnection = () => {
    const cs = getActiveConnStr()
    if (!cs || !saveNameInput.trim()) return
    if (activeTab?.savedConnectionId) {
      // Update existing
      setSavedConns(prev => prev.map(c =>
        c.id === activeTab.savedConnectionId
          ? { ...c, name: saveNameInput.trim(), connMode, connStr, dbType, host, port, user, pass, dbName, sqliteFile, lastUsed: Date.now() }
          : c
      ))
    } else {
      // Create new
      const newConn: SavedConnection = {
        id: uid(), name: saveNameInput.trim(), connMode, connStr, dbType,
        host, port, user, pass, dbName, sqliteFile, lastUsed: Date.now()
      }
      setSavedConns(prev => [newConn, ...prev])
      if (activeTab) {
        setTabs(prev => prev.map(t => t.id === activeTab.id
          ? { ...t, savedConnectionId: newConn.id, name: newConn.name } : t))
      }
    }
    setSaveNameInput('')
  }

  const deleteSavedConn = (id: string) => {
    setSavedConns(prev => prev.filter(c => c.id !== id))
    setTabs(prev => prev.map(t => t.savedConnectionId === id ? { ...t, savedConnectionId: undefined } : t))
  }

  const openSavedConn = (c: SavedConnection) => {
    // Open in a new tab or the current blank tab
    const isBlank = !activeTab || (!rt.connected && !activeTab.connStr && !activeTab.sqliteFile)
    const tabId = isBlank && activeTab ? activeTab.id : uid()
    const newTab: DbTab = {
      id: tabId, name: c.name, savedConnectionId: c.id,
      connMode: c.connMode, connStr: c.connStr, dbType: c.dbType,
      host: c.host, port: c.port, user: c.user, pass: c.pass,
      dbName: c.dbName, sqliteFile: c.sqliteFile,
      lastTable: '', lastSql: '', lastRightTab: 'sql',
    }
    setSavedConns(prev => prev.map(sc => sc.id === c.id ? { ...sc, lastUsed: Date.now() } : sc))
    if (isBlank && activeTab) {
      setTabs(prev => prev.map(t => t.id === tabId ? newTab : t))
    } else {
      setTabs(prev => [...prev, newTab])
      setActiveTabId(tabId)
    }
    // Trigger form sync + auto-connect
    setTimeout(() => connectTab(tabId, buildConnStrFromConn(c)), 50)
  }

  const buildConnStrFromConn = (c: Pick<SavedConnection, 'connMode'|'connStr'|'dbType'|'host'|'port'|'user'|'pass'|'dbName'|'sqliteFile'>) =>
    c.connMode === 'url' ? c.connStr.trim()
      : buildConnStr(c.dbType, c.host, c.port, c.user, c.pass, c.dbName, c.sqliteFile)

  // ── Connect ───────────────────────────────────────────────────────────────
  const connectTab = useCallback(async (tabId: string, cs: string) => {
    if (!cs || !isElectron) return
    updateRT(tabId, { tableLoading: true, tableError: '', connected: false, tables: [] })
    try {
      const r = await window.api.dbListTables(cs, workspacePath ?? '')
      if (!r.ok) {
        updateRT(tabId, { tableLoading: false, tableError: r.output || 'Connection failed' })
      } else {
        const parsed = parseMarkdownTable(r.output)
        const tableList: TableInfo[] = parsed
          ? parsed.rows.map(row => ({ name: row[0] ?? '?', rowCount: row[1] ? (isNaN(Number(row[1])) ? null : Number(row[1])) : null }))
          : []
        updateRT(tabId, { tableLoading: false, connected: true, tables: tableList, tableError: '' })
        // Update tab name from connection
        setTabs(prev => prev.map(t => {
          if (t.id !== tabId) return t
          const lbl = cs.startsWith('mysql://') || cs.startsWith('postgres://') || cs.startsWith('postgresql://')
            ? (() => { try { return new URL(cs).pathname.replace('/', '') || cs } catch { return cs } })()
            : cs.split('/').pop() || cs
          return { ...t, name: t.savedConnectionId ? t.name : (lbl.length > 20 ? lbl.slice(0, 18) + '…' : lbl) }
        }))
      }
    } catch (e) {
      updateRT(tabId, { tableLoading: false, tableError: String(e) })
    }
  }, [isElectron, workspacePath, updateRT])

  const connect = useCallback(() => {
    const cs = getActiveConnStr()
    if (activeTab) connectTab(activeTab.id, cs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, connectTab])

  // ── PK detection ──────────────────────────────────────────────────────────
  const fetchPkColumns = async (tableName: string, cs: string): Promise<string[]> => {
    const dt = detectDbType(cs)
    let pkSql: string
    if (dt === 'sqlite')
      pkSql = `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`
    else if (dt === 'mysql')
      pkSql = `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName.replace(/'/g, "''")}' AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`
    else
      pkSql = `SELECT a.attname AS column_name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '"${tableName.replace(/"/g, '""')}"'::regclass AND i.indisprimary`
    const r = await window.api.dbQuery(cs, pkSql, workspacePath ?? '')
    if (!r.ok) return []
    const parsed = parseMarkdownTable(r.output)
    if (!parsed) return []
    if (dt === 'sqlite') {
      const ni = parsed.columns.indexOf('name'), pi = parsed.columns.indexOf('pk')
      if (ni < 0 || pi < 0) return []
      return parsed.rows.filter(row => Number(row[pi]) > 0).sort((a,b) => Number(a[pi])-Number(b[pi])).map(r => r[ni])
    }
    const ci = parsed.columns.findIndex(c => c.toLowerCase() === 'column_name')
    return ci >= 0 ? parsed.rows.map(r => r[ci]) : []
  }

  // ── Load table into grid ──────────────────────────────────────────────────
  const fetchTableGrid = useCallback(async (tabId: string, tableName: string, cs: string) => {
    updateRT(tabId, { gridLoading: true, gridError: '', applyMsg: null, rows: [], columns: [], pkCols: [], editCell: null, sortCol: null })
    const dt = detectDbType(cs)
    const q  = (n: string) => quoteIdent(n, dt)
    const [dataRes, pks] = await Promise.all([
      window.api.dbQuery(cs, `SELECT * FROM ${q(tableName)} LIMIT 500`, workspacePath ?? ''),
      fetchPkColumns(tableName, cs)
    ])
    if (!dataRes.ok) { updateRT(tabId, { gridLoading: false, gridError: dataRes.output }); return }
    const parsed = parseMarkdownTable(dataRes.output)
    const cols   = parsed?.columns ?? []
    const rawRows = parsed?.rows   ?? []
    const gridRows: GridRow[] = rawRows.map((cells, i) => ({
      id: String(i), originalCells: [...cells], cells: [...cells],
      isNew: false, isDeleted: false, dirtyCols: new Set()
    }))
    updateRT(tabId, { gridLoading: false, columns: cols, pkCols: pks, rows: gridRows,
      currentTable: tableName, rightTab: 'grid' })
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, lastTable: tableName, lastRightTab: 'grid' } : t))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, updateRT])

  const handleTableClick = (tableName: string) => {
    const cs = getActiveConnStr()
    if (activeTab) fetchTableGrid(activeTab.id, tableName, cs)
  }

  // ── Grid: sorted indices ──────────────────────────────────────────────────
  const sortedIndices = useMemo(() => {
    const indices = rt.rows.map((_, i) => i)
    if (!rt.sortCol) return indices
    const ci = rt.columns.indexOf(rt.sortCol)
    if (ci < 0) return indices
    return [...indices].sort((a, b) => {
      const va = rt.rows[a].cells[ci] ?? '', vb = rt.rows[b].cells[ci] ?? ''
      const na = Number(va), nb = Number(vb)
      const cmp = !isNaN(na) && !isNaN(nb) ? na - nb : va.localeCompare(vb)
      return rt.sortDir === 'asc' ? cmp : -cmp
    })
  }, [rt.rows, rt.columns, rt.sortCol, rt.sortDir])

  const handleSortCol = (col: string) => {
    if (!activeTab) return
    if (rt.sortCol === col) updateRT(activeTab.id, { sortDir: rt.sortDir === 'asc' ? 'desc' : 'asc' })
    else updateRT(activeTab.id, { sortCol: col, sortDir: 'asc' })
  }

  // ── Grid: cell editing ────────────────────────────────────────────────────
  const editInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (rt.editCell) editInputRef.current?.focus() }, [rt.editCell])

  const startEdit = (rowId: string, colIdx: number, val: string) => {
    if (!activeTab) return
    updateRT(activeTab.id, { editCell: { rowId, colIdx }, editValue: val === 'NULL' ? '' : val })
  }

  const commitEdit = (rowId: string, colIdx: number) => {
    if (!activeTab || !rt.editCell) return
    const newVal = rt.editValue
    updateRT(activeTab.id, {
      editCell: null,
      rows: rt.rows.map(row => {
        if (row.id !== rowId) return row
        const newCells = [...row.cells]; newCells[colIdx] = newVal
        const dirty = new Set(row.dirtyCols)
        if (!row.isNew) { newVal !== row.originalCells[colIdx] ? dirty.add(colIdx) : dirty.delete(colIdx) }
        return { ...row, cells: newCells, dirtyCols: dirty }
      })
    })
  }

  const handleCellKeyDown = (e: React.KeyboardEvent, rowId: string, colIdx: number) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit(rowId, colIdx) }
    if (e.key === 'Escape') { if (activeTab) updateRT(activeTab.id, { editCell: null }) }
    if (e.key === 'Tab')    {
      e.preventDefault(); commitEdit(rowId, colIdx)
      const next = colIdx + 1
      if (next < rt.columns.length) {
        const row = rt.rows.find(r => r.id === rowId)
        if (row) setTimeout(() => startEdit(rowId, next, row.cells[next] ?? ''), 0)
      }
    }
  }

  // ── Grid: add / delete row ────────────────────────────────────────────────
  const addRow = () => {
    if (!activeTab) return
    const newRow: GridRow = {
      id: uid(), originalCells: rt.columns.map(() => ''), cells: rt.columns.map(() => ''),
      isNew: true, isDeleted: false, dirtyCols: new Set()
    }
    updateRT(activeTab.id, { rows: [...rt.rows, newRow] })
    setTimeout(() => startEdit(newRow.id, 0, ''), 0)
  }

  const toggleDeleteRow = (rowId: string) => {
    if (!activeTab) return
    updateRT(activeTab.id, {
      rows: rt.rows.map(r => r.id === rowId ? { ...r, isDeleted: !r.isDeleted } : r)
    })
  }

  const revertChanges = () => {
    if (!activeTab) return
    updateRT(activeTab.id, {
      rows: rt.rows.filter(r => !r.isNew).map(r =>
        ({ ...r, cells: [...r.originalCells], isDeleted: false, dirtyCols: new Set() })),
      editCell: null, applyMsg: null
    })
  }

  // ── Grid: apply changes ───────────────────────────────────────────────────
  const applyChanges = async () => {
    if (!activeTab) return
    const cs = getActiveConnStr()
    updateRT(activeTab.id, { applying: true, applyMsg: null })
    const dt = detectDbType(cs)
    const q  = (n: string) => quoteIdent(n, dt)
    const tn = q(rt.currentTable)
    const stmts: string[] = []
    for (const row of rt.rows) {
      if (row.isNew && row.isDeleted) continue
      if (!row.isNew && row.isDeleted && rt.pkCols.length) {
        const where = rt.pkCols.map(pk => { const i = rt.columns.indexOf(pk); return `${q(pk)} = ${sqlVal(row.originalCells[i] ?? '')}` }).join(' AND ')
        stmts.push(`DELETE FROM ${tn} WHERE ${where}`)
      } else if (row.isNew && !row.isDeleted) {
        stmts.push(`INSERT INTO ${tn} (${rt.columns.map(c => q(c)).join(', ')}) VALUES (${row.cells.map(v => sqlVal(v)).join(', ')})`)
      } else if (!row.isNew && row.dirtyCols.size > 0 && rt.pkCols.length) {
        const set   = Array.from(row.dirtyCols).map(ci => `${q(rt.columns[ci])} = ${sqlVal(row.cells[ci] ?? '')}`).join(', ')
        const where = rt.pkCols.map(pk => { const i = rt.columns.indexOf(pk); return `${q(pk)} = ${sqlVal(row.originalCells[i] ?? '')}` }).join(' AND ')
        stmts.push(`UPDATE ${tn} SET ${set} WHERE ${where}`)
      }
    }
    if (!stmts.length) { updateRT(activeTab.id, { applying: false, applyMsg: { ok: true, text: 'No changes to apply.' } }); return }
    let err = '', done = 0
    for (const stmt of stmts) {
      const r = await window.api.dbQuery(cs, stmt, workspacePath ?? '')
      if (!r.ok) { err = r.output; break }
      done++
    }
    if (err) {
      updateRT(activeTab.id, { applying: false, applyMsg: { ok: false, text: `Failed after ${done} statements: ${err}` } })
    } else {
      updateRT(activeTab.id, { applying: false, applyMsg: { ok: true, text: `✓ ${done} statement${done !== 1 ? 's' : ''} applied.` } })
      fetchTableGrid(activeTab.id, rt.currentTable, cs)
    }
  }

  // ── SQL editor ────────────────────────────────────────────────────────────
  const runQuery = async (querySql?: string) => {
    if (!activeTab) return
    const cs = getActiveConnStr()
    const q  = (querySql ?? sql).trim()
    if (!q || !cs) return
    updateRT(activeTab.id, { running: true, queryError: '', sqlResult: null, rawOutput: '' })
    try {
      const r = await window.api.dbQuery(cs, q, workspacePath ?? '')
      if (!r.ok) updateRT(activeTab.id, { running: false, queryError: r.output })
      else {
        updateRT(activeTab.id, { running: false, rawOutput: r.output, sqlResult: parseMarkdownTable(r.output) })
      }
    } catch (e) { updateRT(activeTab.id, { running: false, queryError: String(e) }) }
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, lastSql: q } : t))
  }

  const handleAskAI = () => {
    if (!aiPrompt.trim()) return
    const cs = getActiveConnStr()
    onAskAI([`Please query my database (connection: ${cs}) and help with the following:`, aiPrompt.trim(), '', 'Use the query_database tool to run SQL queries against this database.'].join('\n'))
    setAiPrompt('')
  }

  const [aiPrompt, setAiPrompt] = useState('')

  // ── Derived ───────────────────────────────────────────────────────────────
  const hasPendingChanges = rt.rows.some(r => (r.isNew && !r.isDeleted) || (!r.isNew && r.isDeleted) || r.dirtyCols.size > 0)
  const pendingCount = rt.rows.filter(r => (r.isNew && !r.isDeleted) || (!r.isNew && r.isDeleted) || r.dirtyCols.size > 0).length
  const fieldsConnStr = buildConnStr(dbType, host, port, user, pass, dbName, sqliteFile)
  const previewConnStr = connMode === 'url' ? connStr : fieldsConnStr

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🗄️</span>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Database Browser</h2>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">SQLite · PostgreSQL · MySQL — saved connections, persistent tabs, inline editing</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 flex-shrink-0 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => switchTab(tab.id)}
              className={`group flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap flex-shrink-0 transition-colors ${
                tab.id === activeTabId
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-gray-800/60'
              }`}>
              <span className="text-[10px] opacity-50">
                {(tabRuntimes[tab.id]?.connected) ? '🟢' : '⚪'}
              </span>
              <span className="max-w-[140px] truncate">{tab.name}</span>
              <span onClick={e => closeTab(tab.id, e)}
                className="ml-0.5 w-3.5 h-3.5 rounded flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-gray-300 dark:hover:bg-gray-600 transition-all text-[10px]">
                ✕
              </span>
            </button>
          ))}
          <button onClick={addTab} title="New connection tab"
            className="flex-shrink-0 px-3 py-2 text-gray-400 hover:text-blue-500 hover:bg-white dark:hover:bg-gray-800 transition-colors text-sm font-light border-b-2 border-transparent">
            +
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* ── Left panel ── */}
          <div className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-900/70 overflow-y-auto">

            {/* Saved connections */}
            <div className="border-b border-gray-200 dark:border-gray-700">
              <button onClick={() => setSavedOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <span>Saved Connections ({savedConns.length})</span>
                <span className={`transition-transform ${savedOpen ? 'rotate-90' : ''}`}>›</span>
              </button>
              {savedOpen && (
                <div className="pb-1">
                  {savedConns.length === 0 && (
                    <p className="text-[11px] text-gray-400 px-3 py-2 text-center">No saved connections yet.<br/>Connect and click Save.</p>
                  )}
                  {savedConns.sort((a,b) => b.lastUsed - a.lastUsed).map(c => (
                    <div key={c.id} className="flex items-center gap-1 px-2 py-1 group hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded mx-1">
                      <button onClick={() => openSavedConn(c)} className="flex-1 min-w-0 text-left">
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{c.name}</div>
                        <div className="text-[9px] text-gray-400 truncate font-mono">
                          {c.connMode === 'fields'
                            ? `${c.dbType} · ${c.host}/${c.dbName}`
                            : c.connStr.replace(/:([^:@]+)@/, ':••••@').slice(0, 35)}
                        </div>
                      </button>
                      <button onClick={() => deleteSavedConn(c.id)}
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 text-gray-400 transition-all text-[10px] w-4 h-4 flex items-center justify-center flex-shrink-0">
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Connection form */}
            <div className="border-b border-gray-200 dark:border-gray-700">
              {/* Mode tabs */}
              <div className="flex border-b border-gray-200 dark:border-gray-700">
                {(['url', 'fields'] as const).map(tab => (
                  <button key={tab} onClick={() => { setConnMode(tab); updateFormField({ connMode: tab }); updateRT(activeTab?.id ?? '', { connected: false, tables: [] }) }}
                    className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                      connMode === tab
                        ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500 bg-white dark:bg-gray-900'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}>
                    {tab === 'url' ? 'URL' : 'Fields'}
                  </button>
                ))}
              </div>

              <div className="px-3 py-2.5 flex flex-col gap-2">
                {/* URL mode */}
                {connMode === 'url' && (
                  <textarea value={connStr}
                    onChange={e => { setConnStr(e.target.value); updateFormField({ connStr: e.target.value }) }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); connect() } }}
                    rows={3} placeholder={'SQLite: db/app.sqlite\nPostgres: postgres://…\nMySQL:   mysql://…'}
                    className="w-full text-[11px] font-mono px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 resize-none outline-none focus:ring-1 focus:ring-blue-400" />
                )}

                {/* Fields mode */}
                {connMode === 'fields' && (<>
                  <div>
                    <div className="flex gap-1 mb-1.5">
                      {(['postgres','mysql','sqlite'] as DbType[]).map(t => (
                        <button key={t} onClick={() => { setDbType(t); setPort(DEFAULT_PORTS[t]); updateFormField({ dbType: t, port: DEFAULT_PORTS[t] }) }}
                          className={`flex-1 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                            dbType === t
                              ? 'bg-blue-500 border-blue-500 text-white'
                              : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-blue-400 hover:text-blue-600 bg-white dark:bg-gray-800'
                          }`}>
                          {t === 'postgres' ? 'PG' : t === 'mysql' ? 'MySQL' : 'SQLite'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {dbType === 'sqlite' ? (
                    <input value={sqliteFile} onChange={e => { setSqliteFile(e.target.value); updateFormField({ sqliteFile: e.target.value }) }}
                      placeholder="db/app.sqlite"
                      className="w-full text-[11px] font-mono px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-blue-400" />
                  ) : (<>
                    <div className="flex gap-1.5">
                      <div className="flex-1 min-w-0">
                        <label className="text-[9px] uppercase tracking-wider text-gray-400 block mb-0.5">Host</label>
                        <input value={host} onChange={e => { setHost(e.target.value); updateFormField({ host: e.target.value }) }} placeholder="localhost"
                          className="w-full text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <div className="w-14 flex-shrink-0">
                        <label className="text-[9px] uppercase tracking-wider text-gray-400 block mb-0.5">Port</label>
                        <input value={port} onChange={e => { setPort(e.target.value); updateFormField({ port: e.target.value }) }} placeholder={DEFAULT_PORTS[dbType]}
                          className="w-full text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>
                    </div>
                    <input value={user} onChange={e => { setUser(e.target.value); updateFormField({ user: e.target.value }) }} placeholder={dbType === 'mysql' ? 'root' : 'postgres'} autoComplete="off"
                      className="w-full text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-blue-400" />
                    <input type="password" value={pass} onChange={e => { setPass(e.target.value); updateFormField({ pass: e.target.value }) }} placeholder="Password" autoComplete="new-password"
                      className="w-full text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-blue-400" />
                    <input value={dbName} onChange={e => { setDbName(e.target.value); updateFormField({ dbName: e.target.value }) }} placeholder="Database"
                      className="w-full text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-blue-400" />
                    {fieldsConnStr && (
                      <p className="text-[9px] font-mono text-gray-400 break-all bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-1">
                        {fieldsConnStr.replace(/:([^:@]+)@/, ':••••@')}
                      </p>
                    )}
                  </>)}
                </>)}

                {/* Connect button */}
                <button onClick={connect} disabled={!previewConnStr || rt.tableLoading}
                  className="w-full py-1.5 text-xs font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                  {rt.tableLoading ? <><Spinner className="w-3 h-3" /> Connecting…</> : rt.connected ? '↺ Reconnect' : 'Connect'}
                </button>
                {rt.tableError && <p className="text-[10px] text-red-500 break-all">{rt.tableError}</p>}

                {/* Save connection */}
                {rt.connected && (
                  <div className="flex gap-1.5 pt-1 border-t border-gray-200 dark:border-gray-700">
                    <input value={saveNameInput} onChange={e => setSaveNameInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveCurrentConnection() }}
                      placeholder={activeTab?.savedConnectionId ? 'Update name…' : 'Save as…'}
                      className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-emerald-400" />
                    <button onClick={saveCurrentConnection} disabled={!saveNameInput.trim()}
                      className="px-2 py-1 text-[10px] font-medium rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors whitespace-nowrap flex-shrink-0">
                      {activeTab?.savedConnectionId ? 'Update' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Table list */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {!rt.connected && !rt.tableLoading && (
                <p className="text-[11px] text-gray-400 text-center mt-4 px-2">Enter connection details above and click Connect.</p>
              )}
              {rt.connected && rt.tables.length === 0 && (
                <p className="text-[11px] text-gray-400 text-center mt-4 px-2">No tables found.</p>
              )}
              {rt.tables.map(t => (
                <button key={t.name} onClick={() => handleTableClick(t.name)}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg group transition-colors text-left ${
                    rt.currentTable === t.name && rt.rightTab === 'grid'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  }`}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm opacity-40">⊞</span>
                    <span className="text-xs font-mono truncate text-gray-700 dark:text-gray-300">{t.name}</span>
                  </span>
                  {t.rowCount !== null && <span className="text-[9px] text-gray-400 flex-shrink-0 ml-1">{t.rowCount.toLocaleString()}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Inner view tabs: Grid | SQL Editor */}
            <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 gap-1 flex-shrink-0">
              {(['grid', 'sql'] as const).map(v => (
                <button key={v} onClick={() => { updateRT(activeTab?.id ?? '', { rightTab: v }); if (activeTab) setTabs(p => p.map(t => t.id === activeTab.id ? { ...t, lastRightTab: v } : t)) }}
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    rt.rightTab === v
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}>
                  {v === 'grid' ? `⊞ ${rt.currentTable || 'Grid'}` : '⌨ SQL Editor'}
                </button>
              ))}
            </div>

            {/* ── Grid view ── */}
            {rt.rightTab === 'grid' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Grid toolbar */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex-shrink-0">
                  <span className="text-xs text-gray-500 font-mono flex-1 truncate">
                    {rt.currentTable
                      ? <>{rt.currentTable}<span className="opacity-40"> — {rt.rows.filter(r => !r.isNew).length} rows{!rt.pkCols.length ? ' · ⚠ no PK (editing disabled)' : ''}</span></>
                      : <span className="opacity-40">Click a table to open it</span>}
                  </span>
                  {rt.currentTable && (<>
                    <button onClick={addRow} disabled={!rt.pkCols.length}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 disabled:opacity-40 border border-emerald-200 dark:border-emerald-800 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      Add Row
                    </button>
                    {hasPendingChanges && (
                      <button onClick={revertChanges} className="px-2 py-1 text-[11px] font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 border border-gray-200 dark:border-gray-700 transition-colors">↩ Revert</button>
                    )}
                    <button onClick={applyChanges} disabled={!hasPendingChanges || rt.applying || !rt.pkCols.length}
                      className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                        hasPendingChanges && rt.pkCols.length
                          ? 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600'
                          : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 cursor-not-allowed'
                      }`}>
                      {rt.applying ? <><Spinner className="w-3 h-3" />Applying…</> : <>✓ Apply{pendingCount > 0 ? ` (${pendingCount})` : ''}</>}
                    </button>
                    <button onClick={() => { const cs = getActiveConnStr(); if (activeTab) fetchTableGrid(activeTab.id, rt.currentTable, cs) }} title="Refresh"
                      className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-blue-500 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                    </button>
                  </>)}
                </div>

                {/* Apply message */}
                {rt.applyMsg && (
                  <div className={`px-3 py-1.5 text-xs flex items-center gap-2 flex-shrink-0 ${rt.applyMsg.ok ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700' : 'bg-red-50 dark:bg-red-900/20 text-red-600'}`}>
                    {rt.applyMsg.text}
                    <button onClick={() => updateRT(activeTab?.id ?? '', { applyMsg: null })} className="ml-auto opacity-60 hover:opacity-100 text-[10px]">✕</button>
                  </div>
                )}

                {/* Grid body */}
                <div className="flex-1 overflow-auto">
                  {rt.gridLoading && <div className="flex items-center justify-center h-full gap-2 text-gray-400"><Spinner /><span className="text-sm">Loading…</span></div>}
                  {rt.gridError && <div className="flex items-center justify-center h-full"><p className="text-sm text-red-500 px-4 text-center">{rt.gridError}</p></div>}
                  {!rt.gridLoading && !rt.gridError && !rt.currentTable && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                      <span className="text-4xl opacity-20">⊞</span>
                      <p className="text-xs text-center">Click a table on the left to open it in the editable grid</p>
                    </div>
                  )}
                  {!rt.gridLoading && !rt.gridError && rt.currentTable && rt.columns.length > 0 && (
                    <table className="w-full text-xs border-collapse" style={{ tableLayout: 'auto' }}>
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                          <th className="w-8 px-2 py-2 text-center text-[9px] font-semibold text-gray-400 border-r border-gray-200 dark:border-gray-700 select-none">#</th>
                          {rt.columns.map(col => (
                            <th key={col} onClick={() => handleSortCol(col)}
                              className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-700 border-r border-gray-200 dark:border-gray-700 last:border-r-0 transition-colors">
                              <span className="flex items-center gap-1">
                                {rt.pkCols.includes(col) && <span className="text-amber-500 text-[10px]">🔑</span>}
                                {col}
                                {rt.sortCol === col && <span className="text-blue-500">{rt.sortDir === 'asc' ? '↑' : '↓'}</span>}
                              </span>
                            </th>
                          ))}
                          <th className="w-7 px-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedIndices.map((rowIdx, dispIdx) => {
                          const row = rt.rows[rowIdx]
                          return (
                            <tr key={row.id} className={`border-b border-gray-100 dark:border-gray-800 ${
                              row.isDeleted ? 'bg-red-50 dark:bg-red-900/10 opacity-60' :
                              row.isNew ? 'bg-emerald-50 dark:bg-emerald-900/10' :
                              dispIdx % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/30'
                            }`}>
                              <td className="w-8 px-2 py-1 text-center text-[9px] text-gray-400 select-none border-r border-gray-100 dark:border-gray-800 font-mono">
                                {row.isNew ? '+' : row.isDeleted ? '✕' : dispIdx + 1}
                              </td>
                              {rt.columns.map((_, ci) => {
                                const cell      = row.cells[ci] ?? ''
                                const isEditing = rt.editCell?.rowId === row.id && rt.editCell?.colIdx === ci
                                const isDirty   = row.dirtyCols.has(ci)
                                const canEdit   = !row.isDeleted && (row.isNew || rt.pkCols.length > 0)
                                return (
                                  <td key={ci} onDoubleClick={() => canEdit && startEdit(row.id, ci, cell)}
                                    className={`px-0 py-0 border-r border-gray-100 dark:border-gray-800 max-w-[200px] ${canEdit ? 'cursor-text' : ''} ${isDirty ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}
                                    title={canEdit ? 'Double-click to edit' : ''}>
                                    {isEditing ? (
                                      <input ref={editInputRef} value={rt.editValue}
                                        onChange={e => updateRT(activeTab?.id ?? '', { editValue: e.target.value })}
                                        onBlur={() => commitEdit(row.id, ci)}
                                        onKeyDown={e => handleCellKeyDown(e, row.id, ci)}
                                        className="w-full min-w-[80px] px-3 py-1.5 text-xs font-mono bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-400 outline-none" autoFocus />
                                    ) : (
                                      <span className={`block px-3 py-1.5 truncate font-mono ${
                                        isDirty ? 'text-amber-800 dark:text-amber-200 font-medium' : 'text-gray-700 dark:text-gray-300'
                                      } ${cell === 'NULL' || cell === '' ? 'italic text-gray-400 dark:text-gray-600' : ''}`}>
                                        {cell === '' ? 'NULL' : cell}
                                        {isDirty && <span className="ml-1 text-[9px] text-amber-500" title={`Was: ${row.originalCells[ci]}`}>●</span>}
                                      </span>
                                    )}
                                  </td>
                                )
                              })}
                              <td className="w-7 px-1 py-1 text-center">
                                <button onClick={() => toggleDeleteRow(row.id)}
                                  title={row.isDeleted ? 'Restore row' : 'Mark for deletion'}
                                  className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                                    row.isDeleted ? 'text-emerald-500 hover:bg-emerald-50' : 'text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                                  }`}
                                  style={{ opacity: row.isDeleted ? 1 : undefined }}>
                                  {row.isDeleted
                                    ? <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
                                    : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                  }
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── SQL Editor ── */}
            {rt.rightTab === 'sql' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between px-4 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">SQL Query</span>
                    <span className="text-[10px] text-gray-400">Ctrl+Enter to run</span>
                  </div>
                  <div className="px-3 pb-2">
                    <textarea value={sql} onChange={e => setSql(e.target.value)}
                      onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery() } }}
                      rows={4} placeholder="SELECT * FROM users LIMIT 10;" spellCheck={false}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 resize-none outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div className="flex items-center gap-2 px-3 pb-3">
                    <button onClick={() => runQuery()} disabled={!sql.trim() || !previewConnStr || rt.running}
                      className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                      {rt.running ? <><Spinner className="w-3.5 h-3.5" />Running…</> : <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
                        Run</>}
                    </button>
                    {rt.sqlResult && <span className="text-[11px] text-gray-500">{rt.sqlResult.rows.length} row{rt.sqlResult.rows.length !== 1 ? 's' : ''}</span>}
                    {rt.queryError && <span className="text-[11px] text-red-500 truncate flex-1">{rt.queryError}</span>}
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-3">
                  {!rt.sqlResult && !rt.queryError && !rt.running && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                      <span className="text-4xl opacity-20">⊞</span>
                      <p className="text-xs text-center">Run a query, or click a table on the left to open the grid.</p>
                    </div>
                  )}
                  {rt.sqlResult && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                            {rt.sqlResult.columns.map((col, i) => (
                              <th key={i} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rt.sqlResult.rows.map((row, ri) => (
                            <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800 max-w-[200px] truncate" title={cell}>
                                  {cell === 'NULL' ? <span className="text-gray-400 italic">NULL</span> : cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rt.rawOutput.includes('(showing') && (
                        <p className="text-[11px] text-gray-400 mt-2 text-center">{rt.rawOutput.match(/\(showing [^)]+\)/)?.[0]}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Ask AI bar ── */}
            <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-3 py-2 bg-amber-50 dark:bg-amber-900/10">
              <div className="flex items-center gap-2">
                <span className="text-amber-500 text-sm flex-shrink-0">✨</span>
                <input type="text" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAskAI() }}
                  placeholder="Ask AI about your database…"
                  className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-1 focus:ring-amber-400" />
                <button onClick={handleAskAI} disabled={!aiPrompt.trim()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors whitespace-nowrap">Ask AI</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
