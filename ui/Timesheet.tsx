import * as React from 'react'
import { rpc, type Issue } from './api.ts'
import { suggestTask, type SparkinProject, type SparkinTask } from '../core/src/sparkin.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React

interface Info { mode: 'demo' | 'live'; projects: SparkinProject[]; tasks: Record<string, SparkinTask[]> }
interface Row { hours: string; sparkinProjectId: string; taskId: string; picked: boolean }

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** 填报 Sparkin 工时: book hours for finished cards on the Sparkin project task they belong to. `only` limits it to given cards. */
export function TimesheetModal({ p, only, onClose }: { p: PageProps; only?: string[]; onClose: () => void }) {
  const { state } = p
  const [info, setInfo] = useState<Info>()
  const [date, setDate] = useState(today())
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const cards = state.issues.filter((i) => i.status === 'done' && !i.timesheet && (only ? only.includes(i.id) : !i.archivedAt))
  const reported = state.issues.filter((i) => i.timesheet)
  useEffect(() => { void rpc<Info>('sparkin.info').then(setInfo).catch((e) => p.notify((e as Error).message)) }, [])

  // defaults per card: its project's Sparkin project, the task that fits where the card came from, 1 hour
  useEffect(() => {
    if (!info) return
    setRows((cur) => {
      const next = { ...cur }
      for (const i of cards) {
        if (next[i.id]) continue
        const spId = state.projects.find((x) => x.id === i.projectId)?.sparkinProjectId ?? ''
        next[i.id] = { hours: String(state.settings?.defaultHours ?? 1), sparkinProjectId: spId, taskId: suggestTask(i, info.tasks[spId] ?? [])?.id ?? '', picked: true }
      }
      return next
    })
  }, [info, cards.map((c) => c.id).join()])

  const patch = (id: string, v: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id]!, ...v } }))
  const chosen = cards.filter((i) => rows[i.id]?.picked)
  const total = chosen.reduce((n, i) => n + (Number(rows[i.id]!.hours) || 0), 0)

  async function submit() {
    setBusy(true); setErrors([])
    try {
      const res = await rpc<{ issueId: string; ok: boolean; error?: string }[]>('timesheet.report', {
        date, entries: chosen.map((i) => ({ issueId: i.id, hours: Number(rows[i.id]!.hours), taskId: rows[i.id]!.taskId })),
      })
      const bad = res.filter((r) => !r.ok)
      await p.refresh()
      if (bad.length) setErrors(bad.map((b) => b.error ?? '失败'))
      p.notify(`已填报 ${res.length - bad.length} 条${bad.length ? `，${bad.length} 条失败` : ''}${info?.mode === 'demo' ? '（演示：未写入 Sparkin）' : ''}`)
      if (!bad.length) onClose()
    } catch (e) { setErrors([(e as Error).message]) } finally { setBusy(false) }
  }

  return (
    <div className="wb-modal-mask" style={{ zIndex: 40 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal" style={{ width: 'min(760px, 100%)' }} role="dialog" aria-label="填报 Sparkin 工时">
        <div className="wb-row"><b style={{ fontSize: 15 }}>填报 Sparkin 工时</b><span className="wb-grow" /><button className="wb-btn" aria-label="关闭" onClick={onClose}>✕</button></div>
        {info?.mode === 'demo' && <div className="wb-banner" style={{ margin: '8px 0 0' }}>演示模式：Sparkin 的接口文档还没提供，这里的填报只记录在工作台里，不会写入 Sparkin；拿到文档后接入即可，流程不变。</div>}
        <div className="wb-sub" style={{ margin: '8px 0' }}>只列出你已设为「已完成」且还没填报的卡片；任务与工时会按卡片所属项目对应到 Sparkin 的项目任务上。</div>
        <div className="wb-row" style={{ marginBottom: 8 }}><label className="wb-sub">工作日期</label>
          <input className="wb-input" type="date" style={{ width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {!info ? <div className="wb-muted">加载中…</div> : cards.length === 0 ? <div className="wb-empty" style={{ padding: 20 }}>没有待填报的已完成卡片。</div> : (
          <table className="wb-table">
            <thead><tr><th style={{ width: 28 }} /><th>任务</th><th style={{ width: 130 }}>Sparkin 项目</th><th style={{ width: 150 }}>Sparkin 任务</th><th style={{ width: 70 }}>工时(h)</th></tr></thead>
            <tbody>{cards.map((i: Issue) => {
              const r = rows[i.id]; if (!r) return null
              return (
                <tr key={i.id}>
                  <td><input type="checkbox" checked={r.picked} onChange={(e) => patch(i.id, { picked: e.target.checked })} /></td>
                  <td><span className="wb-muted">{i.key}</span> {i.title}</td>
                  <td><select className="wb-select" value={r.sparkinProjectId} onChange={(e) => patch(i.id, { sparkinProjectId: e.target.value, taskId: suggestTask(i, info.tasks[e.target.value] ?? [])?.id ?? '' })}>
                    <option value="">未选择</option>{info.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                  <td><select className="wb-select" value={r.taskId} onChange={(e) => patch(i.id, { taskId: e.target.value })}>
                    <option value="">未选择</option>{(info.tasks[r.sparkinProjectId] ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
                  <td><input className="wb-input" type="number" min="0.5" max="24" step="0.5" value={r.hours} onChange={(e) => patch(i.id, { hours: e.target.value })} /></td>
                </tr>)
            })}</tbody>
          </table>
        )}
        {errors.map((e, n) => <div className="wb-banner err" key={n} style={{ margin: '6px 0 0' }}>{e}</div>)}
        <div className="wb-row" style={{ marginTop: 12 }}>
          <span className="wb-muted">已选 {chosen.length} 张 · 共 {total} 小时{reported.length ? ` · 已填报过 ${reported.length} 张` : ''}</span><span className="wb-grow" />
          <button className="wb-btn" onClick={onClose}>关闭</button>
          <button className="wb-btn primary" disabled={busy || !chosen.length || chosen.some((i) => !rows[i.id]!.taskId)} onClick={() => { void submit() }}>{busy ? '提交中…' : '提交工时'}</button>
        </div>
      </div>
    </div>
  )
}
