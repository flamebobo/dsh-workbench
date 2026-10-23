import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { join } from 'node:path'
import type { AgentDriver, DriverEvent } from './driver.ts'
import { paymentCoreFiles } from '../fixtures/demo-repo.ts'
import { demoGitlab, demoJenkins, demoZentao } from '../fixtures/demo.ts'
import { fetchGitlab } from './connectors/gitlab.ts'
import { fetchJenkins } from './connectors/jenkins.ts'
import type { ConnectorContext, Creds, FetchLike } from './connectors/http.ts'
import { fetchZentao } from './connectors/zentao.ts'
import { Store } from './store.ts'
import type { AgentProfile, Issue, Project, Run, Source, Status, WorkItem } from './types.ts'
import { STATUSES } from './types.ts'
import { builtinAgents } from './agents.ts'

export interface TodoResult {
  items: (WorkItem & { issueId?: string; issueStatus?: Status })[]
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
const ACTIVE: Status[] = ['todo', 'in_progress', 'in_review', 'blocked', 'backlog']

export interface WorkbenchOptions {
  store: Store
  driver: AgentDriver
  creds: Creds
  fetch?: FetchLike
}

export class Workbench {
  readonly store: Store
  private driver: AgentDriver
  private creds: Creds
  private fetch: FetchLike
  private off: () => void

  constructor(o: WorkbenchOptions) {
    this.store = o.store
    this.driver = o.driver
    this.creds = o.creds
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
    const items = lists.flat().sort((a, b) => rank[a.priority] - rank[b.priority]).map((w) => {
      const issue = this.issueForSource(w.source, w.ref)
      return { ...w, issueId: issue?.id, issueStatus: issue?.status }
    })
    return { items, sources }
  }

  private issueForSource(source: Source, ref: string) {
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

  buildPrompt(i: Pick<Issue, 'title' | 'description' | 'acceptance' | 'sourceRef'>, w?: WorkItem): string {
    const lines = [`# 任务：${i.title}`]
    if (i.sourceRef) lines.push(`来源：${i.sourceRef.source} ${i.sourceRef.ref}${w?.url ? `（${w.url}）` : ''}`)
    if (w) lines.push(`项目：${w.project}　优先级：${w.priority}${w.due ? `　截止：${w.due}` : ''}`)
    lines.push('', '## 背景', i.description || '（无）')
    lines.push('', '## 验收标准', ...(i.acceptance.length ? i.acceptance.map((a, n) => `${n + 1}. ${a}`) : ['（未给出，请先与我确认再动手）']))
    if (w?.related.length) lines.push('', '## 关联信息', ...w.related.map((r) => `- ${r.label}${r.detail ? `：${r.detail}` : ''}`))
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
    const { issue, run } = this.store.update((d) => {
      d.seq += 1
      d.issueSeq = (d.issueSeq ?? 0) + 1
      const t = now()
      const issue: Issue = {
        id: `iss_${d.seq}`, key: `WB-${d.issueSeq}`, title: item.title, description: item.description,
        acceptance: item.acceptance, status: 'in_progress', agentId: agent.id, projectId: project.id,
        sourceRef: { source: item.source, ref: item.ref }, createdAt: t, updatedAt: t,
      }
      const run: Run = { id: `run_${d.seq}`, issueId: issue.id, agentId: agent.id, status: 'running', startedAt: t }
      d.issues.push(issue); d.runs.push(run)
      return { issue, run }
    })
    try {
      const { sessionId } = await this.driver.start({
        runId: run.id, cwd: project.cwd, title: `${issue.key} ${item.title}`,
        prompt: this.buildPrompt(issue, item),
        profile: { presetId: agent.id, model: agent.model, instructions: agent.instructions },
      })
      return this.store.update((d) => {
        d.issues.find((i) => i.id === issue.id)!.sessionId = sessionId
        d.runs.find((r) => r.id === run.id)!.sessionId = sessionId
        return { issue: d.issues.find((i) => i.id === issue.id)!, run: d.runs.find((r) => r.id === run.id)! }
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
      if (issue && issue.status === 'in_progress') {
        issue.status = status === 'completed' ? 'in_review' : 'blocked'
        issue.note = status === 'completed' ? undefined : error ?? (status === 'interrupted' ? '会话被中断' : '会话出错')
        issue.updatedAt = now()
      }
    })
  }

  // ---------- issues ----------
  listIssues() { return this.store.data.issues }
  listRuns(issueId?: string) { return this.store.data.runs.filter((r) => !issueId || r.issueId === issueId) }

  createIssue(input: { title: string; description?: string; agentId?: string; projectId?: string; status?: Status }): Issue {
    if (!input.title.trim()) throw new WorkbenchError('invalid', '标题不能为空')
    if (input.status === 'done') throw new WorkbenchError('forbidden', '「已完成」只能由人在看板上设置')
    return this.store.update((d) => {
      d.seq += 1
      d.issueSeq = (d.issueSeq ?? 0) + 1
      const t = now()
      const issue: Issue = {
        id: `iss_${d.seq}`, key: `WB-${d.issueSeq}`, title: input.title.trim(), description: input.description ?? '', acceptance: [],
        status: input.status ?? 'backlog', agentId: input.agentId ?? 'fullstack', projectId: input.projectId, createdAt: t, updatedAt: t,
      }
      d.issues.push(issue)
      return issue
    })
  }

  updateIssue(id: string, patch: Partial<Pick<Issue, 'title' | 'description' | 'agentId' | 'projectId'>>) {
    return this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)
      if (!i) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
      Object.assign(i, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: now() })
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
    this.store.update((d) => { d.issues = d.issues.filter((i) => i.id !== id); d.runs = d.runs.filter((r) => r.issueId !== id) })
  }

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
    if (!p.name.trim() || !p.cwd.startsWith('/')) throw new WorkbenchError('invalid', '项目名称必填，工作目录必须是绝对路径')
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
      { name: '云支付 / payment-core', cwd: join(baseDir, 'payment-core'), zentaoProductId: 12 },
      { name: '订单服务 / teleone-order', cwd: join(baseDir, 'teleone-order'), gitlabProjectId: 101, zentaoProductId: 5 },
      { name: '订单服务 / order-service', cwd: join(baseDir, 'order-service'), jenkinsJob: 'order-service' },
      { name: '前端 / teleone-web', cwd: join(baseDir, 'teleone-web'), jenkinsJob: 'teleone-web' },
      { name: '认证中心 / auth', cwd: join(baseDir, 'auth-center'), zentaoProductId: 8 },
      { name: '数据中心 / report', cwd: join(baseDir, 'data-center'), zentaoProductId: 9 },
      { name: '基础设施 / infrastructure', cwd: join(baseDir, 'infrastructure'), gitlabProjectId: 77 },
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
