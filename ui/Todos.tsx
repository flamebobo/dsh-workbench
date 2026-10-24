import * as React from 'react'
import { fmtSize, rpc, STATUS_LABEL, type Issue, type RpcError, type TodoResult, type WorkItem } from './api.ts'
import { TimesheetModal } from './Timesheet.tsx'
import type { PageProps } from './App.tsx'

const { useState, useMemo, useEffect } = React
type Row = TodoResult['items'][number]
const SOURCE_LABEL = { zentao: '禅道', gitlab: 'GitLab', jenkins: 'Jenkins', manual: '手工' }
const STARTABLE = ['backlog', 'todo', 'blocked']
const DEFAULT_AGENT = { gitlab: 'reviewer', jenkins: 'build-fixer', zentao: 'fullstack', manual: 'fullstack' }

export function Todos(p: PageProps & { todos?: TodoResult; todosAt?: Date; reloadTodos: () => Promise<void> }) {
  const { todos, state } = p
  const [filter, setFilter] = useState<'all' | WorkItem['source']>('all')
  const [selected, setSelected] = useState<string>()
  const [agentId, setAgentId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [reporting, setReporting] = useState(false)

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (todos?.items ?? []).filter((r) => (filter === 'all' || r.source === filter) && (showArchived || !r.archived) &&
      words.every((w) => `${r.ref}\n${r.title}\n${r.project}\n${r.description}`.toLowerCase().includes(w)))
  }, [todos, filter, q, showArchived])
  const count = (s: WorkItem['source']) => todos?.items.filter((r) => r.source === s && (showArchived || !r.archived)).length ?? 0
  const sel: Row | undefined = rows.find((r) => `${r.source}:${r.ref}` === selected) ?? undefined
  // keep a valid selection when the filter or the list changes
  useEffect(() => { if (rows[0] && !rows.some((r) => `${r.source}:${r.ref}` === selected)) setSelected(`${rows[0].source}:${rows[0].ref}`) }, [rows, selected])
  useEffect(() => { setAgentId(undefined) }, [selected])

  if (!todos) return <div className="wb-empty" style={{ flex: 1 }}>正在拉取待办…</div>
  const fallbacks = Object.entries(todos.sources).filter(([, s]) => s.mode === 'fallback')
  const issue: Issue | undefined = sel?.issueId ? state.issues.find((i) => i.id === sel.issueId) : undefined
  // a manual card knows its project directly; connector items are matched by source ids / name
  const project = issue?.projectId ? state.projects.find((x) => x.id === issue.projectId) : sel && state.projects.find((x) =>
    (x.gitlabProjectId != null && x.gitlabProjectId === sel.gitlabProjectId) ||
    (x.zentaoProductId != null && x.zentaoProductId === sel.zentaoProductId) ||
    (x.jenkinsJob && x.jenkinsJob === sel.jenkinsJob) || x.name === sel.project)

  const issueAgent = issue?.agentId
  // a card that exists but has no live session (manual task, or a blocked one) can be started from here
  const startable = !issue || (!issue.sourceRef && STARTABLE.includes(issue.status))

  async function archiveDone() {
    const n = (todos?.items ?? []).filter((r) => r.issueStatus === 'done' && !r.archived).length
    if (!n || !confirm(`归档全部 ${n} 个已完成的任务？（可在「显示已归档」里找回）`)) return
    try { p.notify(`已归档 ${await rpc<number>('issues.archiveDone')} 个`); await p.refresh(); await p.reloadTodos() } catch (e) { p.notify((e as Error).message) }
  }
  async function archive(r: Row, archived: boolean) {
    try { await rpc('todos.archive', { source: r.source, ref: r.ref, archived }); p.notify(archived ? `已归档 ${r.ref}` : `已取消归档 ${r.ref}`); await p.refresh(); await p.reloadTodos() } catch (e) { p.notify((e as Error).message) }
  }
  async function remove(r: Row) {
    if (!r.issueId || !confirm(`删除任务 ${r.ref}？删除后不可恢复（只想收起的话请用「归档」）。`)) return
    try { await rpc('issue.delete', { id: r.issueId }); p.notify(`已删除 ${r.ref}`); await p.refresh(); await p.reloadTodos() } catch (e) { p.notify((e as Error).message) }
  }

  async function start() {
    if (!sel) return
    setBusy(true)
    try {
      const { issue } = sel.issueId
        ? await rpc<{ issue: Issue }>('issue.start', { id: sel.issueId, agentId: agentId ?? issueAgent })
        : await rpc<{ issue: Issue }>('todos.start', { item: sel, agentId: agentId ?? DEFAULT_AGENT[sel.source] })
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
          <button className="wb-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部 {todos.items.filter((r) => showArchived || !r.archived).length}</button>
          {(['zentao', 'gitlab', 'jenkins', 'manual'] as const).filter((s) => s !== 'manual' || count('manual') > 0).map((s) => (
            <button key={s} className="wb-chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              {SOURCE_LABEL[s]} {count(s)}
            </button>
          ))}
          <input className="wb-input" style={{ width: 200 }} type="search" placeholder="搜索 编号 / 标题 / 项目" aria-label="搜索待办" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="wb-pick" style={{ padding: 0 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />显示已归档{todos.items.some((r) => r.archived) ? `（${todos.items.filter((r) => r.archived).length}）` : ''}</label>
          <span className="wb-grow" />
          {(['zentao', 'gitlab', 'jenkins'] as const).map((s) => (
            <span key={s} className={`wb-pill ${todos.sources[s].mode === 'live' ? 'live' : 'demo'}`}>
              {SOURCE_LABEL[s]} {todos.sources[s].mode === 'live' ? '实时' : '演示'}
            </span>
          ))}
          {p.todosAt && <span className="wb-muted" title="每分钟自动拉取">更新于 {p.todosAt.toLocaleTimeString('zh-CN', { hour12: false })}</span>}
          <button className="wb-btn" title="把已完成的任务全部归档" onClick={() => { void archiveDone() }}>归档已完成</button>
          <button className="wb-btn" onClick={() => { void p.reloadTodos() }}>刷新</button>
        </div>
        <table className="wb-table">
          <thead><tr><th style={{ width: 66 }}>优先级</th><th>待办事项</th><th style={{ width: 150 }}>来源</th><th style={{ width: 190 }}>项目 / 模块</th><th style={{ width: 90 }}>状态</th><th style={{ width: 90 }}>截止</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const key = `${r.source}:${r.ref}`
              return (
                <tr key={key} className={`row ${key === selected ? 'sel' : ''} ${r.archived ? 'arch' : ''}`} onClick={() => setSelected(key)}>
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
              <dt>工作目录</dt><dd className="wb-ellipsis" title={project?.cwd}>{project ? project.cwd : <span style={{ color: 'var(--wb-red)' }}>{sel.source === 'manual' ? '未选择项目，请在看板卡片里选择' : '未配置，请到「项目」页添加'}</span>}</dd>
            </dl>
            <h4>背景</h4>
            <div>{sel.description || '（无）'}</div>
            <h4>验收标准</h4>
            {sel.acceptance.length ? <ul className="wb-ac">{sel.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul> : <div className="wb-muted">未给出，开工后智能体会先与你确认。</div>}
            {issue?.command && <><h4>指令</h4><div>{'/' + issue.command}</div></>}
            {!!issue?.attachments?.length && <><h4>附件</h4>{issue.attachments.map((a) => <div className="wb-rel" key={a.id}>{a.name}<span className="wb-muted"> · {fmtSize(a.size)}</span></div>)}</>}
            {sel.related.length > 0 && <><h4>关联信息</h4>{sel.related.map((r, i) => <div className="wb-rel" key={i}>{r.label}{r.detail && <span className="wb-muted"> · {r.detail}</span>}</div>)}</>}
          </div>
          <div className="wb-detail-body" style={{ flex: 'none', paddingTop: 0, paddingBottom: 8 }}>
            {issue?.nextId && <div className="wb-sub">后续任务：{state.issues.find((x) => x.id === issue.nextId)?.key} {state.issues.find((x) => x.id === issue.nextId)?.title}</div>}
            {issue && state.issues.some((x) => x.nextId === issue.id) && <div className="wb-sub">前置任务：{state.issues.filter((x) => x.nextId === issue.id).map((x) => `${x.key} ${x.title}`).join('；')}</div>}
            {issue?.timesheet && <div className="wb-sub" style={{ color: 'var(--wb-green)' }}>已填报工时 {issue.timesheet.hours}h · {issue.timesheet.sparkinTaskName}</div>}
            <div className="wb-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {issue?.status === 'done' && !issue.timesheet && <button className="wb-btn" onClick={() => setReporting(true)}>填报 Sparkin 工时</button>}
              <button className="wb-btn" disabled={issue?.status === 'in_progress'} title={issue?.status === 'in_progress' ? '进行中的任务不能归档' : '归档后默认隐藏，可在「显示已归档」里找回'} onClick={() => { void archive(sel, !sel.archived) }}>{sel.archived ? '取消归档' : '归档'}</button>
              {issue && !issue.sourceRef && <button className="wb-btn danger" onClick={() => { void remove(sel) }}>删除</button>}
              {issue && issue.sourceRef && <button className="wb-btn danger" title="删除工作台里的卡片；禅道/GitLab/Jenkins 上的原条目不受影响，仍会出现在待办里" onClick={() => { void remove(sel) }}>删除卡片</button>}
            </div>
          </div>
          <div className="wb-detail-foot">
            {!startable ? (
              <>
                <span className="wb-pill">已开卡 {issue.key} · {STATUS_LABEL[issue.status]}</span>
                <span className="wb-grow" />
                <button className="wb-btn" onClick={() => p.go('board', issue.id)}>查看卡片</button>
              </>
            ) : (
              <>
                <select className="wb-select" style={{ width: 130 }} value={agentId ?? issueAgent ?? DEFAULT_AGENT[sel.source]} onChange={(e) => setAgentId(e.target.value)} aria-label="智能体">
                  {state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button className="wb-btn primary wb-grow" disabled={busy || !project} title={project ? undefined : '请先选择项目'} onClick={() => { void start() }}>{busy ? '正在创建会话…' : '开工（创建会话）'}</button>
              </>
            )}
          </div>
        </aside>
      )}
      {reporting && issue && <TimesheetModal p={p} only={[issue.id]} onClose={() => setReporting(false)} />}
    </>
  )
}
