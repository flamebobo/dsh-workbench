import type { AgentProfile, Attachment, Build, Check, MergeRequest, BuildState, Issue, Project, Run, WorkItem, Status } from '../core/src/types.ts'
import type { TodoResult } from '../core/src/workbench.ts'
import type { PluginSettings } from '../core/src/settings.ts'
export type { PluginSettings }

export type { AgentProfile, Attachment, Check, MergeRequest, Build, BuildState, Issue, Project, Run, WorkItem, Status, TodoResult }
export interface State { version?: string; update?: import('../core/src/types.ts').UpdateInfo; exampleSkillRoot?: string; issues: Issue[]; runs: Run[]; agents: AgentProfile[]; projects: Project[]; builds?: Build[]; autoRun?: boolean; working?: number; settings?: PluginSettings; /** ids of demo cards left on the board after their system was connected for real */ demoLeft?: string[] }

export class RpcError extends Error {
  code?: string
  issueId?: string
}

/** Which host the page was built for (scripts/build.mjs): the product logic is the same, a few host features differ. */
declare const __WB_HOST__: 'dsh' | 'codex' | undefined
export const HOST: 'dsh' | 'codex' = typeof __WB_HOST__ === 'string' ? __WB_HOST__ : 'dsh'
export const HOST_NAME = HOST === 'codex' ? 'Codex' : 'DSH'

/** How the page reaches its backend: DSH = a Fetch route on the Host, Codex = MCP tool calls through the host's postMessage bridge. */
export interface Transport {
  rpc(endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: string; code?: string; issueId?: string }>
  upload(file: File): Promise<{ ok: boolean; value?: unknown; error?: string }>
}

/** Page -> Host: one owner-only Fetch route (see docs/NOTES.md for why not rpc.handle). Document-relative on purpose. */
const fetchTransport: Transport = {
  async rpc(endpoint, payload) {
    const res = await fetch('api/workbench.rpc', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }),
    })
    if (!res.ok) throw new RpcError(`Host 接口不可用（HTTP ${res.status}），请确认插件已加载`)
    return await res.json()
  },
  // Raw bytes to the Host; the name travels in a header.
  async upload(file) {
    const res = await fetch('api/workbench.upload', {
      method: 'POST', body: file,
      headers: { 'x-wb-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' },
    })
    if (!res.ok) throw new RpcError(`上传失败（HTTP ${res.status}）`)
    return await res.json()
  },
}
let transport = fetchTransport
export function setTransport(t: Transport) { transport = t }

export async function rpc<T>(endpoint: string, payload: unknown = {}): Promise<T> {
  const j = await transport.rpc(endpoint, payload)
  if (!j.ok) throw Object.assign(new RpcError(j.error), { code: j.code, issueId: j.issueId })
  return j.value as T
}

/** A finished card that came from a Zentao bug and has not been written back yet. */
export const canWriteBack = (i: Issue) => i.status === 'done' && !i.writeBack && i.sourceRef?.source === 'zentao' && /^BUG-\d+$/.test(i.sourceRef.ref)

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

/** Upload one file to the Host; the returned reference is what the task keeps. */
export async function uploadFile(file: File): Promise<Attachment> {
  const j = await transport.upload(file)
  if (!j.ok) throw new RpcError(j.error)
  return j.value as Attachment
}

/** DSH composer commands that can open a task (a leading `/plan` or `/goal` in the description). Codex has no such channel. */
export const COMMANDS: { id: 'plan' | 'goal'; label: string; desc: string }[] = HOST === 'codex' ? [] : [
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

export interface ModelInfo { id: string; name: string; efforts?: { id: string; name: string; description?: string }[]; defaultEffort?: string }
export interface SkillInfo { name: string; description: string; source: string }
export interface FileChange { path: string; status: string; additions: number; deletions: number; patch: string }
export interface Changes { files: FileChange[]; truncated: boolean; branch?: string; base?: string; isolated: boolean }

export interface RepoCandidate { path: string; name: string; remote?: string; gitlabPath?: string; gitlabProjectId?: number; testCmd?: string; known: boolean }
export interface ScanResult { repos: RepoCandidate[]; gitlab: 'matched' | 'not_configured' | 'error'; error?: string }
