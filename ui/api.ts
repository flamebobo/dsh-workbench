import type { AgentProfile, Attachment, Issue, Project, Run, WorkItem, Status } from '../core/src/types.ts'
import type { TodoResult } from '../core/src/workbench.ts'

export type { AgentProfile, Attachment, Issue, Project, Run, WorkItem, Status, TodoResult }
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

/** Upload one file's raw bytes to the Host; the returned reference is what the task keeps (the name travels in a header). */
export async function uploadFile(file: File): Promise<Attachment> {
  const res = await fetch('api/workbench.upload', {
    method: 'POST', body: file,
    headers: { 'x-wb-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' },
  })
  if (!res.ok) throw new RpcError(`上传失败（HTTP ${res.status}）`)
  const j = await res.json()
  if (!j.ok) throw new RpcError(j.error)
  return j.value as Attachment
}

export const COMMANDS: { id: string; label: string; hint: string }[] = [
  { id: '', label: '直接发送', hint: '把任务作为普通消息发给智能体' },
  { id: 'plan', label: '/plan 先出方案', hint: '进入计划模式：只读探索，给出方案并等你批准后再动手' },
  { id: 'goal', label: '/goal 设为目标', hint: '把任务设为长任务目标，智能体会持续推进直到完成' },
]

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
export const isImage = (a: Pick<Attachment, 'mediaType'>) => /^image\/(png|jpeg|webp|gif)$/.test(a.mediaType)
