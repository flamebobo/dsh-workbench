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
