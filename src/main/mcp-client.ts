/**
 * MCP (Model Context Protocol) client — connects to MCP servers via stdio.
 *
 * Protocol: JSON-RPC 2.0 over newline-delimited stdin/stdout.
 *
 * Lifecycle:
 *   1. spawn process
 *   2. send initialize request
 *   3. receive result + send initialized notification
 *   4. call tools/list to discover tools
 *   5. call tools/call to execute tools
 */

import { spawn, ChildProcess } from 'child_process'
import { McpServerConfig, McpTool } from '../shared/types'
import { log } from './logger'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject:  (reason: unknown) => void
  timeout: NodeJS.Timeout
}

class McpClient {
  private process:  ChildProcess | null = null
  private pending:  Map<number, PendingRequest> = new Map()
  private nextId    = 1
  private buffer    = ''
  public  tools:    McpTool[] = []
  public  ready     = false
  public  error:    string | null = null

  constructor(public readonly config: McpServerConfig) {}

  // ── Start and initialize ──────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; tools?: McpTool[]; error?: string }> {
    try {
      if (!this.config.command) {
        return { ok: false, error: 'No command configured for this MCP server (remote servers do not use stdio).' }
      }
      const env = { ...process.env, ...(this.config.env ?? {}) }
      this.process = spawn(this.config.command, this.config.args ?? [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      this.process.stdout?.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf-8')
        this.flush()
      })

      this.process.stderr?.on('data', (chunk: Buffer) => {
        log.debug('mcp', `[${this.config.name}] stderr: ${chunk.toString('utf-8').trim()}`)
      })

      this.process.on('exit', (code) => {
        log.info('mcp', `[${this.config.name}] exited with code ${code}`)
        this.ready = false
        // Reject all pending requests
        for (const [id, req] of this.pending) {
          clearTimeout(req.timeout)
          req.reject(new Error(`MCP server exited (code ${code})`))
          this.pending.delete(id)
        }
      })

      this.process.on('error', (err) => {
        this.error = err.message
        log.error('mcp', `[${this.config.name}] process error`, { error: err.message })
      })

      // Initialize
      const initResult = await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'ChatUI', version: '1.0.0' }
      })

      if (!initResult) throw new Error('Initialize returned null')

      // Send initialized notification (no id — it's a notification)
      this.notify('notifications/initialized')

      // Discover tools
      const toolsResult = await this.request('tools/list', {}) as { tools?: McpTool[] }
      this.tools = toolsResult?.tools ?? []
      this.ready = true

      log.info('mcp', `[${this.config.name}] ready with ${this.tools.length} tools`)
      return { ok: true, tools: this.tools }

    } catch (e) {
      this.error = String(e)
      this.stop()
      return { ok: false, error: String(e) }
    }
  }

  // ── Call a tool ───────────────────────────────────────────────────────────

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.ready) throw new Error(`MCP server ${this.config.name} is not ready`)

    const result = await this.request('tools/call', { name, arguments: args }) as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }

    const text = result?.content
      ?.filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n') ?? ''

    if (result?.isError) throw new Error(text || 'Tool call failed')
    return text
  }

  // ── Stop ──────────────────────────────────────────────────────────────────

  stop(): void {
    this.ready = false
    if (this.process) {
      try { this.process.kill() } catch { /* ignore */ }
      this.process = null
    }
  }

  // ── JSON-RPC helpers ──────────────────────────────────────────────────────

  private request(method: string, params: unknown, timeoutMs = 15_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++

      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout waiting for response to ${method}`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timeout })

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      try {
        this.process?.stdin?.write(msg + '\n')
      } catch (e) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(e)
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined && { params }) })
    try { this.process?.stdin?.write(msg + '\n') } catch { /* ignore */ }
  }

  private flush(): void {
    const lines = this.buffer.split('\n')
    this.buffer  = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as {
          jsonrpc: '2.0'
          id?:    number
          result?: unknown
          error?:  { code: number; message: string }
          method?: string
        }

        if (msg.id !== undefined) {
          const req = this.pending.get(msg.id)
          if (req) {
            clearTimeout(req.timeout)
            this.pending.delete(msg.id)
            if (msg.error) req.reject(new Error(msg.error.message))
            else           req.resolve(msg.result)
          }
        }
        // Ignore server → client notifications for now
      } catch {
        log.debug('mcp', `[${this.config.name}] invalid JSON: ${trimmed.slice(0, 100)}`)
      }
    }
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

const activeClients = new Map<string, McpClient>()

export async function startMcpServer(
  config: McpServerConfig
): Promise<{ ok: boolean; tools?: McpTool[]; error?: string }> {
  // Stop existing client with same id first
  stopMcpServer(config.id)

  const client = new McpClient(config)
  activeClients.set(config.id, client)

  const result = await client.start()
  if (!result.ok) activeClients.delete(config.id)
  return result
}

export function stopMcpServer(id: string): void {
  const client = activeClients.get(id)
  if (client) {
    client.stop()
    activeClients.delete(id)
  }
}

export function stopAllMcpServers(): void {
  for (const [id] of activeClients) stopMcpServer(id)
}

export function getActiveMcpTools(): Array<{ serverId: string; serverName: string; tool: McpTool }> {
  const result: Array<{ serverId: string; serverName: string; tool: McpTool }> = []
  for (const [id, client] of activeClients) {
    if (client.ready) {
      for (const tool of client.tools) {
        result.push({ serverId: id, serverName: client.config.name, tool })
      }
    }
  }
  return result
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; output: string; error?: string }> {
  const client = activeClients.get(serverId)
  if (!client || !client.ready) {
    return { ok: false, output: '', error: `MCP server ${serverId} not connected` }
  }
  try {
    const output = await client.callTool(toolName, args)
    return { ok: true, output }
  } catch (e) {
    return { ok: false, output: '', error: String(e) }
  }
}

export function getMcpServerStatus(id: string): { ready: boolean; tools: number; error: string | null } {
  const client = activeClients.get(id)
  if (!client) return { ready: false, tools: 0, error: null }
  return { ready: client.ready, tools: client.tools.length, error: client.error }
}
