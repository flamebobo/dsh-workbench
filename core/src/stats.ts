import type { Data, Issue } from './types.ts'

export interface Totals {
  cards: number
  /** Cards that got at least one agent run. */
  started: number
  done: number
  /** done / started */
  doneRate: number
  /** Cards whose agent finished at least once and so reached 待审核. */
  reviewed: number
  /** Of those, the ones a human finally accepted. */
  reviewPassRate: number
  mrs: number
  testsRun: number
  testsPassed: number
  hoursReported: number
  agentMinutes: number
}
export interface Stats {
  generatedAt: string
  totals: Totals
  /** Last 8 weeks, oldest first; `week` is the Monday (YYYY-MM-DD). */
  byWeek: { week: string; started: number; done: number }[]
  byAgent: { agentId: string; started: number; done: number }[]
  bySource: { source: string; started: number; done: number }[]
}

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mondayOf = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)) }
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0)

/** Everything here is derived from the cards and runs already stored on this machine; nothing is estimated. */
export function computeStats(d: Pick<Data, 'issues' | 'runs'>, nowMs = Date.now()): Stats {
  const runsOf = new Map<string, Data['runs']>()
  for (const r of d.runs) runsOf.set(r.issueId, [...(runsOf.get(r.issueId) ?? []), r])
  const started = d.issues.filter((i) => runsOf.has(i.id))
  const done = d.issues.filter((i) => i.status === 'done')
  const reviewed = d.issues.filter((i) => runsOf.get(i.id)?.some((r) => r.status === 'completed'))
  const checks = d.issues.flatMap((i) => i.checks ?? []).filter((c) => c.state !== 'running')
  const minutes = d.runs.reduce((n, r) => n + (r.endedAt ? Math.max(0, Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 60000 : 0), 0)
  const totals: Totals = {
    cards: d.issues.length, started: started.length, done: done.length, doneRate: ratio(done.length, started.length),
    reviewed: reviewed.length, reviewPassRate: ratio(reviewed.filter((i) => i.status === 'done').length, reviewed.length),
    mrs: d.issues.filter((i) => i.mr).length, testsRun: checks.length, testsPassed: checks.filter((c) => c.state === 'passed').length,
    hoursReported: Math.round(d.issues.reduce((n, i) => n + (i.timesheet?.hours ?? 0), 0) * 10) / 10, agentMinutes: Math.round(minutes),
  }
  const firstRun = (i: Issue) => runsOf.get(i.id)!.map((r) => r.startedAt).sort()[0]!
  const weeks = Array.from({ length: 8 }, (_, k) => day(new Date(mondayOf(nowMs).getFullYear(), mondayOf(nowMs).getMonth(), mondayOf(nowMs).getDate() - 7 * (7 - k))))
  const weekOf = (iso: string) => day(mondayOf(Date.parse(iso)))
  const byWeek = weeks.map((week) => ({
    week, started: started.filter((i) => weekOf(firstRun(i)) === week).length,
    // done cards are no longer edited, so their last update is when they were accepted
    done: done.filter((i) => weekOf(i.updatedAt) === week).length,
  }))
  const group = <K extends string>(key: (i: Issue) => K) => {
    const out = new Map<K, { started: number; done: number }>()
    for (const i of d.issues) {
      const g = out.get(key(i)) ?? { started: 0, done: 0 }
      if (runsOf.has(i.id)) g.started++
      if (i.status === 'done') g.done++
      out.set(key(i), g)
    }
    return [...out].map(([k, v]) => ({ k, ...v })).filter((g) => g.started || g.done)
  }
  return {
    generatedAt: new Date(nowMs).toISOString(), totals, byWeek,
    byAgent: group((i) => i.agentId).map(({ k, ...v }) => ({ agentId: k, ...v })),
    bySource: group((i) => i.sourceRef?.source ?? 'manual').map(({ k, ...v }) => ({ source: k, ...v })),
  }
}

/**
 * What an anonymous report contains: the counts above plus the plugin version and a random id. No titles, refs, paths, names or text.
 * Custom agents are folded into `custom` because their ids are free text.
 */
export function anonymousPayload(s: Stats, clientId: string, version: string, builtinAgents: Set<string>) {
  return {
    clientId, version, generatedAt: s.generatedAt, totals: s.totals, byWeek: s.byWeek,
    byAgent: s.byAgent.map((a) => ({ ...a, agentId: builtinAgents.has(a.agentId) ? a.agentId : 'custom' })),
    bySource: s.bySource,
  }
}

// Titles come from other people's Zentao / GitLab entries: a leading = + - @ would run as a formula when the CSV is opened in Excel.
const csvCell = (v: unknown) => {
  let s = String(v ?? '')
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** Per-card rows for the local export (this one does contain titles: it never leaves the machine on its own). */
export function exportRows(d: Pick<Data, 'issues' | 'runs' | 'projects'>) {
  return d.issues.map((i) => {
    const runs = d.runs.filter((r) => r.issueId === i.id)
    return {
      key: i.key, source: i.sourceRef?.source ?? 'manual', ref: i.sourceRef?.ref ?? '', title: i.title, status: i.status, agent: i.agentId,
      project: d.projects.find((p) => p.id === i.projectId)?.name ?? '', created: i.createdAt, firstRun: runs.map((r) => r.startedAt).sort()[0] ?? '',
      updated: i.updatedAt, runs: runs.length, testsPassed: i.checks?.at(-1)?.state === 'passed' ? 'yes' : i.checks?.length ? 'no' : '',
      mr: i.mr?.url ?? '', hours: i.timesheet?.hours ?? '',
    }
  })
}
export const toCsv = (rows: Record<string, unknown>[]) => {
  const cols = Object.keys(rows[0] ?? { key: 1 })
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') // BOM so Excel reads UTF-8
}
