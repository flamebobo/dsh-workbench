import type { WorkItem } from '../types.ts'
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

export async function fetchJenkins(c: ConnectorContext): Promise<WorkItem[] | undefined> {
  const [url, user, token] = await Promise.all(['WORKBENCH_JENKINS_URL', 'WORKBENCH_JENKINS_USER', 'WORKBENCH_JENKINS_TOKEN'].map((n) => c.creds(n)))
  if (!url || !user || !token) return undefined
  const headers = { authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` }
  return parseFailedBuilds(await getJson(c.fetch, `${trimSlash(url)}/api/json?tree=${encodeURIComponent(TREE)}`, { headers }))
}
