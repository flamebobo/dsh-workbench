import * as React from 'react'
import { ago, rpc, STATUS_LABEL, type Issue, type Status } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React
const COLUMNS: Status[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked']

export function Board(p: PageProps) {
  const { state } = p
  const [dragging, setDragging] = useState<string>()
  const [over, setOver] = useState<Status>()
  const [openId, setOpenId] = useState<string | undefined>(p.focusIssue)
  const [adding, setAdding] = useState<Status>()
  const [title, setTitle] = useState('')
  useEffect(() => { if (p.focusIssue) setOpenId(p.focusIssue) }, [p.focusIssue])

  const running = new Set(state.runs.filter((r) => r.status === 'running').map((r) => r.issueId))
  const agentName = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id

  async function move(id: string, status: Status) {
    const cur = state.issues.find((i) => i.id === id)
    if (!cur || cur.status === status) return
    try { await rpc('issue.status', { id, status }); await p.refresh() } catch (e) { p.notify((e as Error).message) }
  }
  async function add(status: Status) {
    if (!title.trim()) { setAdding(undefined); return }
    try { await rpc('issue.create', { title, status }); setTitle(''); setAdding(undefined); await p.refresh() } catch (e) { p.notify((e as Error).message) }
  }

  const open = state.issues.find((i) => i.id === openId)
  return (
    <div className="wb-main" style={{ position: 'relative' }}>
      <div className="wb-board">
        {COLUMNS.map((col) => {
          const items = state.issues.filter((i) => i.status === col).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          return (
            <section key={col} className={`wb-col ${over === col ? 'over' : ''}`} aria-label={STATUS_LABEL[col]}
              onDragOver={(e) => { e.preventDefault(); setOver(col) }} onDragLeave={() => setOver((o) => (o === col ? undefined : o))}
              onDrop={(e) => { e.preventDefault(); setOver(undefined); const id = e.dataTransfer.getData('text/plain') || dragging; if (id) void move(id, col) }}>
              <div className="wb-col-h"><span className={`wb-dot ${col}`} />{STATUS_LABEL[col]}<span className="n">{items.length}</span>
                <button className="wb-btn" style={{ padding: '0 8px' }} aria-label={`在${STATUS_LABEL[col]}新建`} onClick={() => setAdding(col)}>+</button></div>
              <div className="wb-col-b">
                {adding === col && (
                  <input className="wb-input" autoFocus placeholder="标题，回车创建" value={title} onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void add(col); if (e.key === 'Escape') setAdding(undefined) }} onBlur={() => { void add(col) }} />
                )}
                {items.map((i) => (
                  <article key={i.id} className={`wb-card ${dragging === i.id ? 'drag' : ''}`} draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', i.id); setDragging(i.id) }} onDragEnd={() => { setDragging(undefined); setOver(undefined) }}
                    onClick={() => setOpenId(i.id)}>
                    <div className="k">
                      {running.has(i.id) && <span className="wb-spin" title="会话运行中" />}
                      <span>{i.key}</span>{i.sourceRef && <span>· {i.sourceRef.ref}</span>}
                    </div>
                    <div className="t">{i.title}</div>
                    {i.note && <div className="wb-ellipsis" style={{ color: 'var(--wb-red)', fontSize: 11, marginBottom: 4 }} title={i.note}>{i.note}</div>}
                    <div className="m"><span className="wb-pill">{agentName(i.agentId)}</span><span style={{ marginLeft: 'auto' }}>{ago(i.updatedAt)}</span></div>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {open && <IssueModal issue={open} p={p} onClose={() => setOpenId(undefined)} />}
    </div>
  )
}

function IssueModal({ issue, p, onClose }: { issue: Issue; p: PageProps; onClose: () => void }) {
  const { state } = p
  const [title, setTitle] = useState(issue.title)
  const [description, setDescription] = useState(issue.description)
  const [agentId, setAgentId] = useState(issue.agentId)
  const [status, setStatus] = useState<Status>(issue.status)
  useEffect(() => { setStatus(issue.status) }, [issue.status]) // a session ending changes it under us
  const runs = state.runs.filter((r) => r.issueId === issue.id).reverse()

  async function save() {
    try {
      await rpc('issue.update', { id: issue.id, patch: { title, description, agentId } })
      if (status !== issue.status) await rpc('issue.status', { id: issue.id, status })
      await p.refresh(); onClose()
    } catch (e) { p.notify((e as Error).message) }
  }
  async function remove() {
    if (!confirm(`删除卡片 ${issue.key}？`)) return
    await rpc('issue.delete', { id: issue.id }); await p.refresh(); onClose()
  }

  return (
    <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal" role="dialog" aria-label={issue.key}>
        <div className="wb-row"><span className="wb-sub">{issue.key}{issue.sourceRef && ` · ${issue.sourceRef.source} ${issue.sourceRef.ref}`}</span><span className="wb-grow" />
          {issue.sessionId && <button className="wb-btn" onClick={() => p.openSession(issue.sessionId!)}>打开关联会话 ↗</button>}
          <button className="wb-btn" aria-label="关闭" onClick={onClose}>✕</button></div>
        <div className="wb-field"><label>标题</label><input className="wb-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="wb-field"><label>描述</label><textarea className="wb-textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        {issue.acceptance.length > 0 && <div className="wb-field"><label>验收标准</label><ul className="wb-ac">{issue.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
        <div className="wb-row">
          <div className="wb-field wb-grow"><label>指派智能体</label>
            <select className="wb-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>{state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div className="wb-field wb-grow"><label>状态（已完成只能由你设置）</label>
            <select className="wb-select" value={status} onChange={(e) => setStatus(e.target.value as Status)}>{COLUMNS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
        </div>
        {issue.note && <div className="wb-banner err" style={{ margin: '4px 0' }}>{issue.note}</div>}
        <div className="wb-field"><label>执行记录</label>
          {runs.length ? runs.map((r) => (
            <div className="wb-rel" key={r.id}>
              <b>{r.status === 'running' ? '运行中' : r.status === 'completed' ? '已结束' : r.status === 'failed' ? '出错' : '已中断'}</b>
              <span className="wb-muted"> · {agentName(state, r.agentId)} · {ago(r.startedAt)}</span>
              {r.error && <div style={{ color: 'var(--wb-red)' }}>{r.error}</div>}
              {r.finalText && <div className="wb-muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', marginTop: 4 }}>{r.finalText}</div>}
            </div>
          )) : <div className="wb-muted">暂无执行记录</div>}</div>
        <div className="wb-row"><button className="wb-btn danger" onClick={() => { void remove() }}>删除</button><span className="wb-grow" />
          <button className="wb-btn" onClick={onClose}>取消</button><button className="wb-btn primary" onClick={() => { void save() }}>保存</button></div>
      </div>
    </div>
  )
}

const agentName = (s: PageProps['state'], id: string) => s.agents.find((a) => a.id === id)?.name ?? id
