import * as React from 'react'
import { rpc, STATUS_LABEL, type Issue, type RpcError, type TodoResult, type WorkItem } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useMemo, useEffect } = React
type Row = TodoResult['items'][number]
const SOURCE_LABEL = { zentao: '禅道', gitlab: 'GitLab', jenkins: 'Jenkins', manual: '手工' }
const DEFAULT_AGENT = { gitlab: 'reviewer', jenkins: 'build-fixer', zentao: 'fullstack', manual: 'fullstack' }

export function Todos(p: PageProps & { todos?: TodoResult; reloadTodos: () => Promise<void> }) {
  const { todos, state } = p
  const [filter, setFilter] = useState<'all' | WorkItem['source']>('all')
  const [selected, setSelected] = useState<string>()
  const [agentId, setAgentId] = useState<string>()
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => (todos?.items ?? []).filter((r) => filter === 'all' || r.source === filter), [todos, filter])
  const count = (s: WorkItem['source']) => todos?.items.filter((r) => r.source === s).length ?? 0
  const sel: Row | undefined = rows.find((r) => `${r.source}:${r.ref}` === selected) ?? undefined
  // keep a valid selection when the filter or the list changes
  useEffect(() => { if (rows[0] && !rows.some((r) => `${r.source}:${r.ref}` === selected)) setSelected(`${rows[0].source}:${rows[0].ref}`) }, [rows, selected])
  useEffect(() => { setAgentId(undefined) }, [selected])

  if (!todos) return <div className="wb-empty" style={{ flex: 1 }}>正在拉取待办…</div>
  const fallbacks = Object.entries(todos.sources).filter(([, s]) => s.mode === 'fallback')
  const issue: Issue | undefined = sel?.issueId ? state.issues.find((i) => i.id === sel.issueId) : undefined
  const project = sel && state.projects.find((x) =>
    (x.gitlabProjectId != null && x.gitlabProjectId === sel.gitlabProjectId) ||
    (x.zentaoProductId != null && x.zentaoProductId === sel.zentaoProductId) ||
    (x.jenkinsJob && x.jenkinsJob === sel.jenkinsJob) || x.name === sel.project)

  async function start() {
    if (!sel) return
    setBusy(true)
    try {
      const { issue } = await rpc<{ issue: Issue }>('todos.start', { item: sel, agentId: agentId ?? DEFAULT_AGENT[sel.source] })
      p.notify(`已开工：${issue.key}，会话已创建`)
      await p.refresh(); await p.reloadTodos()
      p.go('board')
    } catch (e) {
      const err = e as RpcError
      p.notify(err.code === 'duplicate' ? `${sel.ref} 已经开过卡片，不能重复开工` : `开工失败：${err.message}`)
      await p.refresh()
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="wb-main">
        {fallbacks.map(([k, s]) => (
          <div className="wb-banner err" key={k}>{SOURCE_LABEL[k as 'zentao']} 实时数据不可用，已降级为演示数据：{s.error}</div>
        ))}
        <div className="wb-toolbar">
          <button className="wb-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部 {todos.items.length}</button>
          {(['zentao', 'gitlab', 'jenkins'] as const).map((s) => (
            <button key={s} className="wb-chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              {SOURCE_LABEL[s]} {count(s)}
            </button>
          ))}
          <span className="wb-grow" />
          {(['zentao', 'gitlab', 'jenkins'] as const).map((s) => (
            <span key={s} className={`wb-pill ${todos.sources[s].mode === 'live' ? 'live' : 'demo'}`}>
              {SOURCE_LABEL[s]} {todos.sources[s].mode === 'live' ? '实时' : '演示'}
            </span>
          ))}
          <button className="wb-btn" onClick={() => { void p.reloadTodos() }}>刷新</button>
        </div>
        <table className="wb-table">
          <thead><tr><th style={{ width: 66 }}>优先级</th><th>待办事项</th><th style={{ width: 150 }}>来源</th><th style={{ width: 190 }}>项目 / 模块</th><th style={{ width: 90 }}>状态</th><th style={{ width: 90 }}>截止</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const key = `${r.source}:${r.ref}`
              return (
                <tr key={key} className={`row ${key === selected ? 'sel' : ''}`} onClick={() => setSelected(key)}>
                  <td><span className={`wb-pri ${r.priority}`}>{r.priority}</span></td>
                  <td>{r.title}{r.issueId && <span className="wb-pill" style={{ marginLeft: 8 }}>{state.issues.find((i) => i.id === r.issueId)?.key}</span>}</td>
                  <td><span className="wb-src"><i className={r.source} />{r.ref}</span></td>
                  <td className="wb-muted wb-ellipsis" style={{ maxWidth: 190 }}>{r.project}</td>
                  <td>{r.issueStatus ? <span className="wb-pill">{STATUS_LABEL[r.issueStatus]}</span> : <span className="wb-muted">{r.statusText}</span>}</td>
                  <td className="wb-muted">{r.due ? r.due.slice(5) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <div className="wb-empty">没有待办。</div>}
      </div>
      {sel && (
        <aside className="wb-detail">
          <div className="wb-detail-body">
            <div className="wb-sub"><span className="wb-src"><i className={sel.source} />{SOURCE_LABEL[sel.source]} · {sel.ref}</span> · {sel.project}</div>
            <h3 style={{ marginTop: 6 }}>{sel.title}</h3>
            <dl className="wb-kv">
              <dt>优先级</dt><dd><span className={`wb-pri ${sel.priority}`}>{sel.priority}</span></dd>
              <dt>状态</dt><dd>{sel.statusText}</dd>
              <dt>截止</dt><dd>{sel.due ?? '—'}</dd>
              <dt>工作目录</dt><dd className="wb-ellipsis" title={project?.cwd}>{project ? project.cwd : <span style={{ color: 'var(--wb-red)' }}>未配置，请到「项目」页添加</span>}</dd>
            </dl>
            <h4>背景</h4>
            <div>{sel.description || '（无）'}</div>
            <h4>验收标准</h4>
            {sel.acceptance.length ? <ul className="wb-ac">{sel.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul> : <div className="wb-muted">未给出，开工后智能体会先与你确认。</div>}
            {sel.related.length > 0 && <><h4>关联信息</h4>{sel.related.map((r, i) => <div className="wb-rel" key={i}>{r.label}{r.detail && <span className="wb-muted"> · {r.detail}</span>}</div>)}</>}
          </div>
          <div className="wb-detail-foot">
            {issue ? (
              <>
                <span className="wb-pill">已开卡 {issue.key} · {STATUS_LABEL[issue.status]}</span>
                <span className="wb-grow" />
                <button className="wb-btn" onClick={() => p.go('board', issue.id)}>查看卡片</button>
              </>
            ) : (
              <>
                <select className="wb-select" style={{ width: 130 }} value={agentId ?? DEFAULT_AGENT[sel.source]} onChange={(e) => setAgentId(e.target.value)} aria-label="智能体">
                  {state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button className="wb-btn primary wb-grow" disabled={busy || !project} onClick={() => { void start() }}>{busy ? '正在创建会话…' : '开工（创建会话）'}</button>
              </>
            )}
          </div>
        </aside>
      )}
    </>
  )
}
