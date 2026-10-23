import type { AgentProfile, Issue, Project, Run, WorkItem, Status } from '../core/src/types.ts'
import type { TodoResult } from '../core/src/workbench.ts'

export type { AgentProfile, Issue, Project, Run, WorkItem, Status, TodoResult }
export interface State { issues: Issue[]; runs: Run[]; agents: AgentProfile[]; projects: Project[] }

export class RpcError extends Error {
  code?: string
  issueId?: string
}

/** Page -> Host: one owner-only Fetch route (see docs/NOTES.md for why not rpc.handle). Document-relative on purpose. */
export async function rpc<T>(endpoint: string, payload: unknown = {}): Promise<T> {
  const res = await fetch('api/workbench.rpc', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }),
  })
  if (!res.ok) throw new RpcError(`Host 接口不可用（HTTP ${res.status}），请确认插件已加载`)
  const j = await res.json()
  if (!j.ok) throw Object.assign(new RpcError(j.error), { code: j.code, issueId: j.issueId })
  return j.value as T
}

export const STATUS_LABEL: Record<Status, string> = {
  backlog: '待规划', todo: '待办', in_progress: '进行中', in_review: '待审核', done: '已完成', blocked: '已阻塞',
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
