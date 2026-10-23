import { homedir } from 'node:os'
import { join } from 'node:path'
import { Store, Workbench, WorkbenchError, defaultDataPath } from '../core/src/index.ts'
import type { Status, WorkItem } from '../core/src/index.ts'
import { DshDriver } from './dsh-driver.ts'

type Ctx = any // eslint-disable-line @typescript-eslint/no-explicit-any

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
    // Credentials are resolved per call and only ever used inside the connectors (never logged or sent to the page).
    creds: async (name) => (await ctx.credentials.resolve(name))?.value,
  })
  wb.seedDemoProjects(join(homedir(), '.workbench', 'demo-repos'))
  void Promise.all(wb.listAgents().map((a) => driver.registerPreset(a)))
  ctx.effect(() => () => { wb.dispose(); return driver.disposePresets() })

  const state = () => ({
    issues: wb.listIssues(), runs: wb.listRuns(), agents: wb.listAgents(), projects: wb.listProjects(),
  })

  async function dispatch(endpoint: string, p: any): Promise<unknown> {
    switch (endpoint) {
      case 'state': return state()
      case 'todos.list': return await wb.listTodos()
      case 'todos.start': return await wb.startWork({ item: p.item as WorkItem, agentId: p.agentId })
      case 'issue.create': return wb.createIssue(p)
      case 'issue.update': return wb.updateIssue(p.id, p.patch)
      case 'issue.start': return await wb.startIssue(p.id, p.agentId)
      case 'issue.status': return wb.setStatus(p.id, p.status as Status, 'human') // only the UI (a human) calls this
      case 'issue.delete': return wb.deleteIssue(p.id)
      case 'agent.save': {
        const a = wb.saveAgent(p)
        await driver.registerPreset(a)
        return a
      }
      case 'project.save': return wb.saveProject(p)
      case 'project.delete': return wb.deleteProject(p.id)
      case 'models.list': return await driver.listModels()
      default: throw new WorkbenchError('invalid', `unknown endpoint ${endpoint}`)
    }
  }

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
