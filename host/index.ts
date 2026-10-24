import { join } from 'node:path'
import { Store, Workbench, WorkbenchError, dataDir, defaultDataPath } from '../core/src/index.ts'
import type { Status, WorkItem } from '../core/src/index.ts'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DshDriver } from './dsh-driver.ts'
import { registerSkillProvider } from './skill-provider.ts'

type Ctx = any // eslint-disable-line @typescript-eslint/no-explicit-any
/** Replaced with dsh-plugin/package.json's version by scripts/build.mjs. */
declare const __WB_VERSION__: string | undefined

export const inject = [
  'connection', 'credentials', 'agents', 'agentDefaultModel', 'agentPresets',
  'permissionPresets', 'sessionTitle', 'workspaceRegistry',
]

/** Host half of the workbench: page -> Host via one owner-only Fetch route, Workbench core in-process. */
export function apply(ctx: Ctx) {
  const driver = new DshDriver(ctx)
  const wb = new Workbench({
    store: new Store(defaultDataPath()),
    driver,
    version: typeof __WB_VERSION__ === 'string' ? __WB_VERSION__ : 'dev',
    // Credentials are resolved per call and only ever used inside the connectors (never logged or sent to the page).
    creds: async (name) => (await ctx.credentials.resolve(name))?.value,
    // The settings page stores into DSH's credential store (private file under ~/.dsh); values never go back to the page.
    setCred: async (name, value) => { if (value === undefined) await ctx.credentials.unset(name); else await ctx.credentials.set(name, value) },
  })
  driver.permission = () => wb.settings().permissionPreset
  const refreshSkills = registerSkillProvider(ctx, wb)
  // the example skill pack ships next to the Host bundle
  const exampleSkillRoot = fileURLToPath(new URL('./examples/skills', import.meta.url))
  wb.seedDemoProjects(join(dataDir(), 'demo-repos'))
  wb.upgradeDemoRepos(join(dataDir(), 'demo-repos'))
  void Promise.all(wb.listAgents().map((a) => driver.registerPreset(a)))
  // Auto-run safety net: re-check the queue every few seconds (also after a restart with auto-run left on).
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const loop = () => {
    void wb.maybeReportStats()
    wb.tick().catch((e) => ctx.logger.warn('workbench: auto-run tick failed', e)).finally(() => { if (!stopped) timer = setTimeout(loop, wb.settings().autoRunPollSeconds * 1000) })
  }
  timer = setTimeout(loop, 5000)
  ctx.effect(() => () => { stopped = true; clearTimeout(timer); wb.dispose(); return driver.disposePresets() })

  const state = async () => ({
    version: wb.version, exampleSkillRoot: existsSync(exampleSkillRoot) ? exampleSkillRoot : undefined, issues: wb.listIssues(), runs: wb.listRuns(), agents: wb.listAgents(), projects: wb.listProjects(), builds: await wb.refreshBuilds(), autoRun: wb.autoRun, working: wb.workingCount(), settings: wb.settings(),
  })

  async function dispatch(endpoint: string, p: any): Promise<unknown> {
    switch (endpoint) {
      case 'state': return await state()
      case 'todos.list': return await wb.listTodos()
      case 'todos.start': return await wb.startWork({ item: p.item as WorkItem, agentId: p.agentId })
      case 'todos.adopt': return wb.adoptTodo({ item: p.item as WorkItem, agentId: p.agentId })
      case 'issue.create': return wb.createIssue(p)
      case 'issue.update': return wb.updateIssue(p.id, p.patch)
      case 'issue.start': return await wb.startIssue(p.id, p.agentId)
      case 'issue.next': return wb.setNext(p.id, p.nextId ?? '')
      case 'report.draft': return await wb.buildReport(p.kind === 'day' ? 'day' : 'week')
      case 'report.task': return await wb.createReportTask(p.kind === 'day' ? 'day' : 'week', typeof p.text === 'string' ? p.text : undefined)
      case 'issue.followup': return wb.createFollowUp(p.id, { title: p.title, description: p.description })
      case 'issue.archive': return wb.archiveIssue(p.id, !!p.archived)
      case 'issues.archiveDone': return wb.archiveDone()
      case 'todos.archive': return wb.archiveTodo(p.source, p.ref, !!p.archived)
      case 'issue.writeback.draft': return { ...(await wb.writeBackDraft(p.id)), allowed: wb.canWriteBack(p.id) }
      case 'issue.writeback': return await wb.writeBackZentao(p.id, p.comment) // outward-facing: only from an explicit click
      case 'onboarding.roots': return wb.onboardingRoots()
      case 'onboarding.scan': return await wb.scanRepos(Array.isArray(p.roots) ? p.roots.map(String) : [])
      case 'onboarding.import': return wb.importRepos(Array.isArray(p.items) ? p.items : [])
      case 'notices.since': return wb.noticesSince(typeof p.after === 'number' ? p.after : undefined)
      case 'stats.get': return wb.stats()
      case 'stats.payload': return { payload: wb.statsPayload(), last: wb.store.data.statsReport }
      case 'stats.report': return await wb.reportStats(true) // explicit click: sends even when the daily switch is off
      case 'stats.export': return wb.exportCards()
      case 'skills.packs': return wb.packSkillReport()
      case 'sparkin.info': return await wb.sparkinInfo()
      case 'timesheet.report': return await wb.reportTimesheet({ date: p.date, entries: p.entries ?? [] })
      case 'issue.move': return wb.moveIssue(p.id, p.status as Status, p.beforeId, 'human') // only the UI (a human) calls this
      case 'autorun.set': return wb.setAutoRun(!!p.enabled)
      case 'issue.status': return wb.setStatus(p.id, p.status as Status, 'human') // only the UI (a human) calls this
      case 'issue.delete': return wb.deleteIssue(p.id)
      case 'agent.save': {
        const a = wb.saveAgent(p)
        await driver.registerPreset(a)
        return a
      }
      case 'project.save': return wb.saveProject(p)
      case 'project.delete': return wb.deleteProject(p.id)
      case 'connections.list': return await wb.connections()
      case 'connections.save': return await wb.saveConnection(p.id, p.values ?? {})
      case 'connections.clear': return await wb.clearConnection(p.id)
      case 'connections.test': return await wb.testConnection(p.id)
      case 'jenkins.jobs': return await wb.jenkinsJobs()
      case 'builds.trigger': return await wb.triggerBuild({ job: p.job, params: p.params, issueIds: p.issueIds ?? [] })
      case 'files.search': return wb.searchFiles(p.projectId, p.q ?? '')
      case 'models.list': return { models: await driver.listModels(), defaultModel: ctx.agentDefaultModel.currentSelection().model }
      case 'skills.list': refreshSkills(); return await driver.listSkills(wb.listProjects().map((x) => x.cwd))
      case 'issue.changes': return await wb.issueChanges(p.id)
      case 'issue.test': return await wb.runChecks(p.id)
      case 'issue.mr': return await wb.submitMergeRequest(p.id) // outward-facing: only an explicit click in the UI calls this
      case 'settings.get': return wb.settings()
      case 'settings.save': { const r = wb.saveSettings(p ?? {}); refreshSkills(); return r }
      default: throw new WorkbenchError('invalid', `unknown endpoint ${endpoint}`)
    }
  }

  // Raw-body upload (no JSON size cap): the page sends the file bytes, the name in a header; the card only keeps the returned reference.
  ctx.connection.fetch.register({
    path: '/api/workbench.upload', methods: ['POST'], requestBody: 'streaming',
    fetch: async (request: Request) => {
      try {
        const name = decodeURIComponent(request.headers.get('x-wb-name') ?? 'file')
        const data = new Uint8Array(await request.arrayBuffer())
        const mediaType = request.headers.get('content-type') ?? undefined
        return Response.json({ ok: true, value: wb.saveUpload({ name, mediaType, data }) })
      } catch (e) {
        if (!(e instanceof WorkbenchError)) ctx.logger.warn('workbench upload failed', e)
        return Response.json({ ok: false, error: String((e as Error)?.message ?? e) })
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/workbench.rpc', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request: Request) => {
      try {
        const { endpoint, payload } = await request.json()
        return Response.json({ ok: true, value: await dispatch(endpoint, payload ?? {}) })
      } catch (e) {
        const err = e as Error & { code?: string; issueId?: string }
        if (!(e instanceof WorkbenchError)) ctx.logger.warn('workbench rpc failed', e)
        return Response.json({ ok: false, error: String(err?.message ?? e), code: err?.code, issueId: err?.issueId })
      }
    },
  })
}
