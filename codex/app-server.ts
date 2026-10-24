import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

/** How to run `codex app-server`: tests point this at a fake. */
export interface AppServerCommand { bin: string; args: string[] }

/**
 * The `codex` executable: WORKBENCH_CODEX_BIN, else `codex` on PATH, else the CLI bundled with the desktop app (an app started from
 * the Dock does not get the shell's PATH).
 */
export function codexCommand(env = process.env): AppServerCommand {
  if (env.WORKBENCH_CODEX_BIN) return { bin: env.WORKBENCH_CODEX_BIN, args: ['app-server'] }
  const bundled = ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/Codex.app/Contents/Resources/codex']
  const onPath = (env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').some((d) => d && existsSync(`${d}/codex${process.platform === 'win32' ? '.exe' : ''}`))
  return { bin: onPath ? 'codex' : bundled.find((p) => existsSync(p)) ?? 'codex', args: ['app-server'] }
}

// Approval requests should not arrive (threads run with approvalPolicy "never"); if one does, nobody is there to approve it.
const DECLINE = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'])

/** One `codex app-server` child speaking JSON-RPC 2.0 as newline-delimited JSON over stdio. */
export class AppServer {
  private child: ChildProcessWithoutNullStreams
  private seq = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>() // eslint-disable-line @typescript-eslint/no-explicit-any
  private notify = new Set<(method: string, params: any) => void>() // eslint-disable-line @typescript-eslint/no-explicit-any
  private exits = new Set<(why: string) => void>()
  private stderr = ''
  exited?: string

  private constructor(cmd: AppServerCommand, cwd?: string) {
    this.child = spawn(cmd.bin, cmd.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    createInterface({ input: this.child.stdout }).on('line', (line) => this.read(line))
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + String(d)).slice(-2000) })
    this.child.stdin.on('error', () => {}) // a dead child surfaces through 'exit'
    const gone = (why: string) => {
      if (this.exited) return
      this.exited = why
      for (const p of this.pending.values()) p.reject(new Error(`Codex app-server 已退出（${why}）`))
      this.pending.clear()
      for (const cb of this.exits) cb(why)
    }
    this.child.once('error', (e) => gone(e.message))
    this.child.once('exit', (code, signal) => gone(signal ?? `退出码 ${code}${this.stderr.trim() ? `：${this.stderr.trim().split('\n').at(-1)}` : ''}`))
  }

  /** Start the process and complete the `initialize` handshake. */
  static async open(cmd: AppServerCommand, o: { cwd?: string; version: string }): Promise<AppServer> {
    const s = new AppServer(cmd, o.cwd)
    try {
      await s.request('initialize', { clientInfo: { name: 'workbench', title: '研发工作台', version: o.version }, capabilities: null }, 30_000)
      s.send({ method: 'initialized', params: {} })
      return s
    } catch (e) { s.close(); throw e }
  }

  request<T = any>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (this.exited) return Promise.reject(new Error(`Codex app-server 已退出（${this.exited}）`))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex app-server 没有响应 ${method}`)) }, timeoutMs)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.send({ id, method, params })
    })
  }

  onNotification(cb: (method: string, params: any) => void) { this.notify.add(cb) } // eslint-disable-line @typescript-eslint/no-explicit-any
  onExit(cb: (why: string) => void) { this.exits.add(cb) }

  close() {
    this.exits.clear()
    if (!this.exited) this.child.kill()
  }

  private send(m: object) { if (!this.exited) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n') }

  private read(line: string) {
    let m: any // eslint-disable-line @typescript-eslint/no-explicit-any
    try { m = JSON.parse(line) } catch { return }
    if (m.method && m.id !== undefined) { // a request from the server
      if (DECLINE.has(m.method)) this.send({ id: m.id, result: { decision: 'decline' } })
      else this.send({ id: m.id, error: { code: -32601, message: `工作台无人值守运行，不处理 ${m.method}` } })
    } else if (m.method) {
      for (const cb of this.notify) cb(m.method, m.params ?? {})
    } else if (this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!
      this.pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error.message ?? `Codex 请求失败（${m.error.code}）`))
      else p.resolve(m.result)
    }
  }
}
