/**
 * Database query tool — supports SQLite and PostgreSQL.
 * Uses dynamic imports so the app runs fine without these packages installed.
 */

import { existsSync } from 'fs'
import { resolve } from 'path'
import type { ToolResult } from './tools'

const MAX_ROWS = 200

function rowsToMarkdownTable(columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '*(query returned 0 rows)*'
  const header  = `| ${columns.join(' | ')} |`
  const divider = `| ${columns.map(() => '---').join(' | ')} |`
  const body    = rows.slice(0, MAX_ROWS).map(row =>
    `| ${row.map(cell => String(cell ?? 'NULL').replace(/\|/g, '\\|')).join(' | ')} |`
  )
  const truncNote = rows.length > MAX_ROWS ? `\n\n*(showing ${MAX_ROWS} of ${rows.length} rows)*` : ''
  return [header, divider, ...body].join('\n') + truncNote
}

function inferDbType(connStr: string): 'sqlite' | 'postgres' | 'unknown' {
  if (connStr.startsWith('postgres://') || connStr.startsWith('postgresql://')) return 'postgres'
  if (connStr.endsWith('.db') || connStr.endsWith('.sqlite') || connStr.endsWith('.sqlite3') ||
      connStr.startsWith('sqlite:')) return 'sqlite'
  if (existsSync(connStr)) return 'sqlite'
  return 'unknown'
}

async function querySQLite(dbPath: string, sql: string): Promise<ToolResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('better-sqlite3').catch(() => null)
    if (!mod) {
      return { output: 'better-sqlite3 is not installed. Run: npm install better-sqlite3', isError: true }
    }
    const Database = mod.default ?? mod
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const stmt = db.prepare(sql)
    const isSelect = /^\s*(select|pragma|explain|with)\b/i.test(sql)
    if (isSelect) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = stmt.all()
      if (rows.length === 0) return { output: '*(query returned 0 rows)*', isError: false }
      const columns = Object.keys(rows[0])
      const rowArrays = rows.map(r => columns.map(c => r[c]))
      return { output: rowsToMarkdownTable(columns, rowArrays), isError: false }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info: any = stmt.run()
      return { output: `OK — ${info.changes} rows affected, last insert ID: ${info.lastInsertRowid}`, isError: false }
    }
  } catch (e) {
    return { output: `SQLite error: ${String(e)}`, isError: true }
  }
}

async function queryPostgres(connStr: string, sql: string): Promise<ToolResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('pg').catch(() => null)
    if (!mod) {
      return { output: 'pg is not installed. Run: npm install pg', isError: true }
    }
    const Client = mod.default?.Client ?? mod.Client ?? mod.default
    const client = new Client({ connectionString: connStr })
    await client.connect()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await client.query(sql)
      await client.end()
      if (!res.rows || res.rows.length === 0) {
        return { output: `OK — ${res.rowCount ?? 0} rows affected`, isError: false }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const columns: string[] = res.fields.map((f: any) => f.name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = res.rows.map((r: any) => columns.map(c => r[c]))
      return { output: rowsToMarkdownTable(columns, rows), isError: false }
    } catch (e) {
      await client.end().catch(() => {})
      throw e
    }
  } catch (e) {
    return { output: `PostgreSQL error: ${String(e)}`, isError: true }
  }
}

export async function queryDatabase(
  connStr: string,
  sql: string,
  workspace: string
): Promise<ToolResult> {
  const type = inferDbType(connStr)
  if (type === 'sqlite') {
    const cleanPath = connStr.replace(/^sqlite:\/\/\//, '').replace(/^sqlite:/, '')
    const absPath = existsSync(cleanPath) ? cleanPath : resolve(workspace, cleanPath)
    return querySQLite(absPath, sql)
  }
  if (type === 'postgres') {
    return queryPostgres(connStr, sql)
  }
  return {
    output:
      'Cannot infer database type from connection string.\n' +
      '- SQLite: provide a .db / .sqlite file path, e.g. "db/app.sqlite"\n' +
      '- PostgreSQL: "postgres://user:password@host:5432/dbname"',
    isError: true
  }
}
