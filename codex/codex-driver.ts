import type { AgentDriver, DriverEvent } from '../core/src/index.ts'
import { AppServer, codexCommand, type AppServerCommand } from './app-server.ts'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MODEL_CACHE_MS = 5 * 60_000

interface Session { runId: string; conn: AppServer; turnId?: string; lastText?: string; error?: string; done: boolean }
export type Skill = { name: string; description: string; path: string; scope: string; enabled: boolean }

/**
 * AgentDriver on Codex: one `codex app-server` child per running card, one thread per run. The agent's model goes into
 * `thread/start`, its role and rules into `developerInstructions` (the user's ~/.codex/config.toml is never written), the effort
 * into `turn/start`. Threads run sandboxed to the task's worktree (`workspace-write`, unless the setting says otherwise) with approvalPolicy `never`, so an
 * unattended run never waits for an approval nobody will give: what the sandbox refuses comes back to the model as a failure.
 */
export class CodexDriver implements AgentDriver {
  id = 'codex' as const
  /** The workbench's own skill packs (设置 → 技能包目录), offered next to the skills Codex finds itself. */
  packSkills: () => Skill[] = () => []
  /** The sandbox new threads get (设置 → 新会话的权限预设; Codex's sandbox modes carry the same names). */
  permission: () => string = () => 'workspace-write'
  private cmd: AppServerCommand
  private version: string
  private cbs = new Set<(e: DriverEvent) => void>()
  private sessions = new Map<string, Session>() // threadId -> session
  /** The model Codex uses when a thread names none (from the last model/list), so the page can show its reasoning efforts. */
  defaultModel = async () => { await this.listModels(); return this.defaultId }
  private defaultId?: string
  private models?: { at: number; list: Awaited<ReturnType<AgentDriver['listModels']>> }

  constructor(o: { command?: AppServerCommand; version?: string } = {}) {
    this.cmd = o.command ?? codexCommand()
    this.version = o.version ?? 'dev'
  }

  /** A short-lived app-server for one question that needs no thread. */
  private async ask<T>(fn: (s: AppServer) => Promise<T>, cwd?: string): Promise<T> {
    const s = await AppServer.open(this.cmd, { cwd, version: this.version })
    try { return await fn(s) } finally { s.close() }
  }

  async listModels() {
    if (this.models && Date.now() - this.models.at < MODEL_CACHE_MS) return this.models.list
    const list = await this.ask(async (s) => {
      const out: Awaited<ReturnType<AgentDriver['listModels']>> = []
      let cursor: string | null | undefined
      do {
        const page = await s.request('model/list', { cursor })
        for (const m of page.data ?? []) {
          if (m.isDefault) this.defaultId = m.model ?? m.id
          if (m.hidden) continue
          out.push({
            id: m.model ?? m.id, name: m.displayName ?? m.id, defaultEffort: m.defaultReasoningEffort ?? undefined,
            efforts: (m.supportedReasoningEfforts ?? []).map((e: { reasoningEffort: string; description?: string }) => ({ id: e.reasoningEffort, name: e.reasoningEffort, description: e.description })),
          })
        }
        cursor = page.nextCursor
      } while (cursor)
      return out
    })
    this.models = { at: Date.now(), list }
    return list
  }

  private async skills(s: AppServer, cwds: string[]): Promise<Skill[]> {
    const r = await s.request('skills/list', { cwds })
    return [...(r.data ?? []).flatMap((d: { skills?: Skill[] }) => d.skills ?? []), ...this.packSkills()].filter((k: Skill) => k.enabled !== false)
  }

  /** Skills Codex itself knows for these directories (~/.codex/skills, the projects' .agents/skills, plugins'). */
  async listSkills(cwds: string[] = []) {
    const seen = new Map<string, { name: string; description: string; source: string }>()
    for (const k of await this.ask((s) => this.skills(s, cwds))) if (!seen.has(k.name)) seen.set(k.name, { name: k.name, description: k.description ?? '', source: k.scope })
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  async start(req: Parameters<AgentDriver['start']>[0]) {
    const conn = await AppServer.open(this.cmd, { cwd: req.cwd, version: this.version })
    let threadId: string | undefined
    try {
      // the agent's skills travel as skill inputs (Codex loads the SKILL.md itself); names Codex does not know are left to the prompt text
      const wanted = new Set(req.profile.skills ?? [])
      const skills = wanted.size ? (await this.skills(conn, [req.cwd])).filter((k) => wanted.has(k.name)) : []
      const t = await conn.request('thread/start', {
        cwd: req.cwd, model: req.profile.model || null, sandbox: this.permission(), approvalPolicy: 'never',
        developerInstructions: req.profile.instructions,
      })
      const id: string = t.thread.id
      threadId = id
      // the sidebar shows the thread's name; without one it shows the whole prompt
      await conn.request('thread/name/set', { threadId: id, name: req.title }).catch(() => {})
      const s: Session = { runId: req.runId, conn, done: false }
      this.sessions.set(id, s)
      conn.onNotification((m, p) => this.onNotification(id, s, m, p))
      conn.onExit((why) => this.finish(id, s, 'failed', `Codex 进程意外退出（${why}）`))
      // ponytail: /plan and /goal are DSH composer commands; the Codex page hides them, a card that still has one runs as plain text
      const files = req.attachments ?? []
      const others = files.filter((f) => !IMAGE_TYPES.includes(f.mediaType))
      const text = others.length ? `${req.prompt}\n\n## 附件\n${others.map((f) => `- ${f.name}：${f.path}`).join('\n')}` : req.prompt
      const turn = await conn.request('turn/start', {
        threadId: id, effort: req.profile.effort || null,
        input: [
          { type: 'text', text, text_elements: [] },
          ...files.filter((f) => IMAGE_TYPES.includes(f.mediaType)).map((f) => ({ type: 'localImage', path: f.path })),
          ...skills.map((k) => ({ type: 'skill', name: k.name, path: k.path })),
        ],
      })
      s.turnId ??= turn.turn?.id
      return { sessionId: id }
    } catch (e) {
      if (threadId) this.sessions.delete(threadId)
      conn.close()
      throw e
    }
  }

  async send(sessionId: string, text: string, mode: 'queue' | 'steer') {
    const s = this.sessions.get(sessionId)
    if (!s || s.done) throw new Error(`会话 ${sessionId} 不在运行`)
    const input = [{ type: 'text', text, text_elements: [] }]
    if (mode === 'steer' && s.turnId) await s.conn.request('turn/steer', { threadId: sessionId, input, expectedTurnId: s.turnId })
    else await s.conn.request('turn/start', { threadId: sessionId, input })
  }

  async interrupt(sessionId: string) {
    const s = this.sessions.get(sessionId)
    if (!s || s.done || !s.turnId) return
    await s.conn.request('turn/interrupt', { threadId: sessionId, turnId: s.turnId })
  }

  onEvent(cb: (e: DriverEvent) => void) {
    this.cbs.add(cb)
    return () => { this.cbs.delete(cb) }
  }

  /** Stop every running thread's process (the service is shutting down). */
  dispose() {
    for (const [id, s] of this.sessions) this.finish(id, s, 'interrupted', '工作台服务已退出')
  }

  private emit(e: DriverEvent) { for (const cb of this.cbs) cb(e) }

  private finish(threadId: string, s: Session, status: 'completed' | 'interrupted' | 'failed', error?: string) {
    if (s.done) return
    s.done = true
    this.sessions.delete(threadId)
    s.conn.close()
    this.emit({ type: 'turn.completed', runId: s.runId, status, finalText: s.lastText, error })
  }

  private onNotification(threadId: string, s: Session, method: string, p: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (p.threadId !== threadId) return
    if (method === 'turn/started') {
      s.turnId = p.turn?.id
      this.emit({ type: 'turn.started', runId: s.runId, sessionId: threadId })
    } else if (method === 'item/completed' && p.item?.type === 'agentMessage' && p.item.text) {
      s.lastText = p.item.text
      this.emit({ type: 'message', runId: s.runId, text: p.item.text })
    } else if (method === 'error' && !p.willRetry) {
      s.error = p.error?.message
    } else if (method === 'turn/completed') {
      const turn = p.turn ?? {}
      if (turn.status === 'completed') this.finish(threadId, s, 'completed')
      else if (turn.status === 'interrupted') this.finish(threadId, s, 'interrupted')
      else this.finish(threadId, s, 'failed', turn.error?.message ?? s.error ?? 'Codex 回合失败')
    }
  }
}
