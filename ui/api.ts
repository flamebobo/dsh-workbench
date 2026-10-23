import type { AgentProfile, Attachment, Build, BuildState, Issue, Project, Run, WorkItem, Status } from '../core/src/types.ts'
import type { TodoResult } from '../core/src/workbench.ts'

export type { AgentProfile, Attachment, Build, BuildState, Issue, Project, Run, WorkItem, Status, TodoResult }
export interface State { issues: Issue[]; runs: Run[]; agents: AgentProfile[]; projects: Project[]; builds?: Build[] }

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

/** DSH composer commands that can open a task (a leading `/plan` or `/goal` in the description). */
export const COMMANDS: { id: 'plan' | 'goal'; label: string; desc: string }[] = [
  { id: 'goal', label: '目标', desc: '设置或查看长期任务目标' },
  { id: 'plan', label: '计划', desc: '进入或退出计划模式' },
]

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
export const isImage = (a: Pick<Attachment, 'mediaType'>) => /^image\/(png|jpeg|webp|gif)$/.test(a.mediaType)

export const BUILD_LABEL: Record<BuildState, string> = {
  queued: '排队中', running: '构建中', success: '成功', failure: '失败', unstable: '不稳定', aborted: '已取消', error: '触发失败',
}
export const buildColor = (s: BuildState) => (s === 'success' ? 'var(--wb-green)' : s === 'failure' || s === 'error' ? 'var(--wb-red)' : 'var(--wb-amber)')

export interface ConnectionView {
  id: 'zentao' | 'gitlab' | 'jenkins'; label: string; configured: boolean
  fields: { key: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string; set: boolean; value?: string }[]
}
