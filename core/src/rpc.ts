import type { AgentDriver } from './driver.ts'
import type { AgentProfile, Status, WorkItem } from './types.ts'
import { WorkbenchError, type Workbench } from './workbench.ts'

/** What differs between hosts behind the page's endpoints; everything else is the Workbench itself. */
export interface DispatchHost {
  driver: AgentDriver
  /** The example skill pack shipped next to the bundle, when present. */
  exampleSkillRoot?: () => string | undefined
  /** The host's own default model, shown as 「跟随默认模型」. */
  defaultModel?: () => string | undefined
  /** After an agent is saved (DSH re-registers it as a preset). */
  agentSaved?: (a: AgentProfile) => Promise<unknown>
  /** The skill roots may have changed: tell the host's skill registry to look again. */
  refreshSkills?: () => void
}

export type Dispatch = (endpoint: string, payload: any) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any

/** The page's endpoints (`{ endpoint, payload }` from ui/api.ts), shared by the DSH Host route and the Codex local service. */
export function createDispatch(wb: Workbench, h: DispatchHost): Dispatch {
  const { driver } = h
  const refreshSkills = () => h.refreshSkills?.()
  const state = async () => ({
    version: wb.version, update: wb.updateInfo(), exampleSkillRoot: h.exampleSkillRoot?.(), issues: wb.listIssues(), runs: wb.listRuns(), agents: wb.listAgents(), projects: wb.listProjects(), builds: await wb.refreshBuilds(), autoRun: wb.autoRun, working: wb.workingCount(), settings: wb.settings(), demoLeft: wb.demoLeftovers(),
  })

  return async function dispatch(endpoint, p) {
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
      case 'demo.clean': return wb.cleanDemoCards()
      case 'todos.archive': return wb.archiveTodo(p.source, p.ref, !!p.archived)
      case 'issue.writeback.draft': return { ...(await wb.writeBackDraft(p.id)), allowed: wb.canWriteBack(p.id) }
      case 'issue.writeback': return await wb.writeBackZentao(p.id, p.comment) // outward-facing: only from an explicit click
      case 'onboarding.roots': return wb.onboardingRoots()
      case 'onboarding.scan': return await wb.scanRepos(Array.isArray(p.roots) ? p.roots.map(String) : [])
      case 'onboarding.import': return wb.importRepos(Array.isArray(p.items) ? p.items : [])
      case 'update.check': return await wb.checkUpdate()
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
      case 'issue.stop': return await wb.stopIssue(p.id)
      case 'issue.delete': return wb.deleteIssue(p.id)
      case 'agent.save': {
        const a = wb.saveAgent(p)
        await h.agentSaved?.(a)
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
      case 'models.list': return { models: await driver.listModels(), defaultModel: h.defaultModel?.() }
      case 'skills.list': refreshSkills(); return await driver.listSkills(wb.listProjects().map((x) => x.cwd))
      case 'issue.changes': return await wb.issueChanges(p.id)
      case 'issue.test': return await wb.runChecks(p.id)
      case 'issue.mr': return await wb.submitMergeRequest(p.id) // outward-facing: only an explicit click in the UI calls this
      case 'settings.get': return wb.settings()
      case 'settings.save': { const r = wb.saveSettings(p ?? {}); refreshSkills(); return r }
      // for transports that cannot send raw bytes (the Codex page talks through MCP tool calls): the file as base64
      case 'upload': return wb.saveUpload({ name: String(p.name ?? 'file'), mediaType: p.mediaType, data: Buffer.from(String(p.base64 ?? ''), 'base64') })
      default: throw new WorkbenchError('invalid', `unknown endpoint ${endpoint}`)
    }
  }
}
