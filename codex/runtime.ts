import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Store, Workbench, acquireLock, createDispatch } from '../core/src/index.ts'
import { callServe, readServeInfo, serve, type ServeInfo } from '../core/src/serve.ts'
import { CodexDriver } from './codex-driver.ts'
import { codexProjects } from './projects.ts'

/**
 * The Codex version's own data dir, never DSH's ~/.workbench: both products open the same whole-file store, and sharing one board
 * needs the DSH plugin to talk to this service instead of owning the file (a later step). WORKBENCH_CODEX_HOME moves it.
 */
export const codexDataDir = (env = process.env) => env.WORKBENCH_CODEX_HOME || join(homedir(), '.workbench-codex')

/** Connection settings for 禅道 / GitLab / Jenkins: a private file in the data dir; WORKBENCH_* env vars fill what it lacks. */
function credentialFile(dir: string) {
  const path = join(dir, 'credentials.json')
  const read = (): Record<string, string> => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return {} } }
  return {
    get: async (name: string) => read()[name] ?? process.env[name],
    set: async (name: string, value: string | undefined) => {
      const all = read()
      if (value === undefined) delete all[name]; else all[name] = value
      writeFileSync(path, JSON.stringify(all, null, 2), { mode: 0o600 })
    },
  }
}

/** `workbench serve`: the resident service that owns the data dir. Exits with a message when another process already does. */
export async function runServe(o: { dir: string; version: string; exampleSkillRoot?: string }) {
  const release = acquireLock(o.dir)
  const driver = new CodexDriver({ version: o.version })
  const creds = credentialFile(o.dir)
  const wb = new Workbench({ store: new Store(join(o.dir, 'workbench.json')), driver, version: o.version, creds: creds.get, setCred: creds.set })
  // DSH registers the configured skill packs with its skill registry; Codex has no such hook, so they travel as skill inputs instead
  driver.permission = () => wb.settings().permissionPreset
  driver.packSkills = () => wb.packSkills().map((k) => ({ name: k.name, description: k.description, path: k.path, scope: 'workbench', enabled: true }))
  wb.seedDemoProjects(join(o.dir, 'demo-repos'))
  wb.upgradeDemoRepos(join(o.dir, 'demo-repos'))
  // the same safety net as the DSH Host: auto-run queue and the daily anonymous report; no update check (that package is DSH's)
  let timer: ReturnType<typeof setTimeout>
  const loop = () => {
    void wb.maybeReportStats()
    wb.tick().catch((e) => console.warn('workbench: auto-run tick failed', e)).finally(() => { timer = setTimeout(loop, wb.settings().autoRunPollSeconds * 1000) })
  }
  timer = setTimeout(loop, 5000)
  const dispatch = createDispatch(wb, {
    driver,
    defaultModel: driver.defaultModel,
    projectHints: () => codexProjects({ exclude: o.dir }),
    exampleSkillRoot: () => (o.exampleSkillRoot && existsSync(o.exampleSkillRoot) ? o.exampleSkillRoot : undefined),
  })
  const s = await serve({ dir: o.dir, dispatch, version: o.version, revision: () => wb.store.data, log: (m, e) => console.warn(`workbench: ${m}`, e) })
  console.log(`workbench: serving ${o.dir} on 127.0.0.1:${s.info.port} (pid ${process.pid})`)
  const stop = async () => {
    clearTimeout(timer)
    driver.dispose()
    wb.dispose()
    await s.close()
    release()
    process.exit(0)
  }
  process.once('SIGTERM', () => void stop())
  process.once('SIGINT', () => void stop())
  return s.info
}

async function healthy(dir: string): Promise<{ info: ServeInfo; version: string } | undefined> {
  const info = readServeInfo(dir)
  if (!info) return
  try {
    const h = await callServe<{ ok: boolean; version: string }>(info, '/health', undefined, 2000)
    return h.ok ? { info, version: h.version } : undefined
  } catch { return undefined }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Ask a service to stop and wait until its process is gone: it releases the data-dir lock only after its server has closed. */
async function stopProcess(pid: number) {
  try { process.kill(pid, 'SIGTERM') } catch { return }
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0) } catch { return }
    await sleep(50)
  }
}

/**
 * The running service, started when there is none (the MCP process comes and goes with Codex sessions; the service stays). A service
 * left over from an older plugin version is stopped and replaced, so an update takes effect the next time the board opens.
 */
export async function ensureServe(o: { dir: string; version: string; entry: string[]; timeoutMs?: number }): Promise<ServeInfo> {
  let cur = await healthy(o.dir)
  if (cur && cur.version !== o.version) {
    await stopProcess(cur.info.pid)
    cur = undefined
  }
  if (cur) return cur.info
  const log = join(o.dir, 'serve.log')
  mkdirSync(o.dir, { recursive: true })
  const out = openSync(log, 'a')
  const [bin, ...args] = o.entry
  spawn(bin!, [...args, 'serve'], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, WORKBENCH_CODEX_HOME: o.dir }, windowsHide: true }).unref()
  const t0 = Date.now()
  while (Date.now() - t0 < (o.timeoutMs ?? 15_000)) {
    const up = await healthy(o.dir)
    if (up) return up.info
    await sleep(150)
  }
  const tail = (() => { try { return readFileSync(log, 'utf8').trim().split('\n').slice(-3).join(' / ') } catch { return '' } })()
  throw new Error(`工作台本地服务没有启动起来${tail ? `：${tail}` : ''}（日志 ${log}）`)
}

/** `workbench stop`: end the running service (its running cards are parked in 已阻塞). */
export async function stopServe(dir: string) {
  const cur = await healthy(dir)
  if (!cur) return false
  await stopProcess(cur.info.pid)
  return true
}
