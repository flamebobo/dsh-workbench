import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { AgentDriver, AgentProfile, DriverEvent } from '../core/src/index.ts'

// The DSH Host context is an untyped Cordis context at this boundary; the plugin imports no @deepseek-ai package.
type Ctx = any // eslint-disable-line @typescript-eslint/no-explicit-any

const presetId = (agentId: string) => `wb-${agentId}`
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const PLAN_SECTION = `You are in plan mode. Explore the repository with read-only tools first, then present a decision-complete plan (goal, success criteria, files to change, tests) through exit_plan_mode and wait for the user's approval. Do not edit files, run code generators, or commit while planning.`
const MODELS = [
  { id: 'deepseek-flash', name: 'deepseek-flash' },
  { id: 'deepseek-pro', name: 'deepseek-pro' },
]

/** Tool/prompt composition of a workbench preset: DSH `standard` minus delegation/planning extras, persona replaced by the agent's instructions. */
function presetDefinition(a: AgentProfile) {
  return {
    id: presetId(a.id),
    name: `工作台 · ${a.name}`,
    description: a.description,
    order: 50,
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: `You are a coding agent powered by the {{model}} model.\n\n${a.instructions}` } },
      { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
      { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: process.platform === 'win32' },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: process.platform !== 'win32' },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
      { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
      { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
      // The task form can start a session with /goal or /plan, so those commands (and /plan's exit tool) must exist in the preset.
      { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
      { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
      { id: 'planning', name: 'cordis:group', group: true, isolate: { planMode: true },
        config: [{ id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: PLAN_SECTION } }] },
    ],
  }
}

export class DshDriver implements AgentDriver {
  id = 'dsh' as const
  private ctx: Ctx
  private cbs = new Set<(e: DriverEvent) => void>()
  private runs = new Map<string, { runId: string; lastText?: string }>() // sessionId -> run
  private presets = new Map<string, () => Promise<void>>() // preset id -> disposer
  private handles = new Map<string, { agent: any }>()

  constructor(ctx: Ctx) {
    this.ctx = ctx
    ctx.on('session/event', (session: any, event: any) => this.onSessionEvent(session.id, event))
  }

  async listModels() { return MODELS }

  /** (Re)register one agent as a DSH Agent Preset `wb-<id>`. Failure is logged; start() then falls back to `standard`. */
  async registerPreset(a: AgentProfile): Promise<boolean> {
    const id = presetId(a.id)
    try {
      await this.presets.get(id)?.()
      this.presets.delete(id)
      this.presets.set(id, await this.ctx.agentPresets.register(presetDefinition(a)))
      return true
    } catch (e) {
      this.ctx.logger.warn(`workbench: preset ${id} registration failed`, e)
      return false
    }
  }

  async disposePresets() {
    await Promise.allSettled([...this.presets.values()].map((d) => d()))
    this.presets.clear()
  }

  async start(req: Parameters<AgentDriver['start']>[0]) {
    const ctx = this.ctx
    let preset = presetId(req.profile.presetId)
    let prompt = req.prompt
    const resolved = await ctx.agentPresets.resolve(preset).catch(() => undefined)
    if (!resolved) {
      preset = 'standard'
      prompt = `${req.profile.instructions}\n\n${req.prompt}`
    }
    const presetInfo = await ctx.agentPresets.resolve(preset)
    const scope = await ctx.agentPresets.acquireScope(presetInfo.id)
    try {
      const selected = ctx.agentDefaultModel.currentSelection()
      const workspace = await ctx.workspaceRegistry.create(req.cwd)
      const sessionId = `workbench-${randomUUID()}`
      this.runs.set(sessionId, { runId: req.runId })
      const handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: workspace.path, agentPreset: presetInfo.id },
        agentOptions: { provider: selected.provider, model: req.profile.model || selected.model },
        setup: async (agentCtx: any) => { await ctx.agentPresets.mount(agentCtx, presetInfo.id) },
      })
      this.handles.set(sessionId, handle)
      try {
        await workspace.attachSession(sessionId)
        try { ctx.permissionPresets.set(handle.agent.session, 'workspace-write') } catch (e) { ctx.logger.warn('workbench: permission preset not applied', e) }
        ctx.sessionTitle.rename(handle.agent.session, req.title)
        await this.sendFirstMessage(handle.agent, prompt, req)
      } catch (e) {
        this.runs.delete(sessionId)
        await handle.dispose().catch(() => {})
        throw e
      }
      return { sessionId }
    } finally {
      await scope[Symbol.asyncDispose]()
    }
  }

  /**
   * First message of a task. Plain: text + attached images/files as one user message. With a command: `/<cmd> <prompt>` through
   * the host's command channel (so /plan really enters plan mode), attachments travelling with the command.
   */
  private async sendFirstMessage(agent: any, prompt: string, req: Parameters<AgentDriver['start']>[0]) {
    const ctx = this.ctx
    const files = (req.attachments ?? []).map((f) => ({ ...f, base64: readFileSync(f.path).toString('base64') }))
    const attachments = ctx.get('attachments')
    if (req.command) {
      const commands = ctx.get('commands')
      if (!commands) throw new Error('当前 DSH 没有命令通道，不能执行 /' + req.command)
      const submitted: unknown[] = []
      for (const f of files) {
        if (IMAGE_TYPES.includes(f.mediaType)) submitted.push({ type: 'image', mediaType: f.mediaType, data: f.base64, name: f.name })
        else {
          const uploads = ctx.get('fileUploads')
          if (!uploads) throw new Error('当前 DSH 不支持上传文档，请只附图片')
          const up = await uploads.upload(agent, { data: f.base64, name: f.name }, new AbortController().signal)
          submitted.push({ type: 'file', receiptId: up.receiptId })
        }
      }
      const done = await commands.execute(agent, `/${req.command} ${prompt}`, submitted, new AbortController().signal)
      if (!done) throw new Error(`/${req.command} 在智能体预设里不可用`)
      if (done.result.kind === 'error') throw new Error(done.result.text)
      return
    }
    const parts: unknown[] = []
    if (attachments) {
      for (const f of files) {
        if (IMAGE_TYPES.includes(f.mediaType)) parts.push({ type: 'image', mediaType: f.mediaType, data: f.base64, name: f.name })
        else parts.push({ type: 'file', attachment: await attachments.admitEncodedFile({ data: f.base64, name: f.name }) })
      }
    }
    parts.push({ type: 'text', text: prompt })
    const content = attachments ? await attachments.admitPromptContent(parts) : parts
    agent.followup({ id: randomUUID(), role: 'user', content, source: { kind: 'user' } })
  }

  async send(sessionId: string, text: string, mode: 'queue' | 'steer') {
    const agent = this.handles.get(sessionId)?.agent ?? this.ctx.agents.get(sessionId)
    if (!agent) throw new Error(`会话 ${sessionId} 不在运行`)
    if (mode === 'steer') agent.steer(this.message(text))
    else agent.followup(this.message(text))
  }

  async interrupt(sessionId: string) {
    const agent = this.handles.get(sessionId)?.agent ?? this.ctx.agents.get(sessionId)
    agent?.cancel({ kind: 'user' })
  }

  onEvent(cb: (e: DriverEvent) => void) {
    this.cbs.add(cb)
    return () => { this.cbs.delete(cb) }
  }

  private emit(e: DriverEvent) { for (const cb of this.cbs) cb(e) }

  private message(text: string) {
    return { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
  }

  private onSessionEvent(sessionId: string, event: any) {
    const run = this.runs.get(sessionId)
    if (!run) return
    if (event.type === 'turn/start') {
      this.emit({ type: 'turn.started', runId: run.runId, sessionId })
    } else if (event.type === 'tool/call' && event.data?.name === 'exit_plan_mode') {
      this.emit({ type: 'awaiting.user', runId: run.runId, reason: '计划已提交，等待你批准或要求修改' })
    } else if (event.type === 'assistant/message') {
      const text = (event.data?.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      if (text) { run.lastText = text; this.emit({ type: 'message', runId: run.runId, text }) }
    } else if (event.type === 'turn/end') {
      const reason = event.data?.reason ?? {}
      const done = (status: 'completed' | 'interrupted' | 'failed', error?: string) =>
        this.emit({ type: 'turn.completed', runId: run.runId, status, finalText: run.lastText, error })
      switch (reason.kind) {
        case 'completed': done('completed'); break
        case 'aborted': case 'interrupted': done('interrupted'); break
        case 'error': done('failed', reason.error?.message ?? '会话出错'); break
        case 'max-tokens': done('failed', '达到输出长度上限'); break
        default: done('failed', `会话结束原因：${reason.kind ?? 'unknown'}`)
      }
    }
  }
}
