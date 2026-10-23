import type { BuildState, WorkItem } from '../types.ts'
import { getJson, trimSlash, type ConnectorContext } from './http.ts'

type Job = {
  name: string; url?: string; color?: string
  lastBuild?: { number: number; result?: string | null; timestamp?: number; url?: string } | null
}

const TREE = 'jobs[name,url,color,lastBuild[number,result,timestamp,url]]'

export function parseFailedBuilds(json: { jobs?: Job[] }): WorkItem[] {
  return (json.jobs ?? [])
    .filter((j) => j.color?.includes('red') && j.lastBuild)
    .map((j) => {
      const b = j.lastBuild!
      return {
        ref: `${j.name} #${b.number}`,
        source: 'jenkins' as const,
        title: `构建失败：${j.name} #${b.number}`,
        priority: 'P1' as const,
        project: j.name,
        jenkinsJob: j.name,
        statusText: '失败',
        due: b.timestamp ? new Date(b.timestamp).toISOString().slice(0, 10) : undefined,
        description: `Jenkins job ${j.name} 的最近一次构建 #${b.number} 结果为 ${b.result ?? 'FAILURE'}。查看控制台输出定位根因并修复。`,
        acceptance: ['定位失败根因（编译 / 测试 / 依赖 / 环境）', '修复后本地可复现通过', '说明需要重新触发构建'],
        related: [{ label: `${j.name} #${b.number}`, detail: b.result ?? 'FAILURE' }],
        url: b.url ?? j.url,
      }
    })
}

/** Base URL + Basic auth header, or undefined when Jenkins is not configured. */
export async function jenkinsAuth(c: ConnectorContext): Promise<{ base: string; headers: Record<string, string> } | undefined> {
  const [url, user, token] = await Promise.all(['WORKBENCH_JENKINS_URL', 'WORKBENCH_JENKINS_USER', 'WORKBENCH_JENKINS_TOKEN'].map((n) => c.creds(n)))
  if (!url || !user || !token) return undefined
  return { base: trimSlash(url), headers: { authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` } }
}

export async function fetchJenkins(c: ConnectorContext): Promise<WorkItem[] | undefined> {
  const a = await jenkinsAuth(c)
  if (!a) return undefined
  return parseFailedBuilds(await getJson(c.fetch, `${a.base}/api/json?tree=${encodeURIComponent(TREE)}`, { headers: a.headers }))
}

export async function listJenkinsJobs(c: ConnectorContext): Promise<string[] | undefined> {
  const a = await jenkinsAuth(c)
  if (!a) return undefined
  const json = await getJson<{ jobs?: { name: string }[] }>(c.fetch, `${a.base}/api/json?tree=jobs[name]`, { headers: a.headers })
  return (json.jobs ?? []).map((j) => j.name).sort()
}

/** Jenkins folders are written `folder/job`; the URL form is `job/folder/job/job`. */
export const jobPath = (name: string) => name.split('/').filter(Boolean).map((p) => `job/${encodeURIComponent(p)}`).join('/')

/** Queue one build (with parameters when given). Returns the queue item URL Jenkins answers with. */
export async function triggerJenkinsBuild(c: ConnectorContext, job: string, params: Record<string, string> = {}): Promise<{ queueUrl?: string }> {
  const a = await jenkinsAuth(c)
  if (!a) throw new Error('Jenkins 未配置')
  const headers = { ...a.headers }
  try { // CSRF crumb; API-token requests don't need it on current Jenkins, older ones do
    const crumb = await getJson<{ crumbRequestField: string; crumb: string }>(c.fetch, `${a.base}/crumb-issuer/api/json`, { headers: a.headers })
    headers[crumb.crumbRequestField] = crumb.crumb
  } catch { /* no crumb issuer */ }
  const hasParams = Object.keys(params).length > 0
  const url = `${a.base}/${jobPath(job)}/${hasParams ? `buildWithParameters?${new URLSearchParams(params)}` : 'build'}`
  const res = await c.fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(10000) })
  if (res.status !== 201 && res.status !== 200 && res.status !== 302) {
    throw new Error(res.status === 404 ? `Jenkins 找不到 Job「${job}」（或它需要参数，请填写参数）` : `触发构建失败：HTTP ${res.status}`)
  }
  const loc = res.headers.get('location')
  return { queueUrl: loc ? loc.replace(/\/?$/, '/') : undefined }
}

/** queued -> running -> final, following the queue item to its build when needed. */
export async function jenkinsBuildState(
  c: ConnectorContext, b: { queueUrl?: string; buildUrl?: string },
): Promise<{ state: BuildState; number?: number; buildUrl?: string }> {
  const a = await jenkinsAuth(c)
  if (!a) throw new Error('Jenkins 未配置')
  let { buildUrl } = b
  let number: number | undefined
  if (!buildUrl) {
    if (!b.queueUrl) return { state: 'queued' }
    const q = await getJson<{ cancelled?: boolean; executable?: { number: number; url: string } }>(c.fetch, `${b.queueUrl}api/json`, { headers: a.headers })
    if (q.cancelled) return { state: 'aborted' }
    if (!q.executable) return { state: 'queued' }
    buildUrl = q.executable.url; number = q.executable.number
  }
  const j = await getJson<{ building?: boolean; result?: string | null; number?: number }>(c.fetch, `${buildUrl}api/json?tree=building,result,number`, { headers: a.headers })
  number = j.number ?? number
  if (j.building || !j.result) return { state: 'running', number, buildUrl }
  const map: Record<string, BuildState> = { SUCCESS: 'success', FAILURE: 'failure', UNSTABLE: 'unstable', ABORTED: 'aborted' }
  return { state: map[j.result] ?? 'failure', number, buildUrl }
}
