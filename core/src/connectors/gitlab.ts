import type { WorkItem } from '../types.ts'
import { getJson, stripHtml, trimSlash, type ConnectorContext } from './http.ts'

type Mr = {
  iid: number; title: string; description?: string; web_url: string; project_id: number
  references?: { full?: string }; author?: { name?: string }; source_branch?: string; target_branch?: string
  draft?: boolean; due_date?: string | null
}

export function parseMergeRequests(list: Mr[]): WorkItem[] {
  return list.map((m) => {
    const full = m.references?.full ?? ''
    const project = full.includes('!') ? full.slice(0, full.lastIndexOf('!')) : `project ${m.project_id}`
    return {
      ref: `!${m.iid}`,
      source: 'gitlab' as const,
      title: `MR !${m.iid} 代码评审：${m.title}`,
      priority: 'P1' as const,
      project,
      gitlabProjectId: m.project_id,
      statusText: '待评审',
      description: stripHtml(m.description) || `${m.author?.name ?? '同事'} 提交了 ${m.source_branch ?? ''} → ${m.target_branch ?? ''}`,
      acceptance: ['指出正确性、边界与安全问题，给出可执行的修改建议', '不直接修改代码，评审意见写成清单'],
      related: [{ label: `${m.source_branch ?? ''} → ${m.target_branch ?? ''}`, detail: m.author?.name }],
      url: m.web_url,
    }
  })
}

export async function fetchGitlab(c: ConnectorContext): Promise<WorkItem[] | undefined> {
  const [url, token] = await Promise.all(['WORKBENCH_GITLAB_URL', 'WORKBENCH_GITLAB_TOKEN'].map((n) => c.creds(n)))
  if (!url || !token) return undefined
  const base = trimSlash(url)
  const headers = { 'PRIVATE-TOKEN': token }
  const me = await getJson<{ username: string }>(c.fetch, `${base}/api/v4/user`, { headers })
  const q = new URLSearchParams({ scope: 'all', state: 'opened', reviewer_username: me.username })
  return parseMergeRequests(await getJson<Mr[]>(c.fetch, `${base}/api/v4/merge_requests?${q}`, { headers }))
}

/** Open a merge request, or return the one already open for that source branch. */
export async function createMergeRequest(
  c: ConnectorContext,
  projectId: number,
  mr: { source: string; target: string; title: string; description: string },
): Promise<{ url: string; iid: number; existing: boolean }> {
  const [url, token] = await Promise.all(['WORKBENCH_GITLAB_URL', 'WORKBENCH_GITLAB_TOKEN'].map((n) => c.creds(n)))
  if (!url || !token) throw new Error('GitLab 未配置（设置 → GitLab）')
  const base = `${trimSlash(url)}/api/v4/projects/${projectId}/merge_requests`
  const headers = { 'PRIVATE-TOKEN': token, 'content-type': 'application/json' }
  const res = await c.fetch(base, {
    method: 'POST', headers, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ source_branch: mr.source, target_branch: mr.target, title: mr.title, description: mr.description, remove_source_branch: true }),
  })
  if (res.ok) { const j = (await res.json()) as { web_url: string; iid: number }; return { url: j.web_url, iid: j.iid, existing: false } }
  const text = await res.text().catch(() => '')
  if (res.status === 409 || /already exists/i.test(text)) {
    const q = new URLSearchParams({ state: 'opened', source_branch: mr.source })
    const list = await getJson<{ web_url: string; iid: number }[]>(c.fetch, `${base}?${q}`, { headers })
    if (list[0]) return { url: list[0].web_url, iid: list[0].iid, existing: true }
  }
  throw new Error(`GitLab 创建合并请求失败：HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`)
}
