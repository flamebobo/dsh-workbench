import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AgentDriver, DriverEvent } from './driver.ts'
import { paymentCoreFiles } from '../fixtures/demo-repo.ts'
import { demoGitlab, demoJenkins, demoSparkin, demoZentao, isDemoItem } from '../fixtures/demo.ts'
import { createMergeRequest, fetchGitlab } from './connectors/gitlab.ts'
import { fetchJenkins, jenkinsBuildState, listJenkinsJobs, triggerJenkinsBuild } from './connectors/jenkins.ts'
import { CONNECTIONS, testConnection, type SystemId } from './connectors/connections.ts'
import type { ConnectorContext, Creds, FetchLike } from './connectors/http.ts'
import { fetchZentao, resolveBug } from './connectors/zentao.ts'
import { Store } from './store.ts'
import { fuzzy, listFiles, mentionedFiles } from './files.ts'
import * as g from './git.ts'
import { checkForUpdate, compareVersions } from './update.ts'
import { anonymousPayload, computeStats, exportRows, toCsv } from './stats.ts'
import { discoverSkills } from './skillpack.ts'
import { expandHome } from './onboarding.ts'
import { describeRepo, findRepos, parseRemote, suggestRoots, type RepoCandidate } from './onboarding.ts'
import { DemoSparkin, suggestTask, type SparkinClient } from './sparkin.ts'
import type { AgentProfile, Attachment, Build, BuildState, Check, CommandName, Data, Issue, Priority, Project, Run, Source, Status, WorkItem } from './types.ts'
import { STATUSES } from './types.ts'
import { agentPersona, builtinAgents } from './agents.ts'
import { normalizeSettings, type PluginSettings } from './settings.ts'

export interface TodoResult {
  items: (WorkItem & { issueId?: string; issueStatus?: Status; archived?: boolean })[]
  /** Per system: live data, demo fixtures (never configured), or an error (configured but the read failed: no rows, with the reason). */
  sources: Record<'zentao' | 'gitlab' | 'jenkins' | 'sparkin', { mode: 'live' | 'demo' | 'error' | 'none'; error?: string }>
  /** How many untouched demo cards were cleared by this pull (a source just turned live); the page says so once. */
  cleanedDemo?: number
}

/** Something worth interrupting the user for. Kept in memory only; the page asks for what is new since the last id it saw. */
export interface Notice { id: number; at: string; kind: 'review' | 'blocked' | 'writeback'; issueId: string; title: string; text: string }

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
const byOrder = (a: Issue, b: Issue) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt)

/** Put a card into `status` at the end, or just before `beforeId`, and renumber that column 1..n. */
function place(d: Data, issue: Issue, status: Status, beforeId?: string) {
  const was = issue.status
  issue.status = status
  // 完成时间: set when the card enters 已完成, cleared when it leaves, untouched by edits or reordering inside the column
  if (status === 'done' && was !== 'done') issue.doneAt = now()
  else if (status !== 'done') issue.doneAt = undefined
  const col = d.issues.filter((x) => x.status === status && x.id !== issue.id).sort(byOrder)
  const at = beforeId ? col.findIndex((x) => x.id === beforeId) : -1
  col.splice(at < 0 ? col.length : at, 0, issue)
  col.forEach((x, n) => { x.order = n + 1 })
}

const cleanLines = (l?: string[]) => (l ?? []).map((x) => x.trim()).filter(Boolean)
/** '' clears; otherwise a real calendar date as YYYY-MM-DD. */
function cleanDue(v: string): string {
  const s = v.trim()
  if (!s) return ''
  const day = new Date(`${s}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== s) throw new WorkbenchError('invalid', `截止日期要写成 YYYY-MM-DD：${v}`)
  return s
}
const cleanRelated = (l?: { label?: string; detail?: string }[]) =>
  (l ?? []).map((r) => ({ label: String(r.label ?? '').trim().slice(0, 200), detail: String(r.detail ?? '').trim().slice(0, 500) || undefined })).filter((r) => r.label).slice(0, 20)
const POLL_GIVE_UP = 10
/** A skill an agent or project can name: `kebab-name`, or a plugin's namespaced `plugin:kebab-name` (how Codex lists plugin skills). */
const AGENT_SKILL = /^([a-z0-9]+(-[a-z0-9]+)*:)?[a-z0-9]+(-[a-z0-9]+)*$/
const STOPPED = '已手动停止'
const COMMANDS: CommandName[] = ['plan', 'goal']
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
  /** Plugin version, shown in the UI and sent in anonymous reports. */
  version?: string
  /** Where the demo working directories live; turning demo mode on creates the demo projects there. */
  demoRepoDir?: string
}

export class Workbench {
  readonly store: Store
  private driver: AgentDriver
  private creds: Creds
  private setCred?: WorkbenchOptions['setCred']
  private clock: () => number
  readonly version: string
  readonly sparkin: SparkinClient
  private lastPoll = 0
  private notices: Notice[] = []
  private noticeSeq = 0
  /** Changes on every Host start, so a page that remembers ids from an earlier run knows to start over. */
  readonly boot = randomUUID()
  private demoRepoDir?: string
  private fetch: FetchLike
  private off: () => void

  constructor(o: WorkbenchOptions) {
    this.store = o.store
    this.driver = o.driver
    this.creds = o.creds
    this.setCred = o.setCred
    this.clock = o.now ?? Date.now
    this.version = o.version ?? 'dev'
    this.demoRepoDir = o.demoRepoDir
    this.sparkin = o.sparkin ?? new DemoSparkin()
    this.fetch = o.fetch ?? ((u, i) => fetch(u, i))
    this.store.onChange = (before, after) => this.collectNotices(before, after)
    this.seedAgents()
    this.normalizeOrders()
    this.reconcileOrphans()
    this.off = this.driver.onEvent((e) => this.onDriverEvent(e))
  }

  dispose() { this.off() }

  private busy = new Set<string>()
  /** Calls that write to an outside system must not overlap: a double click would otherwise write twice (two comments, two time entries). */
  private async once<T>(key: string, what: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) throw new WorkbenchError('invalid', `${what}正在进行，请稍候`)
    this.busy.add(key)
    try { return await fn() } finally { this.busy.delete(key) }
  }

  /** Cards saved before ordering existed get a position by age, once. */
  private normalizeOrders() {
    if (this.store.data.issues.every((i) => i.order != null)) return
    this.store.update((d) => {
      for (const st of STATUSES) d.issues.filter((i) => i.status === st).sort(byOrder).forEach((i, n) => { i.order = n + 1 })
    })
  }

  private seedAgents() {
    const have = new Set(this.store.data.agents.map((a) => a.id))
    const missing = builtinAgents.filter((a) => !have.has(a.id))
    if (missing.length) this.store.update((d) => { d.agents.push(...missing) })
  }

  /** Host restarted while a run was in flight: the event stream is gone, so don't leave the card spinning. */
  private reconcileOrphans() {
    const running = this.store.data.runs.filter((r) => r.status === 'running')
    const testing = this.store.data.issues.filter((i) => i.checks?.some((c) => c.state === 'running'))
    if (!running.length && !testing.length) return
    this.store.update((d) => {
      // a test run in flight when the Host stopped never reports back; leaving it "running" would refuse every re-run
      for (const i of d.issues) for (const c of i.checks ?? []) if (c.state === 'running') { c.state = 'failed'; c.output = '宿主重启，这次测试被中断，请重新运行' }
      for (const r of d.runs.filter((x) => x.status === 'running')) {
        r.status = 'interrupted'; r.endedAt = now(); r.error = '宿主重启，会话事件已丢失'
        const issue = d.issues.find((i) => i.id === r.issueId)
        if (issue?.status === 'in_progress') { place(d, issue, 'blocked'); issue.note = r.error; issue.updatedAt = now() }
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
    const demoOn = this.settings().demoMode
    const pick = async (name: keyof TodoResult['sources'], live: (c: ConnectorContext) => Promise<WorkItem[] | undefined>, demo: WorkItem[]) => {
      const warnings: string[] = []
      try {
        const items = await live({ ...ctx, warn: (m) => warnings.push(m) })
        if (items) { sources[name] = { mode: 'live', error: warnings.join('；') || undefined }; return items }
        sources[name] = { mode: demoOn ? 'demo' : 'none' }
        return demoOn ? demo : []
      } catch (e) {
        // configured but failing: show nothing rather than made-up rows next to the user's real work
        sources[name] = { mode: 'error', error: String((e as Error).message ?? e) }
        return []
      }
    }
    const lists = await Promise.all([
      pick('zentao', fetchZentao, demoZentao),
      pick('gitlab', fetchGitlab, demoGitlab),
      pick('jenkins', fetchJenkins, demoJenkins),
      pick('sparkin', async () => (this.sparkin.mode === 'live' ? await this.sparkin.assigned() : undefined), demoSparkin),
    ])
    const rank = { P0: 0, P1: 1, P2: 2, P3: 3 }
    const projectName = (id?: string) => this.store.data.projects.find((p) => p.id === id)?.name ?? '未选择项目'
    const manual: WorkItem[] = this.store.data.issues.filter((i) => !i.sourceRef).map((i) => ({
      ref: i.key, source: 'manual' as const, title: i.title, priority: i.priority ?? 'P2', project: projectName(i.projectId),
      statusText: '手工任务', description: i.description, acceptance: i.acceptance, related: i.related ?? [], due: i.due || undefined,
    }))
    const sorted = [...lists.flat(), ...manual].sort((a, b) => rank[a.priority] - rank[b.priority])
    for (const k of Object.keys(sources) as (keyof typeof sources)[]) this.sourceMode[k] = sources[k].mode
    const cleanedDemo = this.autoCleanDemo()
    this.syncBoard(sorted.filter((w) => w.source === 'manual' || sources[w.source].mode !== 'error'), sources)
    const items = sorted.map((w) => {
      const issue = this.issueForSource(w.source, w.ref)
      const hidden = (this.store.data.hiddenTodos ?? []).some((h) => h.source === w.source && h.ref === w.ref)
      // edits made on the card (title, priority, background, acceptance, project) win over the source system's copy
      const edited = issue?.sourceRef ? { title: issue.title, priority: issue.priority ?? w.priority, description: issue.description, acceptance: issue.acceptance, project: issue.projectId ? projectName(issue.projectId) : w.project, due: issue.due === undefined ? w.due : issue.due || undefined, related: issue.related ?? w.related } : {}
      return { ...w, ...edited, issueId: issue?.id, issueStatus: issue?.status, archived: hidden || !!issue?.archivedAt }
    })
    return { items, sources, cleanedDemo: cleanedDemo || undefined }
  }

  private sourceMode: Partial<Record<Source, 'live' | 'demo' | 'error' | 'none'>> = {}

  /** Demo cards whose system is now connected for real (nothing to do with the demo any more): the ones the user could still be using. */
  demoLeftovers(): string[] {
    return this.store.data.issues.filter((i) => i.demo && i.sourceRef && this.sourceMode[i.sourceRef.source] === 'live').map((i) => i.id)
  }

  /** A system just turned live: its demo cards that were never started, edited or finished are noise, so they go (once, silently). */
  private autoCleanDemo(): number {
    const d = this.store.data
    const ids = this.demoLeftovers().filter((id) => {
      const i = d.issues.find((x) => x.id === id)!
      return i.status !== 'done' && i.updatedAt === i.createdAt && !d.runs.some((r) => r.issueId === id)
    })
    return this.removeCards(ids)
  }

  /** The 清理演示卡片 button: every leftover demo card, except one with a session working right now. */
  cleanDemoCards(): number {
    const d = this.store.data
    return this.removeCards(this.demoLeftovers().filter((id) => !d.runs.some((r) => r.issueId === id && r.status === 'running')))
  }

  /**
   * The 清理演示项目和卡片 button: every demo card (except one with a session working right now), the simulated builds, and the demo
   * projects no remaining card uses. The demo working directories on disk stay.
   */
  removeDemoData(): { cards: number; projects: number } {
    const d = this.store.data
    const cards = this.removeCards(d.issues.filter((i) => i.demo && !d.runs.some((r) => r.issueId === i.id && r.status === 'running')).map((i) => i.id))
    let projects = 0
    this.store.update((x) => {
      x.builds = (x.builds ?? []).filter((b) => !b.demo)
      const dir = this.demoRepoDir
      const keep = x.projects.filter((p) => !dir || !p.cwd.startsWith(dir) || x.issues.some((i) => i.projectId === p.id))
      projects = x.projects.length - keep.length
      x.projects = keep
    })
    return { cards, projects }
  }

  /** Remove cards for good. Unlike a delete by the user this does not remember the item as "deleted on purpose". */
  private removeCards(ids: string[]): number {
    if (!ids.length) return 0
    const gone = this.store.data.issues.filter((i) => ids.includes(i.id))
    for (const i of gone) { void this.releaseWorktree(i); for (const a of i.attachments ?? []) rmSync(this.uploadPath(a), { force: true }) }
    this.store.update((d) => {
      d.issues = d.issues.filter((i) => !ids.includes(i.id)); d.runs = d.runs.filter((r) => !ids.includes(r.issueId))
      for (const i of d.issues) if (i.nextId && ids.includes(i.nextId)) i.nextId = undefined
    })
    return gone.length
  }

  /**
   * Put every to-do on the board (待规划) so the board shows everything on your plate, not only what was started. Source items
   * the user deleted the card of stay off; an untouched card whose item vanished from a live source is flagged (not removed).
   */
  private syncBoard(items: WorkItem[], sources: TodoResult['sources']) {
    if (!this.settings().syncTodosToBoard) return
    const d0 = this.store.data
    const hidden = (s: Source, r: string) => (d0.hiddenTodos ?? []).some((h) => h.source === s && h.ref === r)
    const gone = (s: Source, r: string) => (d0.unsynced ?? []).some((u) => u.source === s && u.ref === r)
    const fresh = items.filter((w) => w.source !== 'manual' && !this.issueForSource(w.source, w.ref) && !hidden(w.source, w.ref) && !gone(w.source, w.ref))
    const present = new Set(items.map((w) => `${w.source}:${w.ref}`))
    const MISSING = '来源系统里已不在你的待办中（可能已解决或改派）'
    const stale = d0.issues.filter((i) => i.sourceRef && i.status === 'backlog' && !present.has(`${i.sourceRef.source}:${i.sourceRef.ref}`) && sources[i.sourceRef.source as keyof typeof sources]?.mode === 'live' && !sources[i.sourceRef.source as keyof typeof sources]?.error && i.note !== MISSING)
    const back = d0.issues.filter((i) => i.note === MISSING && i.sourceRef && present.has(`${i.sourceRef.source}:${i.sourceRef.ref}`))
    if (!fresh.length && !stale.length && !back.length) return
    this.store.update((d) => {
      for (const w of fresh) this.addCard(d, w, 'backlog', this.settings().defaultAgents[w.source] ?? defaultAgentFor(w), this.resolveProject(w)?.id)
      for (const i of stale) { const x = d.issues.find((y) => y.id === i.id); if (x) x.note = MISSING }
      for (const i of back) { const x = d.issues.find((y) => y.id === i.id); if (x) x.note = undefined }
    })
  }

  private issueForSource(source: Source, ref: string) {
    if (source === 'manual') return this.store.data.issues.find((i) => !i.sourceRef && i.key === ref)
    return this.store.data.issues.find((i) => i.sourceRef?.source === source && i.sourceRef.ref === ref)
  }

  // ---------- start work ----------
  resolveProject(w: Pick<WorkItem, 'gitlabProjectId' | 'zentaoProductId' | 'jenkinsJob' | 'sparkinProjectId' | 'project'>): Project | undefined {
    const ps = this.store.data.projects
    return (
      ps.find((p) => p.gitlabProjectId != null && p.gitlabProjectId === w.gitlabProjectId) ??
      ps.find((p) => p.zentaoProductId != null && p.zentaoProductId === w.zentaoProductId) ??
      ps.find((p) => p.jenkinsJob && p.jenkinsJob === w.jenkinsJob) ??
      ps.find((p) => p.sparkinProjectId && p.sparkinProjectId === w.sparkinProjectId) ??
      ps.find((p) => p.name === w.project)
    )
  }

  buildPrompt(i: Pick<Issue, 'title' | 'description' | 'acceptance' | 'sourceRef' | 'attachments'>, w?: WorkItem, files: string[] = [], agent?: Pick<AgentProfile, 'name' | 'description' | 'skills'>, predecessors: { key: string; title: string; summary?: string }[] = []): string {
    const lines = [`# 任务：${i.title}`]
    if (agent) lines.push(`指派给你的角色：${agent.name}（${agent.description}）`)
    if (i.sourceRef) lines.push(`来源：${i.sourceRef.source} ${i.sourceRef.ref}${w?.url ? `（${w.url}）` : ''}`)
    if (w) lines.push(`项目：${w.project}　优先级：${w.priority}${w.due ? `　截止：${w.due}` : ''}`)
    lines.push('', '## 背景', i.description || '（无）')
    lines.push('', '## 验收标准', ...(i.acceptance.length ? i.acceptance.map((a, n) => `${n + 1}. ${a}`) : ['（未给出，请先与我确认再动手）']))
    if (w?.related.length) lines.push('', '## 关联信息', ...w.related.map((r) => `- ${r.label}${r.detail ? `：${r.detail}` : ''}`))
    if (agent?.skills?.length) lines.push('', '## 指定技能', `请按这些技能的说明工作：${agent.skills.map((k) => `/${k}`).join(' ')}`)
    for (const p of predecessors) lines.push('', `## 前置任务 ${p.key} ${p.title}`, p.summary ? `它的结论（供你承接）：\n${p.summary}` : '（它没有留下文字结论，请先查看相关改动。）')
    if (files.length) lines.push('', '## 引用的项目文件（相对工作目录，请先阅读）', ...files.map((f) => `- ${f}`))
    if (i.attachments?.length) lines.push('', '## 附件（已随本消息附上）', ...i.attachments.map((a) => `- ${a.name}`))
    lines.push('', '请先阅读相关代码、说明你的方案，再实施。完成后总结改动与自测结果；不要自行判定「已完成」，由我验收。')
    return lines.join('\n')
  }

  /** One card per source ref. `status` is where it lands: backlog for 「编辑」(just a local copy), todo right before 开工. */
  private noCardYet(item: WorkItem) {
    const existing = this.issueForSource(item.source, item.ref)
    if (existing) throw new WorkbenchError('duplicate', `${item.ref} 已经开过卡片（${existing.key}）`, existing.id)
  }

  /** Append a card for a source item to `d` (inside a store update). Clears a "deleted on purpose" mark: the user asked for it again. */
  private addCard(d: Data, item: WorkItem, status: Status, agentId: string, projectId?: string): Issue {
    d.seq += 1
    d.issueSeq = (d.issueSeq ?? 0) + 1
    const t = now()
    const issue: Issue = {
      id: `iss_${d.seq}`, key: `WB-${d.issueSeq}`, title: item.title, description: item.description,
      acceptance: item.acceptance, status, agentId, projectId, priority: item.priority,
      sourceRef: { source: item.source, ref: item.ref }, sparkinTaskId: item.sparkinTaskId, ...(isDemoItem(item) ? { demo: true } : {}),
      // copied so they can be edited on the card; the source's own values are only the starting point
      due: item.due ?? '', related: item.related, createdAt: t, updatedAt: t,
    }
    d.issues.push(issue); place(d, issue, status)
    d.unsynced = (d.unsynced ?? []).filter((u) => !(u.source === item.source && u.ref === item.ref))
    return issue
  }

  private cardFor(item: WorkItem, status: Status, agentId?: string, projectId?: string): Issue {
    this.noCardYet(item)
    const agent = this.agent(agentId ?? this.settings().defaultAgents[item.source] ?? defaultAgentFor(item))
    return this.store.update((d) => this.addCard(d, item, status, agent.id, projectId))
  }

  /** 编辑 a source item: make a local backlog card (the source system is never written) so it can be adjusted like any card. */
  adoptTodo(input: { item: WorkItem; agentId?: string }): Issue {
    return this.cardFor(input.item, 'backlog', input.agentId, this.resolveProject(input.item)?.id)
  }

  /** 开工: one card per source ref; create it, start a session, then wire events back to the card. */
  async startWork(input: { item: WorkItem; agentId?: string }): Promise<{ issue: Issue; run: Run }> {
    const { item } = input
    // the board sync may have made a card for it already: starting that card is the same as starting the item
    const existing = this.issueForSource(item.source, item.ref)
    if (existing && ['backlog', 'todo', 'blocked'].includes(existing.status) && !existing.archivedAt) {
      const project = existing.projectId ? undefined : this.resolveProject(item)
      if (project) this.updateIssue(existing.id, { projectId: project.id })
      return this.startIssue(existing.id, input.agentId)
    }
    this.noCardYet(item)
    const project = this.resolveProject(item)
    if (!project) throw new WorkbenchError('invalid', `「${item.project}」没有对应的项目工作目录，请先在「项目」页添加`)
    const issue = this.cardFor(item, 'todo', input.agentId, project.id)
    return this.launch(issue.id, item)
  }

  /** 开工 on a card that already exists (manual tasks from the board, or a blocked card being retried). */
  async startIssue(id: string, agentId?: string): Promise<{ issue: Issue; run: Run }> {
    const issue = this.store.data.issues.find((i) => i.id === id)
    if (!issue) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
    if (issue.status === 'in_progress') throw new WorkbenchError('invalid', `${issue.key} 正在进行中`)
    if (issue.status === 'done') throw new WorkbenchError('invalid', `${issue.key} 已完成，不能再开工`)
    // dragged out of 进行中 (or waiting on you in 待审核) while its session is alive: a second session would work on the same branch
    if (this.store.data.runs.some((r) => r.issueId === id && r.status === 'running')) throw new WorkbenchError('invalid', `${issue.key} 的会话还在运行，不能重复开工；等它结束，或先在 DSH 会话里中断`)
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

  /**
   * Where the agent works. A git project gets its own branch + worktree per task (so tasks never trample each other and the
   * diff is exactly this task's); a non-git or opted-out project is used in place. Failing to isolate fails the start loudly.
   */
  private async workDir(issueId: string, project: Project): Promise<string> {
    const issue = this.store.data.issues.find((i) => i.id === issueId)!
    if (issue.worktree && existsSync(issue.worktree)) return issue.worktree
    const s = this.settings()
    if (!(project.isolate ?? s.isolateByDefault) || !(await g.isGitRepo(project.cwd))) return project.cwd
    const base = project.baseBranch?.trim() || await g.defaultBase(project.cwd)
    const baseRef = (await g.branchExists(project.cwd, base)) ? base : `origin/${base}`
    // A card that has no branch yet never adopts a same-named one: after a data reset the keys start over at WB-1 while the repo may
    // still hold the old WB-1's branch (and its commits). A card that already has its branch (a retry) keeps it.
    const wanted = g.branchName(s.branchPrefix, issue.key, issue.title)
    let branch = issue.branch ?? wanted
    if (!issue.branch) for (let n = 2; await g.branchExists(project.cwd, branch); n++) branch = `${wanted}-${n}`
    const root = join(dirname(this.store.path), 'worktrees', project.id, issue.key) // next to the data file, never a global location
    let path = root
    for (let n = 2; existsSync(path); n++) path = `${root}-${n}` // a leftover directory from an earlier data file is neither reused nor deleted
    mkdirSync(dirname(path), { recursive: true })
    try { await g.addWorktree(project.cwd, branch, path, baseRef) } catch (e) {
      throw new Error(`创建任务分支「${branch}」失败：${(e as Error).message}（可在项目里关闭「分支隔离」直接在项目目录运行）`)
    }
    const baseSha = (await g.git(project.cwd, ['merge-base', baseRef, branch])).trim()
    this.store.update((d) => { Object.assign(d.issues.find((i) => i.id === issueId)!, { branch, worktree: path, baseBranch: base, baseSha }) })
    return path
  }

  /** Remove the task's checkout when nothing uncommitted would be lost; the branch stays. */
  private async releaseWorktree(issue: Issue) {
    const project = this.store.data.projects.find((p) => p.id === issue.projectId)
    if (issue.worktree && project && existsSync(issue.worktree)) await g.removeWorktree(project.cwd, issue.worktree)
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
      place(d, i, 'in_progress'); i.note = undefined; i.updatedAt = t
      return run
    })
    const issue = this.store.data.issues.find((i) => i.id === issueId)!
    // the agent's own skills plus the project's conventions, each named once
    const skills = [...new Set([...(agent.skills ?? []), ...(project.skills ?? [])])]
    try {
      const cwd = await this.workDir(issue.id, project)
      const { sessionId } = await this.driver.start({
        runId: run.id, cwd, title: `${issue.key} ${issue.title}`,
        prompt: this.buildPrompt(issue, item, mentionedFiles(cwd, issue.description), { ...agent, skills }, this.predecessorsOf(issue.id)),
        command: issue.command,
        attachments: (issue.attachments ?? []).map((a) => ({ name: a.name, mediaType: a.mediaType, path: this.uploadPath(a) })),
        profile: { presetId: agent.id, model: agent.model, effort: agent.effort, skills, instructions: agentPersona(agent) },
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
      void this.tick()
    } else if (e.type === 'awaiting.user') {
      // The turn stays open until the human answers, so there is no turn/end to wait for: hand the card over now.
      this.store.update((d) => {
        const r = d.runs.find((x) => x.id === e.runId)
        const issue = r && r.status === 'running' ? d.issues.find((i) => i.id === r.issueId) : undefined
        if (issue?.status === 'in_progress') { place(d, issue, 'in_review'); issue.note = e.reason; issue.updatedAt = now() }
      })
    } else if (e.type === 'turn.started') {
      this.store.update((d) => {
        const r = d.runs.find((x) => x.id === e.runId)
        if (!r) return
        if (!r.sessionId) r.sessionId = e.sessionId
        // The human kept talking in the session after it finished: the same run is working again, so the card follows it back.
        const issue = r.status !== 'running' ? d.issues.find((i) => i.id === r.issueId) : undefined
        const latest = issue && d.runs.filter((x) => x.issueId === issue.id).at(-1) === r
        if (issue && latest && (issue.status === 'in_review' || issue.status === 'blocked')) {
          r.status = 'running'; r.endedAt = undefined; r.error = undefined
          place(d, issue, 'in_progress'); issue.note = undefined; issue.updatedAt = now()
        }
      })
    } else if (e.type === 'message') {
      // After a plan / question was answered the agent speaks again within the same turn: the card is back in 进行中.
      this.store.update((d) => {
        const r = d.runs.find((x) => x.id === e.runId)
        const issue = r?.status === 'running' ? d.issues.find((i) => i.id === r.issueId) : undefined
        if (issue?.status === 'in_review') { place(d, issue, 'in_progress'); issue.note = undefined; issue.updatedAt = now() }
      })
    }
  }

  /** completed -> in_review; failed/interrupted -> blocked. Never touches `done`, and ignores stale runs. */
  private finishRun(runId: string, status: 'completed' | 'interrupted' | 'failed', finalText?: string, error?: string) {
    const run = this.store.data.runs.find((r) => r.id === runId)
    if (!run || run.status !== 'running') return
    let autoTest: string | undefined
    this.store.update((d) => {
      const r = d.runs.find((x) => x.id === runId)!
      r.status = status; r.endedAt = now(); r.finalText = finalText; r.error = error
      const issue = d.issues.find((i) => i.id === r.issueId)
      if (issue && issue.status === 'in_review' && status === 'completed') issue.note = undefined
      if (issue && issue.status === 'in_progress') {
        if (status === 'completed') autoTest = issue.id
        place(d, issue, status === 'completed' ? 'in_review' : 'blocked')
        issue.note = status === 'completed' ? undefined : error ?? (status === 'interrupted' ? '会话被中断' : '会话出错')
        issue.updatedAt = now()
      }
    })
    if (autoTest && this.settings().autoTestOnReview) {
      const iss = this.store.data.issues.find((i) => i.id === autoTest)
      if (this.store.data.projects.find((p) => p.id === iss?.projectId)?.testCmd?.trim()) void this.runChecks(autoTest).catch(() => {})
    }
  }

  /** The task's work differs from where it started (or, in a plain directory where that can't be told, assume it does). */
  private async hasChanges(issue: Issue): Promise<boolean> {
    const project = this.store.data.projects.find((p) => p.id === issue.projectId)
    try {
      if (issue.worktree && existsSync(issue.worktree) && issue.baseSha) return (await g.changes(issue.worktree, issue.baseSha)).files.length > 0
      if (project && (await g.isGitRepo(project.cwd))) return (await g.changes(project.cwd, 'HEAD')).files.length > 0
    } catch { /* can't tell: don't block the move */ }
    return true
  }

  /**
   * 待审核 -> 已完成 once the task's tests pass, if that is switched on. A failed or absent test leaves it for the human, and so does a
   * run that changed nothing: the agent may only have asked a question, and the existing tests pass anyway.
   */
  private async autoComplete(id: string, checkId: string) {
    if (!this.settings().autoDoneOnPass) return
    const issue = this.store.data.issues.find((i) => i.id === id)
    if (!issue || issue.status !== 'in_review') return
    if (issue.checks?.at(-1)?.id !== checkId || issue.checks.at(-1)!.state !== 'passed') return
    if (this.store.data.runs.some((r) => r.issueId === id && r.status === 'running')) return
    if (!(await this.hasChanges(issue))) {
      this.store.update((d) => { const i = d.issues.find((x) => x.id === id); if (i && i.status === 'in_review') i.note = '测试通过，但没有检测到代码改动，请你确认后验收' })
      return
    }
    // the human may have moved the card while the changes were being looked at
    if (this.store.data.issues.find((i) => i.id === id)?.status !== 'in_review') return
    this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)!
      place(d, i, 'done'); i.note = undefined; i.updatedAt = now()
    })
    this.afterDone(id)
  }

  /** Whatever finished a card (the human, or passing tests): optionally write a Zentao bug back, right away. */
  private afterDone(id: string) {
    if (this.settings().zentaoWriteBack === 'auto' && this.canWriteBack(id)) {
      void this.writeBackZentao(id).catch((e) => {
        this.store.update((d) => { const i = d.issues.find((x) => x.id === id); if (i) i.note = `回写禅道失败：${String((e as Error).message ?? e)}` })
      })
    }
  }

  // ---------- Zentao write-back ----------
  /** Only finished cards that came from a Zentao bug (not tasks / requirements), once. */
  canWriteBack(id: string): boolean {
    const i = this.store.data.issues.find((x) => x.id === id)
    return !!i && i.status === 'done' && !i.writeBack && i.sourceRef?.source === 'zentao' && /^BUG-\d+$/.test(i.sourceRef.ref)
  }

  /** The card was made from one of the built-in demo to-dos (same source, number and text), not from the user's real system. */
  private fromDemo(i: Issue): boolean { return i.demo === true }

  /** The comment that will be posted: what was done, how it was verified, where the change is. The human can edit it first. */
  async writeBackDraft(id: string): Promise<{ comment: string; mode: 'live' | 'demo' }> {
    const i = this.store.data.issues.find((x) => x.id === id)
    if (!i) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
    const check = i.checks?.at(-1)
    const summary = this.store.data.runs.filter((r) => r.issueId === id && r.status === 'completed' && r.finalText).at(-1)?.finalText
    const comment = [
      `已修复，由研发工作台任务 ${i.key} 完成。`,
      summary && `\n修复说明：\n${summary.slice(0, 1500)}`,
      check && `\n验证：${check.cmd} ${check.state === 'passed' ? '通过' : '未通过'}`,
      i.branch && `分支：${i.branch}`,
      i.mr && `合并请求：${i.mr.url}`,
    ].filter(Boolean).join('\n')
    return { comment, mode: (await this.creds('WORKBENCH_ZENTAO_URL')) ? 'live' : 'demo' }
  }

  /**
   * Resolve the bug in Zentao (status 已解决, resolution 已修复) with a comment. Outward-facing: runs from an explicit click,
   * or automatically only if the 回写 setting says so. Without Zentao credentials nothing is sent and the record says 演示.
   */
  writeBackZentao(id: string, comment?: string): Promise<Issue> {
    return this.once(`writeback:${id}`, '回写禅道', () => this.doWriteBackZentao(id, comment))
  }

  private async doWriteBackZentao(id: string, comment?: string): Promise<Issue> {
    const issue = this.store.data.issues.find((i) => i.id === id)
    if (!issue) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
    if (issue.writeBack) throw new WorkbenchError('invalid', `${issue.key} 已经回写过禅道`)
    if (!this.canWriteBack(id)) throw new WorkbenchError('invalid', '只有已完成、来自禅道 Bug 的任务才能回写禅道')
    // demo cards keep a made-up number like BUG-4821; once Zentao is connected that number may be a different, real bug
    if (this.fromDemo(issue) && (await this.creds('WORKBENCH_ZENTAO_URL'))) throw new WorkbenchError('invalid', `${issue.key} 来自演示数据，不是你禅道里的 Bug，不会回写到真实禅道（可以删除这张卡片）`)
    const text = (comment ?? (await this.writeBackDraft(id)).comment).trim()
    if (!text) throw new WorkbenchError('invalid', '回写的评论不能为空')
    const bugId = Number(/^BUG-(\d+)$/.exec(issue.sourceRef!.ref)![1])
    const live = await resolveBug(this.connectorCtx(), bugId, text)
    return this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)!
      i.writeBack = { at: new Date(this.clock()).toISOString(), comment: text, status: 'resolved', demo: live ? undefined : true }
      if (i.note?.startsWith('回写禅道失败')) i.note = undefined
      return i
    })
  }

  // ---------- plugin settings ----------
  settings(): PluginSettings { return normalizeSettings(this.store.data.settings) }

  saveSettings(patch: Partial<PluginSettings>): PluginSettings {
    const next = normalizeSettings({ ...this.store.data.settings, ...patch, defaultAgents: { ...this.settings().defaultAgents, ...patch.defaultAgents } })
    // normalizing drops a malformed address to '' (= off); say so instead of "saving" something the user did not type
    for (const [k, label] of [['updateCheckUrl', '更新地址'], ['statsReportUrl', '上报地址']] as const) {
      if (typeof patch[k] === 'string' && patch[k]!.trim() && !next[k]) throw new WorkbenchError('invalid', `${label}必须以 http:// 或 https:// 开头`)
    }
    for (const [src, id] of Object.entries(next.defaultAgents)) if (!this.store.data.agents.some((a) => a.id === id)) throw new WorkbenchError('invalid', `默认智能体「${id}」（${src}）不存在`)
    const wasDemo = this.settings().demoMode
    this.store.update((d) => { d.settings = next })
    if (next.demoMode && !wasDemo && this.demoRepoDir) this.seedDemoProjects(this.demoRepoDir, false) // demo to-dos need the demo projects
    void this.tick()
    return next
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
  async jenkinsJobs(): Promise<{ jobs: string[]; mode: 'live' | 'demo' | 'error' | 'none'; error?: string }> {
    const fromProjects = this.store.data.projects.flatMap((p) => (p.jenkinsJob ? [p.jenkinsJob] : []))
    const demo = [...new Set([...fromProjects.flatMap((j) => [`${j}-test`, `${j}-staging`]), ...fromProjects])].sort()
    try {
      const live = await listJenkinsJobs(this.connectorCtx())
      if (live) return { jobs: live, mode: 'live' }
    } catch (e) { return { jobs: [], mode: 'error', error: String((e as Error).message ?? e) } }
    return this.settings().demoMode ? { jobs: demo, mode: 'demo' } : { jobs: [], mode: 'none' }
  }

  listBuilds() { return this.store.data.builds ?? [] }
  private pollFails = new Map<string, number>()

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
        if (e.message === 'Jenkins 未配置' && this.settings().demoMode) { demo = true; return {} as { queueUrl?: string } }
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
        this.pollFails.delete(b.id)
      } catch (e) {
        // a network blip is not the end of the build: only give up after several polls in a row failed
        const n = (this.pollFails.get(b.id) ?? 0) + 1
        this.pollFails.set(b.id, n)
        if (n >= POLL_GIVE_UP) next.set(b.id, { state: 'error', error: `连续 ${n} 次查询构建状态失败：${String((e as Error).message ?? e)}` })
      }
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
    return fuzzy(idx.files, query, this.settings().fileSearchLimit)
  }

  // ---------- attachments ----------
  private get uploadsDir() { return join(dirname(this.store.path), 'uploads') }
  uploadPath(a: Pick<Attachment, 'id'>) { return join(this.uploadsDir, a.id) }

  saveUpload(input: { name: string; mediaType?: string; data: Uint8Array }): Attachment {
    if (input.data.byteLength === 0) throw new WorkbenchError('invalid', '文件为空')
    const maxMB = this.settings().maxUploadMB
    if (input.data.byteLength > maxMB * 1024 * 1024) throw new WorkbenchError('invalid', `文件超过 ${maxMB} MB 上限（可在设置 → 插件设置里调整）`)
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

  createIssue(input: { title: string; description?: string; acceptance?: string[]; priority?: Priority; command?: string; attachments?: Attachment[]; agentId?: string; projectId?: string; status?: Status; due?: string; related?: { label: string; detail?: string }[] }): Issue {
    if (!input.title.trim()) throw new WorkbenchError('invalid', '标题不能为空')
    if (input.status === 'done') throw new WorkbenchError('forbidden', '「已完成」只能由人在看板上设置')
    if (input.status === 'in_progress') throw new WorkbenchError('invalid', '「进行中」由开工自动设置，不能直接建在这一列；请点「创建并开工」')
    const extras = this.cleanExtras(input)
    const due = input.due === undefined ? undefined : cleanDue(input.due)
    const created = this.store.update((d) => {
      d.seq += 1
      d.issueSeq = (d.issueSeq ?? 0) + 1
      const t = now()
      const issue: Issue = {
        id: `iss_${d.seq}`, key: `WB-${d.issueSeq}`, title: input.title.trim(), description: input.description ?? '', acceptance: cleanLines(input.acceptance),
        status: input.status ?? 'backlog', agentId: input.agentId ?? 'fullstack', projectId: input.projectId || undefined,
        priority: input.priority ?? 'P2', ...extras, ...(due ? { due } : {}), ...(input.related ? { related: cleanRelated(input.related) } : {}), createdAt: t, updatedAt: t,
      }
      d.issues.push(issue); place(d, issue, issue.status)
      return issue
    })
    void this.tick()
    return created
  }

  updateIssue(id: string, patch: Partial<Pick<Issue, 'title' | 'description' | 'acceptance' | 'priority' | 'agentId' | 'projectId' | 'due' | 'related'>> & { command?: string; attachments?: Attachment[] }) {
    const due = patch.due === undefined ? undefined : cleanDue(patch.due)
    const extras = 'command' in patch || patch.attachments ? this.cleanExtras(patch) : undefined
    return this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)
      if (!i) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
      const { projectId, acceptance, command: _c, attachments: _a, due: _d, related, ...rest } = patch
      Object.assign(i, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), { updatedAt: now() })
      if (acceptance) i.acceptance = cleanLines(acceptance)
      if (due !== undefined) i.due = due // '' stays '' so a source item's date is not brought back
      if (related) i.related = cleanRelated(related)
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
    return this.moveIssue(id, status, undefined, actor)
  }

  /** Drag on the board: into `status`, at the end or just before `beforeId` (that is how a column is reordered). */
  moveIssue(id: string, status: Status, beforeId?: string, actor: 'human' | 'system' = 'human') {
    if (!STATUSES.includes(status)) throw new WorkbenchError('invalid', `未知状态 ${status}`)
    if (status === 'done' && actor !== 'human') throw new WorkbenchError('forbidden', '「已完成」只能由人设置')
    const moved = this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)
      if (!i) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
      const before = i.status
      if (beforeId === id && before === status) return i // dropped on itself: stays put
      // 进行中 means a session is working: only 开工 / the session itself put a card there
      if (status === 'in_progress' && before !== status) throw new WorkbenchError('invalid', '「进行中」由开工自动设置，不能手动拖入；请点「开工」')
      place(d, i, status, beforeId === id ? undefined : beforeId)
      if (before !== status) i.updatedAt = now()
      if (status !== 'blocked') i.note = undefined
      return i
    })
    if (status === 'done') this.afterDone(id)
    void this.tick() // a card dropped into 待办 may be next in line
    return moved
  }

  // ---------- auto-run ----------
  get autoRun() { return !!this.store.data.autoRun }

  setAutoRun(enabled: boolean) {
    this.store.update((d) => { d.autoRun = enabled })
    void this.tick()
    return this.autoRun
  }

  /** Agents working right now (a plan waiting for approval doesn't count: the human is the bottleneck there). */
  workingCount() {
    const d = this.store.data
    return d.runs.filter((r) => r.status === 'running' && d.issues.find((i) => i.id === r.issueId)?.status === 'in_progress').length
  }

  private tickP?: Promise<void>
  private again = false

  /** In auto-run, keep starting the top card of 待办 until `concurrency` agents are working. Safe to call often. */
  tick(): Promise<void> {
    if (this.tickP) { this.again = true; return this.tickP }
    this.tickP = (async () => {
      do { this.again = false; await this.runTick() } while (this.again)
    })().finally(() => { this.tickP = undefined })
    return this.tickP
  }

  private async runTick() {
    for (let n = 0; n < 50 && this.autoRun && this.workingCount() < this.settings().autoRunConcurrency; n++) {
      const d = this.store.data
      // a card whose session is still alive (dragged back from 进行中) or being stopped can't start: skip it, don't park it
      const live = (id: string) => this.busy.has(`stop:${id}`) || d.runs.some((r) => r.issueId === id && r.status === 'running')
      const queue = d.issues.filter((i) => i.status === 'todo' && !i.archivedAt && !live(i.id)).sort(byOrder)
      // a card with no (or a deleted) project can't run; say so on the card and move on to the next one
      const ready = queue.find((i) => d.projects.some((p) => p.id === i.projectId))
      for (const i of queue.filter((x) => x !== ready && !d.projects.some((p) => p.id === x.projectId) && !x.note)) {
        this.store.update((x) => { const c = x.issues.find((y) => y.id === i.id); if (c) c.note = '自动运行已跳过：请先选择项目' })
      }
      if (!ready) return
      try { await this.startIssue(ready.id) } catch (e) {
        // never retry the same card in a loop: park it as blocked with the reason
        this.store.update((x) => {
          const c = x.issues.find((y) => y.id === ready.id)
          if (c && c.status === 'todo') { place(x, c, 'blocked'); c.note = `自动运行启动失败：${String((e as Error).message ?? e)}`; c.updatedAt = now() }
        })
      }
    }
  }

  /** 停止: interrupt the card's running session and park the card as 已阻塞 ("已手动停止"); 重试 starts it again. */
  stopIssue(id: string): Promise<Issue> {
    return this.once(`stop:${id}`, '停止', () => this.doStop(id))
  }

  private async doStop(id: string): Promise<Issue> {
    const issue = this.store.data.issues.find((i) => i.id === id)
    if (!issue) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
    const run = this.store.data.runs.filter((r) => r.issueId === id && r.status === 'running').at(-1)
    if (issue.status !== 'in_progress' || !run) throw new WorkbenchError('invalid', `${issue.key} 没有正在运行的会话`)
    // record the stop first: the session reports its own end right after the interrupt, and that must not rewrite the reason
    this.store.update((d) => {
      const r = d.runs.find((x) => x.id === run.id)!
      r.status = 'interrupted'; r.endedAt = now(); r.error = STOPPED
      const i = d.issues.find((x) => x.id === id)!
      place(d, i, 'blocked'); i.note = STOPPED; i.updatedAt = now()
    })
    if (run.sessionId) {
      try { await this.driver.interrupt(run.sessionId) } catch (e) {
        // the card is parked either way; say that the session could not be reached so the user checks it in DSH
        this.store.update((d) => { const i = d.issues.find((x) => x.id === id); if (i) i.note = `${STOPPED}（但没能通知会话：${String((e as Error).message ?? e)}，请到 DSH 里确认它已结束）` })
      }
    }
    return this.store.data.issues.find((i) => i.id === id)!
  }

  deleteIssue(id: string) {
    const gone = this.store.data.issues.find((i) => i.id === id)
    if (gone) void this.releaseWorktree(gone)
    for (const a of this.store.data.issues.find((i) => i.id === id)?.attachments ?? []) rmSync(this.uploadPath(a), { force: true })
    this.store.update((d) => {
      // a card from a source item that was deleted on purpose must not come back with the next to-do pull
      if (gone?.sourceRef) d.unsynced = [...(d.unsynced ?? []), { source: gone.sourceRef.source, ref: gone.sourceRef.ref }]
      d.issues = d.issues.filter((i) => i.id !== id); d.runs = d.runs.filter((r) => r.issueId !== id)
      for (const i of d.issues) if (i.nextId === id) i.nextId = undefined
    })
  }

  // ---------- review: changes, tests, merge request ----------
  private workspaceOf(issue: Issue, project: Project) {
    return issue.worktree && existsSync(issue.worktree) ? issue.worktree : project.cwd
  }

  private ctxOf(id: string) {
    const issue = this.store.data.issues.find((i) => i.id === id)
    if (!issue) throw new WorkbenchError('not_found', `卡片 ${id} 不存在`)
    const project = this.store.data.projects.find((p) => p.id === issue.projectId)
    if (!project) throw new WorkbenchError('invalid', `${issue.key} 没有关联项目`)
    return { issue, project }
  }

  /** What the agent changed: against the task branch's base when it has one, else the project's uncommitted changes. */
  async issueChanges(id: string) {
    const { issue, project } = this.ctxOf(id)
    if (issue.worktree && existsSync(issue.worktree) && issue.baseSha) {
      return { ...(await g.changes(issue.worktree, issue.baseSha)), branch: issue.branch, base: issue.baseBranch, isolated: true }
    }
    if (await g.isGitRepo(project.cwd)) {
      const branch = (await g.git(project.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      return { ...(await g.changes(project.cwd, 'HEAD')), branch, base: 'HEAD', isolated: false }
    }
    throw new WorkbenchError('invalid', '这个任务的项目不是 git 仓库，无法查看改动')
  }

  /** Run the project's test command against this task's work, in the background; poll the card for the result. */
  async runChecks(id: string): Promise<Check> {
    const { issue, project } = this.ctxOf(id)
    const cmd = project.testCmd?.trim()
    if (!cmd) throw new WorkbenchError('invalid', `项目「${project.name}」还没有配置测试命令（项目 → 编辑）`)
    if (issue.checks?.some((c) => c.state === 'running')) throw new WorkbenchError('invalid', '测试正在运行')
    const cwd = this.workspaceOf(issue, project)
    const check = this.store.update((d) => {
      d.seq += 1
      const c: Check = { id: `chk_${d.seq}`, cmd, state: 'running', output: '', at: now() }
      const i = d.issues.find((x) => x.id === id)!
      i.checks = [...(i.checks ?? []).slice(-4), c]
      return c
    })
    void g.runShell(cmd, cwd, this.settings().testTimeoutSeconds * 1000).then((r) => {
      this.store.update((d) => {
        const i = d.issues.find((x) => x.id === id)
        const c = i?.checks?.find((x) => x.id === check.id)
        if (!i || !c) return
        c.state = r.code === 0 ? 'passed' : 'failed'; c.code = r.code; c.ms = r.ms
        c.output = r.timedOut ? `（超过 ${this.settings().testTimeoutSeconds} 秒，已终止）\n${r.output}` : r.output
        if (c.state === 'failed') i.note = r.timedOut ? '测试超时' : `测试未通过（退出码 ${r.code}）`
        else if (i.note?.startsWith('测试')) i.note = undefined
      })
      void this.autoComplete(id, check.id).catch(() => {})
    })
    return check
  }

  /**
   * Commit the task's work, push its branch and open a GitLab merge request. Outward-facing: only called from an explicit click.
   * Pushing uses the git credentials already on this machine; the GitLab token is only used for the API call.
   */
  submitMergeRequest(id: string): Promise<Issue> {
    return this.once(`mr:${id}`, '提交合并请求', () => this.doSubmitMergeRequest(id))
  }

  private async doSubmitMergeRequest(id: string): Promise<Issue> {
    const { issue, project } = this.ctxOf(id)
    if (issue.mr) throw new WorkbenchError('invalid', `${issue.key} 已经提交过合并请求：${issue.mr.url}`)
    if (!issue.branch || !issue.worktree || !existsSync(issue.worktree) || !issue.baseSha) {
      throw new WorkbenchError('invalid', '只有在独立任务分支上完成的任务才能提交合并请求（项目需要是 git 仓库并开启分支隔离）')
    }
    if (issue.status === 'in_progress') throw new WorkbenchError('invalid', `${issue.key} 正在进行中`)
    if (project.gitlabProjectId == null) throw new WorkbenchError('invalid', `请先在项目「${project.name}」里填写 GitLab 项目 ID`)
    if (!(await g.remoteUrl(project.cwd))) throw new WorkbenchError('invalid', `项目「${project.name}」的仓库没有 origin 远程，无法推送`)
    const ctx = this.connectorCtx()
    if (!(await this.creds('WORKBENCH_GITLAB_URL')) || !(await this.creds('WORKBENCH_GITLAB_TOKEN'))) throw new WorkbenchError('invalid', 'GitLab 未配置（设置 → GitLab）')

    const ref = issue.sourceRef?.ref ?? issue.key
    const lastCheck = issue.checks?.at(-1)
    const summary = this.store.data.runs.filter((r) => r.issueId === id && r.status === 'completed' && r.finalText).at(-1)?.finalText
    const description = [
      `**来源**：${issue.sourceRef ? `${issue.sourceRef.source} ${issue.sourceRef.ref}` : '研发工作台手工任务'}（${issue.key}）`,
      issue.description && `\n## 背景\n${issue.description}`,
      issue.acceptance.length && `\n## 验收标准\n${issue.acceptance.map((a) => `- [ ] ${a}`).join('\n')}`,
      lastCheck && `\n## 测试\n\`${lastCheck.cmd}\`：${lastCheck.state === 'passed' ? '通过' : lastCheck.state === 'failed' ? `未通过（退出码 ${lastCheck.code}）` : '运行中'}`,
      summary && `\n## 智能体总结\n${summary.slice(0, 4000)}`,
      '\n---\n由研发工作台创建，请人工评审后合并。',
    ].filter(Boolean).join('\n')

    try {
      await g.commitAll(issue.worktree, `${ref} ${issue.title}\n\n研发工作台任务 ${issue.key}`)
      if ((await g.commitsAhead(issue.worktree, issue.baseSha)) === 0) throw new WorkbenchError('invalid', '这个任务分支相对基线没有任何改动，没有可提交的内容')
      await g.push(issue.worktree, issue.branch)
    } catch (e) {
      if (e instanceof WorkbenchError) throw e
      throw new WorkbenchError('invalid', `推送分支失败：${(e as Error).message}`)
    }
    let mr
    try {
      mr = await createMergeRequest(ctx, project.gitlabProjectId, { source: issue.branch, target: issue.baseBranch ?? 'main', title: `${ref} ${issue.title}`, description })
    } catch (e) { throw new WorkbenchError('invalid', `分支已推送，但${(e as Error).message}`) }
    return this.store.update((d) => {
      const i = d.issues.find((x) => x.id === id)!
      i.mr = { url: mr.url, iid: mr.iid, createdAt: now() }; i.updatedAt = now()
      return i
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
      // a to-do hidden through 「归档」 on the to-do list must come back when the card is restored here
      if (!archived && i.sourceRef) d.hiddenTodos = (d.hiddenTodos ?? []).filter((h) => !(h.source === i.sourceRef!.source && h.ref === i.sourceRef!.ref))
      if (archived) void this.releaseWorktree(i)
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
        const { entryId } = await this.once(`timesheet:${issue.id}`, '工时填报', () => this.sparkin.submit({ taskId: task.id, date: input.date, hours: e.hours, note }))
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

  /**
   * 日报 / 周报 draft from the cards: what was finished in the period (with hours, MR and commit subjects), what is still open, and the
   * hours booked in Sparkin for the period. Plain text the user edits and copies; nothing is sent anywhere.
   */
  async buildReport(kind: 'day' | 'week'): Promise<{ kind: 'day' | 'week'; title: string; text: string; hours: number }> {
    const t = new Date(this.clock())
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const from = kind === 'day' ? today : new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
    const to = kind === 'day' ? today : new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6)
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const all = this.store.data.issues.filter((i) => i.agentId !== 'weekly')
    const groups: [string, Issue[]][] = [
      ['已完成', all.filter((i) => i.status === 'done' && new Date(i.doneAt ?? i.updatedAt) >= from)],
      ['待审核', all.filter((i) => i.status === 'in_review' && !i.archivedAt)],
      ['进行中', all.filter((i) => i.status === 'in_progress')],
      ['已阻塞', all.filter((i) => i.status === 'blocked' && !i.archivedAt)],
    ]
    const used = groups.flatMap(([, l]) => l)
    if (!used.length) throw new WorkbenchError('invalid', kind === 'day' ? '今天还没有可汇总的任务' : '本周还没有可汇总的任务')
    const title = kind === 'day' ? `日报 ${day(from)}` : `周报 ${day(from)} ~ ${day(to)}`
    const projectName = (id?: string) => this.store.data.projects.find((p) => p.id === id)?.name ?? '未选择项目'
    const commits = async (i: Issue) => {
      const project = this.store.data.projects.find((p) => p.id === i.projectId)
      if (!project || !i.branch || !i.baseSha) return [] as string[]
      try { return (await g.git(project.cwd, ['log', `${i.baseSha}..${i.branch}`, '--format=%s', '-n', '5'])).split('\n').filter(Boolean) } catch { return [] }
    }
    const line = async (i: Issue) => [
      `- ${i.key}${i.sourceRef ? `（${i.sourceRef.ref}）` : ''} ${i.title} · ${projectName(i.projectId)}${i.timesheet ? ` · ${i.timesheet.hours}h` : ''}${i.mr ? ` · MR !${i.mr.iid}` : ''}`,
      ...(await commits(i)).map((c) => `  - 提交：${c}`),
    ].join('\n')
    const body: string[] = []
    for (const [name, list] of groups) if (list.length) body.push('', `## ${name}（${list.length}）`, ...(await Promise.all(list.map(line))))
    // hours booked on days inside the period, whichever card they belong to
    const booked = this.store.data.issues.flatMap((i) => (i.timesheet && i.timesheet.date >= day(from) && i.timesheet.date <= day(to) ? [i.timesheet] : []))
    const hours = Math.round(booked.reduce((n, x) => n + x.hours, 0) * 10) / 10
    const byTask = new Map<string, number>()
    for (const x of booked) byTask.set(x.sparkinTaskName, (byTask.get(x.sparkinTaskName) ?? 0) + x.hours)
    const text = [
      `统计区间：${kind === 'day' ? day(from) : `${day(from)} ~ ${day(to)}`}（来自研发工作台的任务）。`, ...body, '',
      `已填报工时合计：${hours}h${byTask.size ? `（${[...byTask].map(([n, h]) => `${n} ${h}h`).join('，')}）` : ''}`,
    ].join('\n')
    return { kind, title, text, hours }
  }

  /**
   * Hand the (possibly edited) draft to 周报助手 as a task. Created in 待规划 so auto-run never starts it by itself; the human
   * reviews it and clicks 开工.
   */
  async createReportTask(kind: 'day' | 'week', text?: string): Promise<Issue> {
    const r = await this.buildReport(kind)
    if (this.store.data.issues.some((i) => i.title === r.title && !i.archivedAt)) throw new WorkbenchError('duplicate', `「${r.title}」已经生成过`)
    // the project most of the listed work belongs to: the report agent reads its commits
    const count = new Map<string, number>()
    for (const i of this.store.data.issues) if (i.projectId && new RegExp(`${i.key}(?!\\d)`).test(r.text)) count.set(i.projectId, (count.get(i.projectId) ?? 0) + 1)
    const projectId = [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
    return this.createIssue({
      title: r.title, description: text?.trim() || r.text, priority: 'P2', agentId: 'weekly', projectId, status: 'backlog',
      acceptance: ['按项目列出完成项，量化结果', '标注风险与阻塞', kind === 'day' ? '给出明天计划' : '给出下周计划', '工时合计与上面一致'],
    })
  }

  // ---------- agents & projects ----------
  listAgents() { return this.store.data.agents }
  agent(id: string): AgentProfile {
    const a = this.store.data.agents.find((x) => x.id === id)
    if (!a) throw new WorkbenchError('not_found', `智能体 ${id} 不存在`)
    return a
  }
  saveAgent(a: Pick<AgentProfile, 'id' | 'name' | 'description' | 'instructions' | 'model'> & { effort?: string; skills?: string[] }): AgentProfile {
    if (!a.name.trim()) throw new WorkbenchError('invalid', '名称不能为空')
    return this.store.update((d) => {
      const cur = d.agents.find((x) => x.id === a.id)
      const extra = { effort: a.effort || undefined, skills: [...new Set((a.skills ?? []).filter((x) => AGENT_SKILL.test(x)))] }
      if (cur) { Object.assign(cur, { name: a.name.trim(), description: a.description, instructions: a.instructions, model: a.model || undefined, ...extra }); return cur }
      const created: AgentProfile = { ...a, name: a.name.trim(), model: a.model || undefined, ...extra }
      d.agents.push(created)
      return created
    })
  }

  listProjects() { return this.store.data.projects }
  saveProject(p: Omit<Project, 'id'> & { id?: string }): Project {
    if (!p.name.trim() || !isAbsolute(p.cwd.trim())) throw new WorkbenchError('invalid', '项目名称必填，工作目录必须是绝对路径')
    return this.store.update((d) => {
      const clean = { ...p, name: p.name.trim(), cwd: p.cwd.trim(), skills: [...new Set((p.skills ?? []).filter((x) => AGENT_SKILL.test(x)))] }
      const cur = p.id ? d.projects.find((x) => x.id === p.id) : undefined
      if (cur) { Object.assign(cur, clean); return cur }
      d.seq += 1
      const created: Project = { ...clean, id: `prj_${d.seq}` }
      d.projects.push(created)
      return created
    })
  }
  /** First run only: create demo working directories so the demo to-dos can be started without manual setup. */
  seedDemoProjects(baseDir: string, onlyIfEmpty = true) {
    if (onlyIfEmpty && this.store.data.projects.length) return
    const demo: Omit<Project, 'id'>[] = [
      { name: '云支付 / payment-core', cwd: join(baseDir, 'payment-core'), zentaoProductId: 12, sparkinProjectId: 'SP-PAY', testCmd: 'node --test' },
      { name: '订单服务 / teleone-order', cwd: join(baseDir, 'teleone-order'), gitlabProjectId: 101, zentaoProductId: 5, sparkinProjectId: 'SP-ORDER' },
      { name: '订单服务 / order-service', cwd: join(baseDir, 'order-service'), jenkinsJob: 'order-service', sparkinProjectId: 'SP-ORDER' },
      { name: '前端 / teleone-web', cwd: join(baseDir, 'teleone-web'), jenkinsJob: 'teleone-web', sparkinProjectId: 'SP-WEB' },
      { name: '认证中心 / auth', cwd: join(baseDir, 'auth-center'), zentaoProductId: 8, sparkinProjectId: 'SP-AUTH' },
      { name: '数据中心 / report', cwd: join(baseDir, 'data-center'), zentaoProductId: 9, sparkinProjectId: 'SP-DATA' },
      { name: '基础设施 / infrastructure', cwd: join(baseDir, 'infrastructure'), gitlabProjectId: 77, sparkinProjectId: 'SP-INFRA' },
    ]
    for (const p of demo) {
      if (this.store.data.projects.some((x) => x.cwd === p.cwd)) continue
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
      initDemoRepo(p.cwd) // a git repo, so tasks get their own branch and the diff view works out of the box
      this.saveProject(p)
    }
  }

  /** Demo data from before git support: make the seeded directories git repos and give payment-core its test command. */
  upgradeDemoRepos(baseDir: string) {
    for (const p of this.store.data.projects) {
      if (!p.cwd.startsWith(baseDir) || !existsSync(p.cwd)) continue
      initDemoRepo(p.cwd)
      if (p.name.endsWith('payment-core') && p.testCmd === undefined) this.saveProject({ ...p, testCmd: 'node --test' })
    }
  }

  // ---------- notifications ----------
  private collectNotices(before: Data, after: Data) {
    const was = new Map(before.issues.map((i) => [i.id, i]))
    const push = (kind: Notice['kind'], i: Issue, text: string) => {
      this.notices.push({ id: ++this.noticeSeq, at: new Date(this.clock()).toISOString(), kind, issueId: i.id, title: `${i.key} ${i.title}`, text })
      if (this.notices.length > 50) this.notices.shift()
    }
    for (const i of after.issues) {
      const prev = was.get(i.id)
      if (!prev) continue // a brand new card in 待审核 / 已阻塞 was put there by hand
      if (prev.status !== i.status && i.status === 'in_review') push('review', i, i.note ?? '智能体已完成，等你审核')
      else if (prev.status !== i.status && i.status === 'blocked' && i.note !== STOPPED) push('blocked', i, i.note ?? '任务已阻塞')
      if (!prev.writeBack && i.writeBack) push('writeback', i, `已回写禅道 ${i.sourceRef?.ref ?? ''}，状态改为已解决${i.writeBack.demo ? '（演示）' : ''}`)
    }
  }

  /** Notices newer than `after`; `after` undefined only reports the current position (nothing old is replayed on start). */
  noticesSince(after?: number) {
    return { boot: this.boot, last: this.noticeSeq, enabled: this.settings().desktopNotify, items: after === undefined ? [] : this.notices.filter((n) => n.id > after) }
  }

  // ---------- skill packs ----------
  /** Skills found in the configured skill roots (the provider the Host registers with DSH serves exactly these). */
  packSkills() { return discoverSkills(this.settings().skillRoots) }

  /** For the settings page: per configured root, whether it exists and how many skills it yields; plus the merged list. */
  packSkillReport() {
    const roots = this.settings().skillRoots
    const skills = discoverSkills(roots)
    return { roots: roots.map((r) => ({ root: r, exists: existsSync(resolve(expandHome(r))), count: skills.filter((s) => s.root === resolve(expandHome(r.trim()))).length })), skills: skills.map(({ name, description, root }) => ({ name, description, root })) }
  }

  // ---------- updates ----------
  /** Look at the update address now (the 检查更新 button). The result is kept so the banner survives a restart. */
  async checkUpdate() {
    const url = this.settings().updateCheckUrl
    if (!url) throw new WorkbenchError('invalid', '还没有填写更新地址（设置 → 插件设置 → 关于与更新）')
    const info = await checkForUpdate(this.fetch, url, this.version, new Date(this.clock()))
    this.store.update((d) => { d.update = info })
    return info
  }

  /** The kept result, judged against the version running now (after an update the old "newer" must not linger). */
  updateInfo() {
    const u = this.store.data.update
    return u && { ...u, current: this.version, newer: !!u.latest && compareVersions(u.latest, this.version) > 0 }
  }

  /** From the Host's timer: at most once a day, only when an address is set. */
  async maybeCheckUpdate() {
    const last = this.store.data.update
    if (!this.settings().updateCheckUrl || (last && this.clock() - Date.parse(last.checkedAt) < 24 * 3600_000)) return
    await this.checkUpdate().catch(() => {})
  }

  // ---------- statistics ----------
  stats() { return computeStats(this.store.data, this.clock()) }

  /** Per-card rows for the local CSV / JSON export. */
  exportCards() { const rows = exportRows(this.store.data); return { rows, csv: toCsv(rows) } }

  /** Exactly what an anonymous report would send; shown to the user before anything is ever sent. */
  statsPayload() {
    let clientId = this.store.data.clientId
    if (!clientId) { clientId = randomUUID(); this.store.update((d) => { d.clientId = clientId }) }
    return anonymousPayload(this.stats(), clientId, this.version, new Set(this.store.data.agents.filter((a) => a.builtin).map((a) => a.id)))
  }

  /** Send the anonymous report now. Needs an address; `force` ignores the on/off switch (the 立即上报 button). */
  async reportStats(force = false): Promise<{ at: string; ok: boolean; error?: string }> {
    const s = this.settings()
    if (!s.statsReportUrl) throw new WorkbenchError('invalid', '还没有填写上报地址（设置 → 插件设置 → 统计与上报）')
    if (!force && !s.statsReportEnabled) throw new WorkbenchError('invalid', '匿名上报没有开启')
    const at = new Date(this.clock()).toISOString()
    let result: { at: string; ok: boolean; error?: string }
    try {
      const res = await this.fetch(s.statsReportUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.statsPayload()), signal: AbortSignal.timeout(8000) })
      result = res.ok ? { at, ok: true } : { at, ok: false, error: `HTTP ${res.status}` }
    } catch (e) { result = { at, ok: false, error: String((e as Error).message ?? e) } }
    this.store.update((d) => { d.statsReport = result })
    return result
  }

  /** Called from the Host's timer: report at most once a day, and only when switched on. Failures are recorded, never thrown. */
  async maybeReportStats() {
    const s = this.settings(), last = this.store.data.statsReport
    if (!s.statsReportEnabled || !s.statsReportUrl) return
    if (last && this.clock() - Date.parse(last.at) < 24 * 3600_000) return
    await this.reportStats().catch(() => {})
  }

  // ---------- first-run guide ----------
  onboardingRoots() { return suggestRoots() }

  /**
   * Find git repositories under `roots` and, where GitLab is configured and the remote points at it, look up the GitLab project id
   * from the remote path. Lookups that fail leave the repo unmatched; the scan itself never fails because of GitLab.
   */
  async scanRepos(roots: string[], extra: string[] = []): Promise<{ repos: RepoCandidate[]; gitlab: 'matched' | 'not_configured' | 'error'; error?: string }> {
    const known = new Set(this.store.data.projects.map((p) => p.cwd))
    // `extra`: directories the host already knows are the user's projects (Codex's own); taken as they are, if they are repositories
    const found = [...new Set([...extra.filter((d) => existsSync(join(d, '.git'))), ...(await findRepos(roots))])]
    const repos = await Promise.all(found.map((d) => describeRepo(d, known)))
    const [url, token] = await Promise.all(['WORKBENCH_GITLAB_URL', 'WORKBENCH_GITLAB_TOKEN'].map((n) => this.creds(n)))
    if (!url || !token) return { repos, gitlab: 'not_configured' }
    const base = url.replace(/\/+$/, '')
    let host: string
    try { host = new URL(base).hostname } catch { return { repos, gitlab: 'error', error: 'GitLab 地址无效' } }
    let error: string | undefined
    await Promise.all(repos.map(async (r) => {
      const parsed = r.remote ? parseRemote(r.remote) : undefined
      if (!parsed || parsed.host !== host) return
      r.gitlabPath = parsed.path
      try {
        const res = await this.fetch(`${base}/api/v4/projects/${encodeURIComponent(parsed.path)}`, { headers: { 'PRIVATE-TOKEN': token }, signal: AbortSignal.timeout(8000) })
        if (res.ok) r.gitlabProjectId = ((await res.json()) as { id: number }).id
        else error ??= `GitLab 查询 ${parsed.path} 返回 HTTP ${res.status}`
      } catch (e) { error ??= String((e as Error).message ?? e) }
    }))
    return { repos, gitlab: error ? 'error' : 'matched', error }
  }

  /** Create projects for the chosen repositories (skipping directories that already are one). Returns what was created. */
  importRepos(items: { path: string; name?: string; gitlabProjectId?: number; testCmd?: string }[]): Project[] {
    const have = new Set(this.store.data.projects.map((p) => p.cwd))
    return items.filter((i) => !have.has(i.path)).map((i) => this.saveProject({
      name: i.name?.trim() || i.path.split(/[\\/]/).filter(Boolean).at(-1)!, cwd: i.path,
      gitlabProjectId: i.gitlabProjectId, testCmd: i.testCmd || undefined,
    }))
  }

  deleteProject(id: string) { this.store.update((d) => { d.projects = d.projects.filter((p) => p.id !== id) }) }
}

/** `git init` + one commit for a demo working directory. Silently skipped when git isn't installed. */
function initDemoRepo(cwd: string) {
  if (existsSync(join(cwd, '.git'))) return
  try {
    const run = (...a: string[]) => execFileSync('git', a, { cwd, stdio: 'ignore' })
    run('init', '-q', '-b', 'main'); run('add', '-A')
    run('-c', 'user.name=研发工作台', '-c', 'user.email=workbench@localhost', 'commit', '-q', '-m', '初始提交（演示仓库）')
  } catch { /* no git: tasks just run in the directory */ }
}

/** Code review MRs go to 代码审查员, failed builds to 构建修复员, everything else to 全栈工程师. */
export function defaultAgentFor(w: Pick<WorkItem, 'source'>): string {
  return w.source === 'gitlab' ? 'reviewer' : w.source === 'jenkins' ? 'build-fixer' : 'fullstack'
}
