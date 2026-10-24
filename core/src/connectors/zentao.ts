import type { Priority, WorkItem } from '../types.ts'
import { getJson, stripHtml, trimSlash, type ConnectorContext } from './http.ts'

const PRI: Priority[] = ['P0', 'P1', 'P2', 'P3']
// Zentao pri: 1 is the most urgent.
const priority = (n: unknown): Priority => PRI[Math.min(3, Math.max(0, Number(n) - 1 || 0))]!

const account = (a: unknown) =>
  typeof a === 'string' ? a : ((a as { account?: string } | null)?.account ?? '')

const MAX_DISCOVERED = 20
const BUG_STATUS: Record<string, string> = { active: '已激活', resolved: '已解决', closed: '已关闭' }
const TASK_STATUS: Record<string, string> = { wait: '未开始', doing: '进行中', done: '已完成', pause: '已暂停' }
const day = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !d.startsWith('0000') ? d.slice(0, 10) : undefined)

type Row = Record<string, unknown>

export function parseBugs(json: { bugs?: Row[] }, me: string, productId: number, base: string): WorkItem[] {
  return (json.bugs ?? [])
    .filter((b) => account(b.assignedTo) === me && b.status !== 'closed' && b.status !== 'resolved')
    .map((b) => ({
      ref: `BUG-${b.id}`,
      source: 'zentao' as const,
      title: String(b.title ?? ''),
      priority: priority(b.pri),
      project: String((b as { productName?: string }).productName ?? `产品 ${productId}`),
      zentaoProductId: productId,
      statusText: BUG_STATUS[String(b.status)] ?? String(b.status ?? ''),
      due: day(b.deadline),
      description: stripHtml(b.steps),
      acceptance: [],
      related: [],
      url: `${base}/bug-view-${b.id}.html`,
    }))
}

export function parseTasks(json: { tasks?: Row[] }, me: string, executionId: number, base: string): WorkItem[] {
  return (json.tasks ?? [])
    .filter((t) => account(t.assignedTo) === me && t.status !== 'done' && t.status !== 'closed' && t.status !== 'cancel')
    .map((t) => ({
      ref: `TASK-${t.id}`,
      source: 'zentao' as const,
      title: String(t.name ?? ''),
      priority: priority(t.pri),
      project: String((t as { executionName?: string }).executionName ?? `迭代 ${executionId}`),
      statusText: TASK_STATUS[String(t.status)] ?? String(t.status ?? ''),
      due: day(t.deadline),
      description: stripHtml(t.desc),
      acceptance: [],
      related: [],
      url: `${base}/task-view-${t.id}.html`,
    }))
}

/** Token for the v1 API, or undefined when no credentials are configured (demo mode). */
async function login(c: ConnectorContext) {
  const [url, acct, password] = await Promise.all(
    ['WORKBENCH_ZENTAO_URL', 'WORKBENCH_ZENTAO_ACCOUNT', 'WORKBENCH_ZENTAO_PASSWORD'].map((n) => c.creds(n)),
  )
  if (!url || !acct || !password) return undefined
  const base = trimSlash(url)
  const { token } = await getJson<{ token: string }>(c.fetch, `${base}/api.php/v1/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: acct, password }),
  })
  return { base, acct, token }
}

/**
 * Mark a bug resolved (resolution 已修复) with a comment: one call that both changes the status and records the comment.
 * Returns false when Zentao isn't configured. Endpoint and fields follow third-party v1 clients, not an official reference:
 * check them against your Zentao version before relying on it.
 */
export async function resolveBug(c: ConnectorContext, bugId: number, comment: string): Promise<boolean> {
  const s = await login(c)
  if (!s) return false
  await getJson(c.fetch, `${s.base}/api.php/v1/bugs/${bugId}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Token: s.token },
    body: JSON.stringify({ resolution: 'fixed', resolvedBuild: 'trunk', comment }),
  })
  return true
}

/** v1 REST API of the open-source edition; throws when v1 is unavailable so the caller can fall back to demo data. */
export async function fetchZentao(c: ConnectorContext): Promise<WorkItem[] | undefined> {
  const s = await login(c)
  if (!s) return undefined
  const { base, acct, token } = s
  const headers = { Token: token }
  // Ids from the settings / Projects page win; with none configured, discover what the account can see (best effort, capped).
  const discover = async (path: string, key: string): Promise<number[]> => {
    try {
      const j = await getJson<Record<string, Row[]>>(c.fetch, `${base}/api.php/v1/${path}?limit=100`, { headers })
      return (j[key] ?? []).filter((x) => !['done', 'closed', 'suspend'].includes(String(x.status))).map((x) => Number(x.id)).filter(Boolean).slice(0, MAX_DISCOVERED)
    } catch { return [] }
  }
  const configured = (await c.creds('WORKBENCH_ZENTAO_EXECUTION_IDS'))?.split(',').map((x) => Number(x.trim())).filter(Boolean) ?? []
  const [productIds, executions] = await Promise.all([
    c.zentaoProductIds.length ? c.zentaoProductIds : discover('products', 'products'),
    configured.length ? configured : discover('executions', 'executions'),
  ])
  const lists = await Promise.all([
    ...productIds.map(async (id) =>
      parseBugs(await getJson(c.fetch, `${base}/api.php/v1/products/${id}/bugs?limit=200`, { headers }), acct, id, base)),
    ...executions.map(async (id) =>
      parseTasks(await getJson(c.fetch, `${base}/api.php/v1/executions/${id}/tasks?limit=200`, { headers }), acct, id, base)),
  ])
  return lists.flat()
}
