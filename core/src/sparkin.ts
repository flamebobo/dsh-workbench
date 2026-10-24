import type { Issue } from './types.ts'

export interface SparkinProject { id: string; name: string }
export interface SparkinTask { id: string; projectId: string; name: string }

/**
 * Sparkin (the time-sheet system). Only the demo backend exists: the real API document has not been provided yet, and
 * a real client plugs in here by implementing this interface (`mode: 'live'`) without touching the workflow above it.
 */
export interface SparkinClient {
  mode: 'demo' | 'live'
  projects(): Promise<SparkinProject[]>
  tasks(projectId: string): Promise<SparkinTask[]>
  /** Book `hours` on a Sparkin task for `date` (YYYY-MM-DD). Returns the entry id. */
  submit(entry: { taskId: string; date: string; hours: number; note: string }): Promise<{ entryId: string }>
}

const PROJECTS: SparkinProject[] = [
  { id: 'SP-PAY', name: '云支付平台' }, { id: 'SP-ORDER', name: '订单中心' }, { id: 'SP-WEB', name: '前端门户' },
  { id: 'SP-AUTH', name: '认证中心' }, { id: 'SP-DATA', name: '数据中心' }, { id: 'SP-INFRA', name: '基础设施' },
]
const TASK_NAMES = ['缺陷修复', '需求开发', '代码评审', '构建与发布', '联调与测试', '文档与周报']

/** Demo backend: fixed projects, the same six tasks in each, and entries that are just acknowledged. */
export class DemoSparkin implements SparkinClient {
  mode = 'demo' as const
  private seq = 0
  async projects() { return PROJECTS }
  async tasks(projectId: string) { return TASK_NAMES.map((name, i) => ({ id: `${projectId}-T${i + 1}`, projectId, name })) }
  async submit() { return { entryId: `DEMO-${Date.now().toString(36)}-${++this.seq}` } }
}

const KEYWORDS: Record<string, string> = { zentao: '缺陷修复', gitlab: '代码评审', jenkins: '构建与发布', manual: '需求开发' }

/** Pick the likeliest Sparkin task for a card from where it came from (bug -> 缺陷修复, MR -> 代码评审, build -> 构建与发布). */
export function suggestTask(issue: Pick<Issue, 'sourceRef' | 'title'>, tasks: SparkinTask[]): SparkinTask | undefined {
  const hint = /^BUG-/.test(issue.sourceRef?.ref ?? '') || /缺陷|bug|修复/i.test(issue.title) ? '缺陷修复' : KEYWORDS[issue.sourceRef?.source ?? 'manual']
  return tasks.find((t) => t.name.includes(hint!)) ?? tasks[0]
}
