import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AgentDriver, DriverEvent } from './driver.ts'
import { paymentCoreFiles } from '../fixtures/demo-repo.ts'
import { demoGitlab, demoJenkins, demoZentao } from '../fixtures/demo.ts'
import { fetchGitlab } from './connectors/gitlab.ts'
import { fetchJenkins, jenkinsBuildState, listJenkinsJobs, triggerJenkinsBuild } from './connectors/jenkins.ts'
import { CONNECTIONS, testConnection, type SystemId } from './connectors/connections.ts'
import type { ConnectorContext, Creds, FetchLike } from './connectors/http.ts'
import { fetchZentao } from './connectors/zentao.ts'
import { Store } from './store.ts'
import { fuzzy, listFiles, mentionedFiles } from './files.ts'
import { DemoSparkin, suggestTask, type SparkinClient } from './sparkin.ts'
import type { AgentProfile, Attachment, Build, BuildState, CommandName, Issue, Priority, Project, Run, Source, Status, WorkItem } from './types.ts'
import { STATUSES } from './types.ts'
import { agentPersona, builtinAgents } from './agents.ts'

export interface TodoResult {
  items: (WorkItem & { issueId?: string; issueStatus?: Status; archived?: boolean })[]
  /** Per system: live data, demo fixtures, or demo fixtures after a live failure (with the error). */
  sources: Record<'zentao' | 'gitlab' | 'jenkins', { mode: 'live' | 'demo' | 'fallback'; error?: string }>
}

export class WorkbenchError extends Error {
  readonly code: 'duplicate' | 'not_found' | 'forbidden' | 'invalid'
  readonly issueId?: string
  constructor(code: 'duplicate' | 'not_found' | 'forbidden' | 'invalid', message: string, issueId?: string) {
    super(message)
    this.code = code
    this.issueId = issueId
  }
}

const now = () => new Date().toISOString()
const cleanLines = (l?: string[]) => (l ?? []).map((x) => x.trim()).filter(Boolean)
const COMMANDS: CommandName[] = ['plan', 'goal']
const MAX_UPLOAD = 25 * 1024 * 1024
const ACTIVE: Status[] = ['todo', 'in_progress', 'in_review', 'blocked', 'backlog']

export interface WorkbenchOptions {
  store: Store
  driver: AgentDriver
  creds: Creds
  /** Writes (or, with undefined, removes) one stored credential; the settings page uses it. DSH: ctx.credentials.set/unset. */
  setCred?: (name: string, value: string | undefined) => Promise<void>
  fetch?: FetchLike
  sparkin?: SparkinClient
  /** Milliseconds clock; tests move it to age simulated builds. */
  now?: () => number
}

export class Workbench {
  readonly store: Store
  private driver: AgentDriver
  private creds: Creds
  private setCred?: WorkbenchOptions['setCred']
  private clock: () => number
  readonly sparkin: SparkinClient
  private lastPoll = 0
  private fetch: FetchLike
  private off: () => void

  constructor(o: WorkbenchOptions) {
    this.store = o.store
    this.driver = o.driver
    this.creds = o.creds
    this.setCred = o.setCred
    this.clock = o.now ?? Date.now
    this.sparkin = o.sparkin ?? new DemoSparkin()
    this.fetch = o.fetch ?? ((u, i) => fetch(u, i))
    this.seedAgents()
    this.reconcileOrphans()
    this.off = this.driver.onEvent((e) => this.onDriverEvent(e))
  }

  dispose() { this.off() }

  private seedAgents() {
    const have = new Set(this.store.data.agents.map((a) => a.id))
    const missing = builtinAgents.filter((a) => !have.has(a.id))
    if (missing.length) this.store.update((d) => { d.agents.push(...missing) })
  }

  /** Host restarted while a run was in flight: the event stream is gone, so don't leave the card spinning. */
  private reconcileOrphans() {
    const running = this.store.data.runs.filter((r) => r.status === 'running')
    if (!running.length) return
    this.store.update((d) => {
      for (const r of d.runs.filter((x) => x.status === 'running')) {
        r.status = 'interrupted'; r.endedAt = now(); r.error = '宿主重启，会话事件已丢失'
        const issue = d.issues.find((i) => i.id === r.issueId)
        if (issue?.status === 'in_progress') { issue.status = 'blocked'; issue.note = r.error; issue.updatedAt = now() }
      }
    })
  }

  // ---------- todos ----------
  async listTodos(): Promise<TodoResult> {
    const ctx: ConnectorContext = {
      creds: this.creds,
      fetch: this.fetch,
      zentaoProductIds: this.store.data.projects.flatMap((p) => (p.zentaoProductId ? [p.zentaoProductId] : [])),
    }
    const sources = {} as TodoResult['sources']
    const pick = async (name: keyof TodoResult['sources'], live: () => Promise<WorkItem[] | undefined>, demo: WorkItem[]) => {
      try {
        const items = await live()
        if (items) { sources[name] = { mode: 'live' }; return items }
        sources[name] = { mode: 'demo' }
      } catch (e) {
        sources[name] = { mode: 'fallback', error: String((e as Error).message ?? e) }
      }
      return demo
    }
    const lists = await Promise.all([
      pick('zentao', () => fetchZentao(ctx), demoZentao),
      pick('gitlab', () => fetchGitlab(ctx), demoGitlab),
      pick('jenkins', () => fetchJenkins(ctx), demoJenkins),
    ])
    const rank = { P0: 0, P1: 1, P2: 2, P3: 3 }
    const projectName = (id?: string) => this.store.data.projects.find((p) => p.id === id)?.name ?? '未选择项目'
    const manual: WorkItem[] = this.store.data.issues.filter((i) => !i.sourceRef).map((i) => ({
      ref: i.key, source: 'manual' as const, title: i.title, priority: i.priority ?? 'P2', project: projectName(i.projectId),
      statusText: '手工任务', description: i.description, acceptance: i.acceptance, related: [],
    }))
    const items = [...lists.flat(), ...manual].sort((a, b) => rank[a.priority] - rank[b.priority]).map((w) => {
      const issue = this.issueForSource(w.source, w.ref)
      const hidden = (this.store.data.hiddenTodos ?? []).some((h) => h.source === w.source && h.ref === w.ref)
      return { ...w, issueId: issue?.id, issueStatus: issue?.status, archived: hidden || !!issue?.archivedAt }
    })
    return { items, sources }
  }

  private issueForSource(source: Source, ref: string) {
    if (source === 'manual') return this.store.data.issues.find((i) => !i.sourceRef && i.key === ref)
    return this.store.data.issues.find((i) => i.sourceRef?.source === source && i.sourceRef.ref === ref)
  }

  // ---------- start work ----------
  resolveProject(w: Pick<WorkItem, 'gitlabProjectId' | 'zentaoProductId' | 'jenkinsJob' | 'project'>): Project | undefined {
    const ps = this.store.data.projects
    return (
      ps.find((p) => p.gitlabProjectId != null && p.gitlabProjectId === w.gitlabProjectId) ??
      ps.find((p) => p.zentaoProductId != null && p.zentaoProductId === w.zentaoProductId) ??
      ps.find((p) => p.jenkinsJob && p.jenkinsJob === w.jenkinsJob) ??
      ps.find((p) => p.name === w.project)
    )
  }

  buildPrompt(i: Pick<Issue, 'title' | 'description' | 'acceptance' | 'sourceRef' | 'attachments'>, w?: WorkItem, files: string[] = [], agent?: Pick<AgentProfile, 'name' | 'description'>, predecessors: { key: string; title: string; summary?: string }[] = []): string {
    const lines = [`# 任务：${i.title}`]
    if (agent) lines.push(`指派给你的角色：${agent.name}（${agent.description}）`)
    if (i.sourceRef) lines.push(`来源：${i.sourceRef.source} ${i.sourceRef.ref}${w?.url ? `（${w.url}）` : ''}`)
    if (w) lines.push(`项目：${w.project}　优先级：${w.priority}${w.due ? `　截止：${w.due}` : ''}`)
    lines.push('', '## 背景', i.description || '（无）')
    lines.push('', '## 验收标准', ...(i.acceptance.length ? i.acceptance.map((a, n) => `${n + 1}. ${a}`) : ['（未给出，请先与我确认再动手）']))
    if (w?.related.length) lines.push('', '## 关联信息', ...w.related.map((r) => `- ${r.label}${r.detail ? `：${r.detail}` : ''}`))
    for (const p of predecessors) lines.push('', `## 前置任务 ${p.key} ${p.title}`, p.summary ? `它的结论（供你承接）：\n${p.summary}` : '（它没有留下文字结论，请先查看相关改动。）')
    if (files.length) lines.push('', '## 引用的项目文件（相对工作目录，请先阅读）', ...files.map((f) => `- ${f}`))
    if (i.attachments?.length) lines.push('', '## 附件（已随本消息附上）', ...i.attachments.map((a) => `- ${a.name}`))
    lines.push('', '请先阅读相关代码、说明你的方案，再实施。完成后总结改动与自测结果；不要自行判定「已完成」，由我验收。')
    return lines.join('\n')
  }

  /** 开工: one card per source ref; create it in_progress, start a session, then wire events back to the card. */
  async startWork(input: { item: WorkItem; agentId?: string }): Promise<{ issue: Issue; run: Run }> {
    const { item } = input
    const existing = this.issueForSource(item.source, item.ref)
    if (existing) throw new WorkbenchError('duplicate', `${item.ref} 已经开过卡片（${existing.key}）`, existing.id)
    const agent = this.agent(input.agentId ?? defaultAgentFor(item))
    const project = this.resolveProject(item)
    if (!project) throw new WorkbenchError('invalid', `「${item.project}」没有对应的项目工作目录，请先在「项目」页添加`)
    const issue = this.store.update((d) => {
      d.seq += 1
      d.issueSeq = (d.issueSeq ?? 0) + 1
      const t = now()
      const issue: Issue = {
        id: `iss_${d.seq}`, key: `WB-${d.issueSeq}`, title: item.title, description: item.description,
        acceptance: item.acceptance, status: 'todo', agentId: agent.id, projectId: project.id, priority: item.priority,
        sourceRef: { source: item.source, ref: item.ref }, createdAt: t, updatedAt: t,
      }
      d.issues.push(issue)
      return issue
    })
    return this.launch(issue.id, item)
  }

  /** 开工 on a card that already exists (manual tasks from the board, or a blocked card being retried). */
  async startIssue(id: string, agentId?: string): Promise<{ issue: Issue; run: Run }> {
    const issue = this.store.data.issues.find((i) => i.id === id)
    if (!issue) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
    if (issue.status === 'in_progress') throw new WorkbenchError('invalid', `${issue.key} 正在进行中`)
    if (issue.status === 'done') throw new WorkbenchError('invalid', `${issue.key} 已完成，不能再开工`)
    if (agentId && agentId !== issue.agentId) this.updateIssue(id, { agentId })
    return this.launch(id)
  }

  /** Cards whose `nextId` is this one, with the last finished run's final message as the hand-over. */
  private predecessorsOf(id: string) {
    return this.store.data.issues.filter((i) => i.nextId === id).map((i) => {
      const done = this.store.data.runs.filter((r) => r.issueId === i.id && r.status === 'completed' && r.finalText).at(-1)
      return { key: i.key, title: i.title, summary: done?.finalText?.slice(0, 1500) }
    })
  }

  private async launch(issueId: string, item?: WorkItem): Promise<{ issue: Issue; run: Run }> {
    const before = this.store.data.issues.find((i) => i.id === issueId)!
    const agent = this.agent(before.agentId)
    const project = this.store.data.projects.find((p) => p.id === before.projectId)
    if (!project) throw new WorkbenchError('invalid', `${before.key} 还没有选择项目（工作目录），请先在卡片里选择项目`)
    const run = this.store.update((d) => {
      d.seq += 1
      const t = now()
      const run: Run = { id: `run_${d.seq}`, issueId, agentId: agent.id, status: 'running', startedAt: t }
      d.runs.push(run)
      const i = d.issues.find((x) => x.id === issueId)!
      i.status = 'in_progress'; i.note = undefined; i.updatedAt = t
      return run
    })
    const issue = this.store.data.issues.find((i) => i.id === issueId)!
    try {
      const { sessionId } = await this.driver.start({
        runId: run.id, cwd: project.cwd, title: `${issue.key} ${issue.title}`,
        prompt: this.buildPrompt(issue, item, mentionedFiles(project.cwd, issue.description), agent, this.predecessorsOf(issue.id)),
        command: issue.command,
        attachments: (issue.attachments ?? []).map((a) => ({ name: a.name, mediaType: a.mediaType, path: this.uploadPath(a) })),
        profile: { presetId: agent.id, model: agent.model, instructions: agentPersona(agent) },
      })
      return this.store.update((d) => {
        d.issues.find((i) => i.id === issueId)!.sessionId = sessionId
        d.runs.find((r) => r.id === run.id)!.sessionId = sessionId
        return { issue: d.issues.find((i) => i.id === issueId)!, run: d.runs.find((r) => r.id === run.id)! }
      })
    } catch (e) {
      this.finishRun(run.id, 'failed', undefined, String((e as Error).message ?? e))
      throw e
    }
  }

  // ---------- driver events -> card state ----------
  onDriverEvent(e: DriverEvent) {
    if (e.type === 'turn.completed') {
      this.finishRun(e.runId, e.status, e.finalText, e.error)
    } else if (e.type === 'awaiting.user') {
      // The turn stays open until the human answers, so there is no turn/end to wait for: hand the card over now.
      this.store.update((d) => {
        const r = d.runs.find((x) => x.id === e.runId)
        const issue = r && r.status === 'running' ? d.issues.find((i) => i.id === r.issueId) : undefined
        if (issue?.status === 'in_progress') { issue.status = 'in_review'; issue.note = e.reason; issue.updatedAt = now() }
      })
    } else if (e.type === 'turn.started') {
      this.store.update((d) => {
        const r = d.runs.find((x) => x.id === e.runId)
        if (r && !r.sessionId) r.sessionId = e.sessionId
      })
    }
  }

  /** completed -> in_review; failed/interrupted -> blocked. Never touches `done`, and ignores stale runs. */
  private finishRun(runId: string, status: 'completed' | 'interrupted' | 'failed', finalText?: string, error?: string) {
    const run = this.store.data.runs.find((r) => r.id === runId)
    if (!run || run.status !== 'running') return
    this.store.update((d) => {
      const r = d.runs.find((x) => x.id === runId)!
      r.status = status; r.endedAt = now(); r.finalText = finalText; r.error = error
      const issue = d.issues.find((i) => i.id === r.issueId)
      if (issue && issue.status === 'in_review' && status === 'completed') issue.note = undefined
      if (issue && issue.status === 'in_progress') {
        issue.status = status === 'completed' ? 'in_review' : 'blocked'
        issue.note = status === 'completed' ? undefined : error ?? (status === 'interrupted' ? '会话被中断' : '会话出错')
        issue.updatedAt = now()
      }
    })
  }

  // ---------- connections (settings page) ----------
  private connectorCtx(): ConnectorContext {
    return { creds: this.creds, fetch: this.fetch, zentaoProductIds: this.store.data.projects.flatMap((p) => (p.zentaoProductId ? [p.zentaoProductId] : [])) }
  }

  /** Field definitions plus what is set. Secret values are never returned, only whether they are set. */
  async connections() {
    return Promise.all(CONNECTIONS.map(async (c) => {
      const fields = await Promise.all(c.fields.map(async (f) => {
        const v = await this.creds(f.key)
        return { ...f, set: !!v, value: f.secret ? undefined : v }
      }))
      return { id: c.id, label: c.label, configured: fields.filter((f) => !f.optional).every((f) => f.set), fields }
    }))
  }

  /** Secret fields left empty keep their stored value; other empty fields are removed. */
  async saveConnection(id: SystemId, values: Record<string, string | undefined>) {
    const def = CONNECTIONS.find((c) => c.id === id)
    if (!def) throw new WorkbenchError('not_found', `未知系统 ${id}`)
    if (!this.setCred) throw new WorkbenchError('invalid', '当前环境不支持保存凭据')
    for (const f of def.fields) {
      const raw = values[f.key]
      if (raw === undefined) continue
      const v = raw.trim()
      if (f.url && v && !/^https?:\/\//i.test(v)) throw new WorkbenchError('invalid', `${def.label}${f.label}必须以 http:// 或 https:// 开头`)
      if (v) await this.setCred(f.key, f.url ? v.replace(/\/+$/, '') : v)
      else if (!f.secret) await this.setCred(f.key, undefined)
    }
    return this.connections()
  }

  async clearConnection(id: SystemId) {
    const def = CONNECTIONS.find((c) => c.id === id)
    if (!def) throw new WorkbenchError('not_found', `未知系统 ${id}`)
    if (!this.setCred) throw new WorkbenchError('invalid', '当前环境不支持保存凭据')
    for (const f of def.fields) await this.setCred(f.key, undefined)
    return this.connections()
  }

  async testConnection(id: SystemId): Promise<{ ok: boolean; message: string }> {
    try { return { ok: true, message: await testConnection(id, this.connectorCtx()) } } catch (e) { return { ok: false, message: String((e as Error).message ?? e) } }
  }

  // ---------- Jenkins builds ----------
  /** Job names to build; the demo list is used until Jenkins is configured. */
  async jenkinsJobs(): Promise<{ jobs: string[]; mode: 'live' | 'demo' | 'fallback'; error?: string }> {
    const fromProjects = this.store.data.projects.flatMap((p) => (p.jenkinsJob ? [p.jenkinsJob] : []))
    const demo = [...new Set([...fromProjects.flatMap((j) => [`${j}-test`, `${j}-staging`]), ...fromProjects])].sort()
    try {
      const live = await listJenkinsJobs(this.connectorCtx())
      if (live) return { jobs: live, mode: 'live' }
    } catch (e) { return { jobs: demo, mode: 'fallback', error: String((e as Error).message ?? e) } }
    return { jobs: demo, mode: 'demo' }
  }

  listBuilds() { return this.store.data.builds ?? [] }

  /** Build one job once to verify a batch of cards; each card remembers the build. */
  async triggerBuild(input: { job: string; params?: Record<string, string>; issueIds: string[] }): Promise<Build> {
    const job = input.job.trim()
    if (!job) throw new WorkbenchError('invalid', '请选择要构建的 Job')
    const issueIds = input.issueIds.filter((id) => this.store.data.issues.some((i) => i.id === id))
    if (!issueIds.length) throw new WorkbenchError('invalid', '请至少选择一张卡片')
    const params = Object.fromEntries(Object.entries(input.params ?? {}).map(([k, v]) => [k.trim(), v]).filter(([k]) => k))
    let queueUrl: string | undefined
    let demo = false
    let error: string | undefined
    try {
      const r = await triggerJenkinsBuild(this.connectorCtx(), job, params).catch((e: Error) => {
        if (e.message === 'Jenkins 未配置') { demo = true; return {} as { queueUrl?: string } }
        throw e
      })
      queueUrl = r.queueUrl
    } catch (e) { error = String((e as Error).message ?? e) }
    const t = new Date(this.clock()).toISOString()
    return this.store.update((d) => {
      d.seq += 1
      const b: Build = {
        id: `bld_${d.seq}`, job, params: Object.keys(params).length ? params : undefined, issueIds,
        state: error ? 'error' : 'queued', demo: demo || undefined, queueUrl, error, createdAt: t, updatedAt: t,
      }
      ;(d.builds ??= []).push(b)
      return b
    })
  }

  /** Follow unfinished builds. Throttled, since the page polls; demo builds advance by age. */
  async refreshBuilds(): Promise<Build[]> {
    const pending = this.listBuilds().filter((b) => !['success', 'failure', 'unstable', 'aborted', 'error'].includes(b.state))
    if (!pending.length || this.clock() - this.lastPoll < 3000) return this.listBuilds()
    this.lastPoll = this.clock()
    const next = new Map<string, Partial<Build>>()
    for (const b of pending) {
      try {
        if (b.demo) {
          const age = this.clock() - Date.parse(b.createdAt)
          const state: BuildState = age < 4000 ? 'queued' : age < 16000 ? 'running' : 'success'
          next.set(b.id, { state, number: state === 'queued' ? undefined : 1000 + Number(b.id.slice(4)) })
        } else {
          const s = await jenkinsBuildState(this.connectorCtx(), b)
          next.set(b.id, { state: s.state, number: s.number, buildUrl: s.buildUrl })
        }
      } catch (e) { next.set(b.id, { state: 'error', error: String((e as Error).message ?? e) }) }
    }
    this.store.update((d) => {
      for (const b of d.builds ?? []) {
        const n = next.get(b.id)
        if (n && (n.state !== b.state || n.number !== b.number)) Object.assign(b, n, { updatedAt: new Date(this.clock()).toISOString() })
      }
    })
    return this.listBuilds()
  }

  // ---------- project files (@ mentions) ----------
  private fileIndex = new Map<string, { at: number; files: string[] }>()

  /** Fuzzy file search inside a project's working directory; the walk is cached for a few seconds while the user types. */
  searchFiles(projectId: string, query: string): string[] {
    const project = this.store.data.projects.find((p) => p.id === projectId)
    if (!project) throw new WorkbenchError('invalid', '请先选择项目')
    if (!existsSync(project.cwd)) throw new WorkbenchError('invalid', `工作目录不存在：${project.cwd}`)
    let idx = this.fileIndex.get(projectId)
    if (!idx || Date.now() - idx.at > 30_000) { idx = { at: Date.now(), files: listFiles(project.cwd) }; this.fileIndex.set(projectId, idx) }
    return fuzzy(idx.files, query)
  }

  // ---------- attachments ----------
  private get uploadsDir() { return join(dirname(this.store.path), 'uploads') }
  uploadPath(a: Pick<Attachment, 'id'>) { return join(this.uploadsDir, a.id) }

  saveUpload(input: { name: string; mediaType?: string; data: Uint8Array }): Attachment {
    if (input.data.byteLength === 0) throw new WorkbenchError('invalid', '文件为空')
    if (input.data.byteLength > MAX_UPLOAD) throw new WorkbenchError('invalid', `文件超过 ${MAX_UPLOAD / 1024 / 1024} MB 上限`)
    const att: Attachment = {
      id: randomUUID(), name: input.name.replace(/[\\/]/g, '_').slice(0, 200) || 'file',
      mediaType: input.mediaType || 'application/octet-stream', size: input.data.byteLength,
    }
    mkdirSync(this.uploadsDir, { recursive: true })
    writeFileSync(this.uploadPath(att), input.data)
    return att
  }

  /** Keep only a known command and attachments whose bytes are still on disk (the page is untrusted input). */
  private cleanExtras(x: { command?: string; attachments?: Attachment[] }) {
    if (x.command && !COMMANDS.includes(x.command as CommandName)) throw new WorkbenchError('invalid', `不支持的指令 /${x.command}`)
    const attachments = (x.attachments ?? []).filter((a) => /^[0-9a-f-]{36}$/.test(a.id) && existsSync(this.uploadPath(a)))
      .map(({ id, name, mediaType, size }) => ({ id, name, mediaType, size }))
    return { command: (x.command || undefined) as CommandName | undefined, attachments }
  }

  // ---------- issues ----------
  listIssues() { return this.store.data.issues }
  listRuns(issueId?: string) { return this.store.data.runs.filter((r) => !issueId || r.issueId === issueId) }

  createIssue(input: { title: string; description?: string; acceptance?: string[]; priority?: Priority; command?: string; attachments?: Attachment[]; agentId?: string; projectId?: string; status?: Status }): Issue {
    if (!input.title.trim()) throw new WorkbenchError('invalid', '标题不能为空')
    if (input.status === 'done') throw new WorkbenchError('forbidden', '「已完成」只能由人在看板上设置')
    const extras = this.cleanExtras(input)
    return this.store.update((d) => {
      d.seq += 1
      d.issueSeq = (d.issueSeq ?? 0) + 1
      const t = now()
      const issue: Issue = {
        id: `iss_${d.seq}`, key: `WB-${d.issueSeq}`, title: input.title.trim(), description: input.description ?? '', acceptance: cleanLines(input.acceptance),
        status: input.status ?? 'backlog', agentId: input.agentId ?? 'fullstack', projectId: input.projectId || undefined,
        priority: input.priority ?? 'P2', ...extras, createdAt: t, updatedAt: t,
      }
      d.issues.push(issue)
      return issue
    })
  }

  updateIssue(id: string, patch: Partial<Pick<Issue, 'title' | 'description' | 'acceptance' | 'priority' | 'agentId' | 'projectId'>> & { command?: string; attachments?: Attachment[] }) {
    const extras = 'command' in patch || patch.attachments ? this.cleanExtras(patch) : undefined
    return this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)
      if (!i) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
      const { projectId, acceptance, command: _c, attachments: _a, ...rest } = patch
      Object.assign(i, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), { updatedAt: now() })
      if (acceptance) i.acceptance = cleanLines(acceptance)
      if (extras) {
        if ('command' in patch) i.command = extras.command
        if (patch.attachments) i.attachments = extras.attachments
      }
      if (projectId !== undefined) i.projectId = projectId || undefined // '' clears the project
      return i
    })
  }

  /** Status changes from the board. `done` is a human decision, so only `actor: 'human'` (the UI) may set it. */
  setStatus(id: string, status: Status, actor: 'human' | 'system' = 'human') {
    if (!STATUSES.includes(status)) throw new WorkbenchError('invalid', `未知状态 ${status}`)
    if (status === 'done' && actor !== 'human') throw new WorkbenchError('forbidden', '「已完成」只能由人设置')
    return this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)
      if (!i) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
      i.status = status; i.updatedAt = now()
      if (status !== 'blocked') i.note = undefined
      return i
    })
  }

  deleteIssue(id: string) {
    for (const a of this.store.data.issues.find((i) => i.id === id)?.attachments ?? []) rmSync(this.uploadPath(a), { force: true })
    this.store.update((d) => {
      d.issues = d.issues.filter((i) => i.id !== id); d.runs = d.runs.filter((r) => r.issueId !== id)
      for (const i of d.issues) if (i.nextId === id) i.nextId = undefined
    })
  }

  // ---------- chain, archive ----------
  /** Point a card at the card to do after it (empty `nextId` clears it). A chain can't loop back on itself. */
  setNext(id: string, nextId: string) {
    const d = this.store.data
    if (!d.issues.some((i) => i.id === id)) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
    if (nextId) {
      if (!d.issues.some((i) => i.id === nextId)) throw new WorkbenchError('not_found', `后续任务 ${nextId} 不存在`)
      for (let cur: string | undefined = nextId, n = 0; cur && n < 1000; n++) {
        if (cur === id) throw new WorkbenchError('invalid', '后续任务不能指回链路上已有的任务（会形成环）')
        cur = d.issues.find((i) => i.id === cur)?.nextId
      }
    }
    return this.store.update((x) => { const i = x.issues.find((y) => y.id === id)!; i.nextId = nextId || undefined; i.updatedAt = now(); return i })
  }

  /** Create the follow-up card (same project / agent / priority as this one) and chain it. */
  createFollowUp(id: string, input: { title: string; description?: string }): Issue {
    const cur = this.store.data.issues.find((i) => i.id === id)
    if (!cur) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
    const next = this.createIssue({
      title: input.title, description: input.description ?? `承接 ${cur.key}「${cur.title}」`,
      projectId: cur.projectId, agentId: cur.agentId, priority: cur.priority, status: 'todo',
    })
    this.setNext(id, next.id)
    return next
  }

  archiveIssue(id: string, archived: boolean) {
    return this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)
      if (!i) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
      if (archived && i.status === 'in_progress') throw new WorkbenchError('invalid', `${i.key} 正在进行中，不能归档`)
      i.archivedAt = archived ? now() : undefined
      return i
    })
  }

  /** Archive every finished card at once; returns how many. */
  archiveDone(): number {
    return this.store.update((d) => {
      const done = d.issues.filter((i) => i.status === 'done' && !i.archivedAt)
      for (const i of done) i.archivedAt = now()
      return done.length
    })
  }

  /** Archive / restore a to-do row. Its card (if any) follows; Zentao / GitLab / Jenkins rows are remembered locally since the source still lists them. */
  archiveTodo(source: Source, ref: string, archived: boolean) {
    const issue = this.issueForSource(source, ref)
    if (issue) this.archiveIssue(issue.id, archived) // refuses a running card
    if (source === 'manual') return
    this.store.update((d) => {
      const rest = (d.hiddenTodos ?? []).filter((h) => !(h.source === source && h.ref === ref))
      d.hiddenTodos = archived ? [...rest, { source, ref, at: now() }] : rest
    })
  }

  // ---------- Sparkin time sheet ----------
  async sparkinInfo() {
    const projects = await this.sparkin.projects()
    const tasks = Object.fromEntries(await Promise.all(projects.map(async (p) => [p.id, await this.sparkin.tasks(p.id)] as const)))
    return { mode: this.sparkin.mode, projects, tasks }
  }

  /** Book hours for finished cards. Each entry succeeds or fails on its own; a card is reported once. */
  async reportTimesheet(input: { date: string; entries: { issueId: string; hours: number; taskId: string; note?: string }[] }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new WorkbenchError('invalid', '请选择工作日期')
    const info = await this.sparkinInfo()
    const taskById = new Map(Object.values(info.tasks).flat().map((t) => [t.id, t]))
    const results: { issueId: string; ok: boolean; error?: string; entryId?: string }[] = []
    for (const e of input.entries) {
      const issue = this.store.data.issues.find((i) => i.id === e.issueId)
      const fail = (error: string) => results.push({ issueId: e.issueId, ok: false, error })
      if (!issue) { fail('卡片不存在'); continue }
      if (issue.status !== 'done') { fail(`${issue.key} 还没有完成（「已完成」由你设置后才能填报工时）`); continue }
      if (issue.timesheet) { fail(`${issue.key} 已经填报过 ${issue.timesheet.hours}h`); continue }
      const task = taskById.get(e.taskId)
      if (!task) { fail(`${issue.key}：请选择 Sparkin 任务`); continue }
      if (!(e.hours > 0 && e.hours <= 24)) { fail(`${issue.key}：工时需在 0–24 小时之间`); continue }
      try {
        const note = e.note?.trim() || `${issue.key} ${issue.title}${issue.sourceRef ? `（${issue.sourceRef.ref}）` : ''}`
        const { entryId } = await this.sparkin.submit({ taskId: task.id, date: input.date, hours: e.hours, note })
        this.store.update((d) => {
          d.issues.find((i) => i.id === issue.id)!.timesheet = {
            hours: e.hours, date: input.date, sparkinTaskId: task.id, sparkinTaskName: task.name, entryId,
            reportedAt: new Date(this.clock()).toISOString(), demo: this.sparkin.mode === 'demo' || undefined,
          }
        })
        results.push({ issueId: issue.id, ok: true, entryId })
      } catch (err) { fail(`${issue.key}：${String((err as Error).message ?? err)}`) }
    }
    return results
  }

  suggestSparkinTask = suggestTask

  // ---------- agents & projects ----------
  listAgents() { return this.store.data.agents }
  agent(id: string): AgentProfile {
    const a = this.store.data.agents.find((x) => x.id === id)
    if (!a) throw new WorkbenchError('not_found', `智能体 ${id} 不存在`)
    return a
  }
  saveAgent(a: Pick<AgentProfile, 'id' | 'name' | 'description' | 'instructions' | 'model'>): AgentProfile {
    if (!a.name.trim()) throw new WorkbenchError('invalid', '名称不能为空')
    return this.store.update((d) => {
      const cur = d.agents.find((x) => x.id === a.id)
      if (cur) { Object.assign(cur, { name: a.name.trim(), description: a.description, instructions: a.instructions, model: a.model || undefined }); return cur }
      const created: AgentProfile = { ...a, name: a.name.trim(), model: a.model || undefined }
      d.agents.push(created)
      return created
    })
  }

  listProjects() { return this.store.data.projects }
  saveProject(p: Omit<Project, 'id'> & { id?: string }): Project {
    if (!p.name.trim() || !isAbsolute(p.cwd.trim())) throw new WorkbenchError('invalid', '项目名称必填，工作目录必须是绝对路径')
    return this.store.update((d) => {
      const clean = { ...p, name: p.name.trim(), cwd: p.cwd.trim() }
      const cur = p.id ? d.projects.find((x) => x.id === p.id) : undefined
      if (cur) { Object.assign(cur, clean); return cur }
      d.seq += 1
      const created: Project = { ...clean, id: `prj_${d.seq}` }
      d.projects.push(created)
      return created
    })
  }
  /** First run only: create demo working directories so the demo to-dos can be started without manual setup. */
  seedDemoProjects(baseDir: string) {
    if (this.store.data.projects.length) return
    const demo: Omit<Project, 'id'>[] = [
      { name: '云支付 / payment-core', cwd: join(baseDir, 'payment-core'), zentaoProductId: 12, sparkinProjectId: 'SP-PAY' },
      { name: '订单服务 / teleone-order', cwd: join(baseDir, 'teleone-order'), gitlabProjectId: 101, zentaoProductId: 5, sparkinProjectId: 'SP-ORDER' },
      { name: '订单服务 / order-service', cwd: join(baseDir, 'order-service'), jenkinsJob: 'order-service', sparkinProjectId: 'SP-ORDER' },
      { name: '前端 / teleone-web', cwd: join(baseDir, 'teleone-web'), jenkinsJob: 'teleone-web', sparkinProjectId: 'SP-WEB' },
      { name: '认证中心 / auth', cwd: join(baseDir, 'auth-center'), zentaoProductId: 8, sparkinProjectId: 'SP-AUTH' },
      { name: '数据中心 / report', cwd: join(baseDir, 'data-center'), zentaoProductId: 9, sparkinProjectId: 'SP-DATA' },
      { name: '基础设施 / infrastructure', cwd: join(baseDir, 'infrastructure'), gitlabProjectId: 77, sparkinProjectId: 'SP-INFRA' },
    ]
    for (const p of demo) {
      mkdirSync(p.cwd, { recursive: true })
      const files = p.name.endsWith('payment-core')
        ? paymentCoreFiles
        : { 'README.md': `# ${p.name}\n\n研发工作台演示用的空工作目录，请在「项目」页改成真实仓库路径。\n` }
      for (const [rel, text] of Object.entries(files)) {
        const f = join(p.cwd, rel)
        if (existsSync(f)) continue
        mkdirSync(dirname(f), { recursive: true })
        writeFileSync(f, text)
      }
      this.saveProject(p)
    }
  }

  deleteProject(id: string) { this.store.update((d) => { d.projects = d.projects.filter((p) => p.id !== id) }) }
}

/** Code review MRs go to 代码审查员, failed builds to 构建修复员, everything else to 全栈工程师. */
export function defaultAgentFor(w: Pick<WorkItem, 'source'>): string {
  return w.source === 'gitlab' ? 'reviewer' : w.source === 'jenkins' ? 'build-fixer' : 'fullstack'
}
