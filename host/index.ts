import { join } from 'node:path'
import { LockError, Store, Workbench, WorkbenchError, acquireLock, createDispatch, dataDir, defaultDataPath } from '../core/src/index.ts'
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
  // one writer per data dir: a second DSH (or the Codex version pointed at the same dir) must not overwrite this one's file
  let release: () => void
  try { release = acquireLock(dataDir()) } catch (e) {
    if (!(e instanceof LockError)) throw e
    ctx.logger.error(`workbench: ${e.message}`)
    ctx.connection.fetch.register({ path: '/api/workbench.rpc', methods: ['POST'], requestBody: 'buffered', fetch: async () => Response.json({ ok: false, error: e.message }) })
    return
  }
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
    void wb.maybeCheckUpdate()
    wb.tick().catch((e) => ctx.logger.warn('workbench: auto-run tick failed', e)).finally(() => { if (!stopped) timer = setTimeout(loop, wb.settings().autoRunPollSeconds * 1000) })
  }
  timer = setTimeout(loop, 5000)
  ctx.effect(() => () => { stopped = true; clearTimeout(timer); wb.dispose(); release(); return driver.disposePresets() })

  const dispatch = createDispatch(wb, {
    driver,
    exampleSkillRoot: () => (existsSync(exampleSkillRoot) ? exampleSkillRoot : undefined),
    defaultModel: () => ctx.agentDefaultModel.currentSelection().model,
    agentSaved: (a) => driver.registerPreset(a),
    refreshSkills,
  })

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
