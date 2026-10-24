import { rpc, type Issue, type State } from './api.ts'

/** Does a card match the search box (key, title, description, source number, agent, project)? */
export function matchesIssue(i: Issue, q: string, s: State): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [i.key, i.title, i.description, i.sourceRef?.ref, s.agents.find((a) => a.id === i.agentId)?.name, s.projects.find((p) => p.id === i.projectId)?.name].join('\n').toLowerCase()
  return needle.split(/\s+/).every((w) => hay.includes(w))
}

/** After a card is finished by the human, offer to start the card chained after it. */
export async function offerNext(id: string, s: State, notify: (m: string) => void) {
  const cur = s.issues.find((i) => i.id === id)
  const next = cur?.nextId ? s.issues.find((i) => i.id === cur.nextId) : undefined
  if (!cur || !next || !['backlog', 'todo', 'blocked'].includes(next.status) || next.archivedAt) return
  if (!confirm(`${cur.key} 已完成。接着开工下一个任务「${next.key} ${next.title}」吗？`)) return
  try { await rpc('issue.start', { id: next.id }); notify(`已开工下一个任务：${next.key}`) } catch (e) { notify((e as Error).message) }
}
