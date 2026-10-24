import * as React from 'react'
import { ask, ago, BUILD_LABEL, buildColor, canWriteBack, rpc, STATUS_LABEL, type Attachment, type Issue, type Status } from './api.ts'
import { Composer } from './Composer.tsx'
import { BuildModal } from './Builds.tsx'
import { TimesheetModal } from './Timesheet.tsx'
import { ChangesModal } from './Changes.tsx'
import { WriteBackModal } from './WriteBack.tsx'
import { ReportModal } from './Report.tsx'
import { matchesIssue, offerNext } from './chain.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React
const COLUMNS: Status[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked']

/** 停止: confirm, then interrupt the card's session. `busy` keeps a second click from sending it twice. */
const stopping = new Set<string>() // synchronous, so a double click is caught before React has re-rendered the disabled button
async function stopCard(issue: Issue, p: PageProps, busy: (b: boolean) => void) {
  if (stopping.has(issue.id)) return
  stopping.add(issue.id)
  try { await stopConfirmed(issue, p, busy) } finally { stopping.delete(issue.id) }
}
async function stopConfirmed(issue: Issue, p: PageProps, busy: (b: boolean) => void) {
  if (!(await ask(`停止 ${issue.key} 的智能体？当前这一轮会被中断，卡片进入「已阻塞」（已手动停止），之后可以点「重试」重新开工。已经做出的改动会保留在任务分支里。`))) return
  busy(true)
  try { await rpc('issue.stop', { id: issue.id }); p.notify(`已停止 ${issue.key}，可以重试`) } catch (e) { p.notify((e as Error).message) } finally { busy(false); await p.refresh() }
}

export function Board(p: PageProps) {
  const { state } = p
  const [dragging, setDragging] = useState<string>()
  const [over, setOver] = useState<Status>()
  const [openId, setOpenId] = useState<string | undefined>(p.focusIssue)
  const [creating, setCreating] = useState<Status>()
  const [building, setBuilding] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [report, setReport] = useState(false)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean }>()
  const [stoppingId, setStopping] = useState<string>()
  const [q, setQ] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  useEffect(() => { if (p.focusIssue) setOpenId(p.focusIssue) }, [p.focusIssue])

  const running = new Set(state.runs.filter((r) => r.status === 'running').map((r) => r.issueId))
  const agentName = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id

  /** Drop a card into a column: at the end, or just before `beforeId` (that is how a column is reordered). */
  async function move(id: string, status: Status, beforeId?: string) {
    const cur = state.issues.find((i) => i.id === id)
    if (!cur) return
    try {
      await rpc('issue.move', { id, status, beforeId }); await p.refresh()
      if (status === 'done' && cur.status !== 'done') await offerNext(id, state, p.notify)
    } catch (e) { p.notify((e as Error).message) }
  }
  async function retry(i: Issue) {
    try { await rpc('issue.start', { id: i.id }); p.notify(`已重新开工：${i.key}`); await p.refresh() } catch (e) { p.notify((e as Error).message); await p.refresh() }
  }
  const auto = !!state.autoRun
  async function setAuto(enabled: boolean) {
    if (enabled === auto) return
    try {
      await rpc('autorun.set', { enabled })
      const queued = state.issues.filter((i) => i.status === 'todo' && !i.archivedAt).length
      p.notify(enabled ? (queued ? `已切换为自动运行：按「待办」从上到下依次开工（共 ${queued} 张，一次一个）` : '已切换为自动运行：之后进入「待办」的任务会按顺序自动开工') : '已切换为手动运行')
      await p.refresh()
    } catch (e) { p.notify((e as Error).message) }
  }
  async function archiveDone() {
    const n = state.issues.filter((i) => i.status === 'done' && !i.archivedAt).length
    if (!n || !(await ask(`归档全部 ${n} 张已完成的卡片？（可在「显示已归档」里找回）`))) return
    try { p.notify(`已归档 ${await rpc<number>('issues.archiveDone')} 张`); await p.refresh() } catch (e) { p.notify((e as Error).message) }
  }
  const archivedCount = state.issues.filter((i) => i.archivedAt).length
  const visible = state.issues.filter((i) => (showArchived || !i.archivedAt) && matchesIssue(i, q, state))
  const keyOf = (id?: string) => state.issues.find((i) => i.id === id)?.key
  const open = state.issues.find((i) => i.id === openId)
  return (
    <div className="wb-main" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div className="wb-toolbar" style={{ paddingBottom: 0 }}>
        <input className="wb-input" style={{ width: 240 }} type="search" placeholder="搜索 编号 / 标题 / 描述 / 智能体 / 项目" aria-label="搜索任务" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="wb-pick" style={{ padding: 0 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />显示已归档{archivedCount ? `（${archivedCount}）` : ''}</label>
        {q && <span className="wb-muted">匹配 {visible.length} 张</span>}
        <span className="wb-grow" />
        <span className="wb-agents" title="正在工作的智能体数量"><span className="wb-dotx" style={{ background: state.working ? 'var(--wb-green)' : 'var(--wb-fg3)' }} />{state.working ?? 0} 个智能体工作中</span>
        <div className="wb-seg" role="group" aria-label="运行方式" title="手动：点「开工」才运行。自动：按「待办」列从上到下，一次一个，自动开工；拖动卡片可调整顺序">
          <button aria-pressed={!auto} onClick={() => { void setAuto(false) }}>手动运行</button>
          <button aria-pressed={auto} onClick={() => { void setAuto(true) }}>自动运行</button>
        </div>
        <button className="wb-btn" title="把「已完成」的卡片全部归档，看板更清爽" onClick={() => { void archiveDone() }}>归档已完成</button>
        <button className="wb-btn" title="把已完成的任务和工时填到 Sparkin 对应的项目任务上" onClick={() => setReporting(true)}>填报 Sparkin 工时</button>
        <button className="wb-btn" title="根据今天 / 本周的卡片、提交和工时生成日报或周报草稿，可编辑、复制" onClick={() => setReport(true)}>日报 / 周报</button>
        <button className="wb-btn" title="选择 Jenkins Job 构建一次，验证这批修复" onClick={() => setBuilding(true)}>构建验证</button>
      </div>
      <div className="wb-board" style={{ flex: 1, minHeight: 0, height: 'auto' }}>
        {COLUMNS.map((col) => {
          const items = visible.filter((i) => i.status === col).sort(byOrder)
          return (
            <section key={col} className={`wb-col ${over === col ? 'over' : ''}`} aria-label={STATUS_LABEL[col]}
              onDragOver={(e) => { e.preventDefault(); setOver(col) }} onDragLeave={() => setOver((o) => (o === col ? undefined : o))}
              onDrop={(e) => { e.preventDefault(); setOver(undefined); setDropAt(undefined); const id = e.dataTransfer.getData('text/plain') || dragging; if (id) void move(id, col) }}>
              <div className="wb-col-h"><span className={`wb-dot ${col}`} />{STATUS_LABEL[col]}<span className="n">{items.length}</span>
                <button className="wb-btn" style={{ padding: '0 8px' }} aria-label={`在${STATUS_LABEL[col]}新建`} onClick={() => setCreating(col)}>+</button></div>
              <div className="wb-col-b">
                {auto && col === 'todo' && <div className="wb-sub" style={{ padding: '0 2px' }}>自动运行中：从上到下依次开工，可拖动调整顺序</div>}
                {items.map((i, n) => (
                  <article key={i.id} className={`wb-card ${dragging === i.id ? 'drag' : ''} ${i.archivedAt ? 'arch' : ''} ${dropAt?.id === i.id && dragging !== i.id ? (dropAt.after ? 'dropa' : 'dropb') : ''}`} draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', i.id); setDragging(i.id) }} onDragEnd={() => { setDragging(undefined); setOver(undefined); setDropAt(undefined) }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(col); const r = e.currentTarget.getBoundingClientRect(); setDropAt({ id: i.id, after: e.clientY > r.top + r.height / 2 }) }}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation()
                      const id = e.dataTransfer.getData('text/plain') || dragging
                      const after = dropAt?.id === i.id && dropAt.after
                      setOver(undefined); setDropAt(undefined)
                      if (id) void move(id, col, after ? items[n + 1]?.id : i.id)
                    }}
                    onClick={() => setOpenId(i.id)}>
                    <div className="k">
                      {running.has(i.id) && <span className="wb-spin" title="会话运行中" />}{auto && col === 'todo' && <span className="wb-pill" title="自动运行的顺序">#{n + 1}</span>}
                      <span>{i.key}</span>{i.sourceRef && <span>· {i.sourceRef.ref}</span>}{state.demoLeft?.includes(i.id) && <span className="wb-pill demo" title="来自演示数据；该系统已接入真实数据，可在「设置 → 插件设置」里清理">演示</span>}{i.archivedAt && <span className="wb-pill">已归档</span>}
                    </div>
                    <div className="t">{i.title}</div>
                    {i.due && <div className="wb-bld wb-muted" style={{ color: i.status !== 'done' && i.due < new Date().toISOString().slice(0, 10) ? 'var(--wb-red)' : undefined }} title="截止日期">截止 {i.due.slice(5)}</div>}
                    {i.note && <div className="wb-ellipsis" style={{ color: i.status === 'blocked' ? 'var(--wb-red)' : 'var(--wb-amber)', fontSize: 11, marginBottom: 4 }} title={i.note}>{i.note}</div>}
                    {lastBuild(state.builds, i.id) && <div className="wb-bld" style={{ color: buildColor(lastBuild(state.builds, i.id)!.state) }}>构建 {lastBuild(state.builds, i.id)!.job}{lastBuild(state.builds, i.id)!.number ? ` #${lastBuild(state.builds, i.id)!.number}` : ''} · {BUILD_LABEL[lastBuild(state.builds, i.id)!.state]}</div>}
                    {(i.nextId || state.issues.some((x) => x.nextId === i.id)) && <div className="wb-bld wb-muted">{state.issues.some((x) => x.nextId === i.id) ? `← ${state.issues.filter((x) => x.nextId === i.id).map((x) => x.key).join(' ')}` : ''}{i.nextId ? `  → ${keyOf(i.nextId)}` : ''}</div>}
                    {(i.checks?.length || i.mr) && <div className="wb-bld">{i.checks?.length ? <span style={{ color: checkColor(i.checks.at(-1)!.state) }}>测试 {checkLabel(i.checks.at(-1)!.state)}</span> : null}{i.checks?.length && i.mr ? ' · ' : ''}{i.mr && <a href={i.mr.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>MR !{i.mr.iid} ↗</a>}</div>}
                    {i.timesheet && <div className="wb-bld" style={{ color: 'var(--wb-green)' }}>已填报工时 {i.timesheet.hours}h · {i.timesheet.sparkinTaskName}</div>}
                    <div className="m"><span className="wb-pill">{agentName(i.agentId)}</span>
                      {i.status === 'blocked' && i.projectId && !i.archivedAt && <button className="wb-btn" style={{ padding: '0 8px' }} title="用同一个智能体重新开工，沿用原来的分支和工作树" onClick={(e) => { e.stopPropagation(); void retry(i) }}>重试</button>}
                      {i.status === 'in_progress' && running.has(i.id) && <button className="wb-btn" style={{ padding: '0 8px' }} disabled={stoppingId === i.id} title="中断这张卡片的智能体，卡片进入已阻塞（已手动停止）" onClick={(e) => { e.stopPropagation(); void stopCard(i, p, (b) => setStopping(b ? i.id : undefined)) }}>{stoppingId === i.id ? '停止中…' : '停止'}</button>}
                      {i.status === 'in_review' && !i.archivedAt && <button className="wb-btn" style={{ padding: '0 8px' }} title="验收通过，移到已完成" onClick={(e) => { e.stopPropagation(); void move(i.id, 'done') }}>验收通过</button>}
                      <span style={{ marginLeft: 'auto' }}>{ago(i.updatedAt)}</span></div>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {open && <IssueModal issue={open} p={p} onClose={() => setOpenId(undefined)} />}
      {creating && <IssueModal initialStatus={creating} p={p} onClose={() => setCreating(undefined)} />}
      {building && <BuildModal p={p} onClose={() => setBuilding(false)} />}
      {reporting && <TimesheetModal p={p} onClose={() => setReporting(false)} />}
      {report && <ReportModal p={p} onClose={() => setReport(false)} onTask={(i) => setOpenId(i.id)} />}
    </div>
  )
}

const checkLabel = (s: string) => (s === 'passed' ? '通过' : s === 'failed' ? '未通过' : '运行中…')
const checkColor = (s: string) => (s === 'passed' ? 'var(--wb-green)' : s === 'failed' ? 'var(--wb-red)' : 'var(--wb-amber)')
const byOrder = (a: Issue, b: Issue) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt)
const lastBuild = (builds: PageProps['state']['builds'], issueId: string) => (builds ?? []).filter((b) => b.issueIds.includes(issueId)).at(-1)

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
const STARTABLE: Status[] = ['backlog', 'todo', 'blocked']

/** Create (no `issue`) or edit one card. 开工 saves the form, then starts a DSH session in the chosen project's directory. */
export function IssueModal({ issue, initialStatus, p, onClose }: { issue?: Issue; initialStatus?: Status; p: PageProps; onClose: () => void }) {
  const { state } = p
  const [title, setTitle] = useState(issue?.title ?? '')
  // the description box works like DSH's composer: a leading /plan or /goal is the task's command
  const [text, setText] = useState(issue?.command ? `/${issue.command} ${issue.description}` : (issue?.description ?? ''))
  const [acceptance, setAcceptance] = useState((issue?.acceptance ?? []).join('\n'))
  const [due, setDue] = useState(issue?.due ?? '')
  // one line per item: `标题 | 说明`
  const [related, setRelated] = useState((issue?.related ?? []).map((r) => (r.detail ? `${r.label} | ${r.detail}` : r.label)).join('\n'))
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>(issue?.priority ?? 'P2')
  const [projectId, setProjectId] = useState(issue?.projectId ?? '')
  const [agentId, setAgentId] = useState(issue?.agentId ?? 'fullstack')
  const [status, setStatus] = useState<Status>(issue?.status ?? initialStatus ?? 'backlog')
  const [files, setFiles] = useState<Attachment[]>(issue?.attachments ?? [])
  const [busy, setBusy] = useState(false)
  const [stoppingNow, setStoppingNow] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [writingBack, setWritingBack] = useState(false)
  useEffect(() => { if (issue) setStatus(issue.status) }, [issue?.status]) // a session ending changes it under us
  const runs = issue ? state.runs.filter((r) => r.issueId === issue.id).reverse() : []
  const canStart = !issue || STARTABLE.includes(issue.status)
  const lines = acceptance.split('\n')

  const fields = () => {
    const m = /^\/(plan|goal)(?:\s+([\s\S]*))?$/.exec(text.trimStart())
    return { title, description: m ? (m[2] ?? '') : text, command: m ? m[1] : '', acceptance: lines, priority, projectId, agentId, attachments: files, due, related: related.split('\n').map((l) => { const [label = '', ...rest] = l.split('|'); return { label: label.trim(), detail: rest.join('|').trim() || undefined } }).filter((r) => r.label) }
  }
  async function save(start: boolean) {
    if (!title.trim()) { p.notify('标题不能为空'); return }
    if (start && !projectId) { p.notify('开工前请先选择项目（会话的工作目录）'); return }
    setBusy(true)
    try {
      let id = issue?.id
      if (issue) {
        await rpc('issue.update', { id: issue.id, patch: fields() })
        if (!start && status !== issue.status) {
          await rpc('issue.status', { id: issue.id, status })
          if (status === 'done') { await p.refresh(); await offerNext(issue.id, { ...state, issues: state.issues.map((x) => (x.id === issue.id ? { ...x, status } : x)) }, p.notify) }
        }
      } else {
        id = (await rpc<Issue>('issue.create', { ...fields(), status })).id
      }
      if (start) {
        const r = await rpc<{ issue: Issue }>('issue.start', { id, agentId })
        p.notify(`已开工：${r.issue.key}，会话已创建`)
        p.go('board') // from the to-do page too, like its own 开工 button
      }
      await p.refresh(); onClose()
    } catch (e) { p.notify((e as Error).message); await p.refresh() } finally { setBusy(false) }
  }
  async function archive() {
    if (!issue) return
    try { await rpc('issue.archive', { id: issue.id, archived: !issue.archivedAt }); p.notify(issue.archivedAt ? `已取消归档 ${issue.key}` : `已归档 ${issue.key}`); await p.refresh(); onClose() } catch (e) { p.notify((e as Error).message) }
  }
  async function remove() {
    if (!issue || !(await ask(`删除卡片 ${issue.key}？删除后不可恢复（只想收起的话请用「归档」）。`))) return
    await rpc('issue.delete', { id: issue.id }); await p.refresh(); onClose()
  }

  return (
    <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {reporting && issue && <TimesheetModal p={p} only={[issue.id]} onClose={() => setReporting(false)} />}
      {writingBack && issue && <WriteBackModal issue={issue} p={p} onClose={() => setWritingBack(false)} />}
      {viewing && issue && <ChangesModal issue={issue} notify={p.notify} onClose={() => setViewing(false)} />}
      <div className="wb-modal" role="dialog" aria-label={issue?.key ?? '新建任务'}>
        <div className="wb-row"><span className="wb-sub">{issue ? `${issue.key}${issue.sourceRef ? ` · ${issue.sourceRef.source} ${issue.sourceRef.ref}` : ' · 手工任务'}` : '新建任务'}</span><span className="wb-grow" />
          {issue && issue.status === 'in_progress' && state.runs.some((r) => r.issueId === issue.id && r.status === 'running') && <button className="wb-btn danger" disabled={stoppingNow} onClick={() => { void stopCard(issue, p, setStoppingNow) }}>{stoppingNow ? '停止中…' : '停止'}</button>}
          {issue?.sessionId && (p.openSession
            ? <button className="wb-btn" onClick={() => p.openSession!(issue.sessionId!)}>打开关联会话 ↗</button>
            : <span className="wb-sub" title="Codex 线程 ID（工作台起的线程不会出现在当前对话里）">线程 {issue.sessionId.slice(0, 8)}</span>)}
          <button className="wb-btn" aria-label="关闭" onClick={onClose}>✕</button></div>
        <div className="wb-field"><label>标题</label><input className="wb-input" autoFocus={!issue} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：补充对账脚本的幂等校验" /></div>
        <div className="wb-field"><label>任务描述</label>
          <Composer text={text} onText={setText} files={files} onFiles={setFiles} notify={p.notify} projectId={projectId || undefined} placeholder="任务背景、现状、要做什么；链接直接写在文字里，@ 可引用项目文件" /></div>
        <div className="wb-field"><label>验收标准（每行一条，开工时会写进首条消息）</label>
          <textarea className="wb-textarea" style={{ minHeight: 70 }} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder={'重复请求不重复入账\n补充单测并通过'} /></div>
        <div className="wb-row">
          <div className="wb-field wb-grow"><label>项目（工作目录）</label>
            <select className="wb-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">未选择</option>{state.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="wb-field" style={{ width: 150 }}><label>截止日期</label>
            <input className="wb-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div className="wb-field" style={{ width: 90 }}><label>优先级</label>
            <select className="wb-select" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select></div>
        </div>
        <div className="wb-field"><label>关联信息（每行一条：标题 | 说明，显示在「我的待办」详情里）</label>
          <textarea className="wb-textarea" style={{ minHeight: 56 }} value={related} onChange={(e) => setRelated(e.target.value)} placeholder={'分支 fix/pay-callback | payment-core\nMR !11287 | 相关改动'} /></div>
        <div className="wb-row">
          <div className="wb-field wb-grow"><label>指派智能体</label>
            <select className="wb-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>{state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div className="wb-field wb-grow"><label>状态（已完成只能由你设置）</label>
            <select className="wb-select" value={status} onChange={(e) => setStatus(e.target.value as Status)}>{COLUMNS.filter((s) => s !== 'in_progress' || issue?.status === 'in_progress').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
        </div>
        {issue && <ChainField issue={issue} p={p} />}
        {issue && <CodeField issue={issue} p={p} onChanges={() => setViewing(true)} />}
        {issue?.writeBack && <div className="wb-field"><label>禅道回写</label><div className="wb-rel">已评论并改为<b>已解决</b> · {ago(issue.writeBack.at)}{issue.writeBack.demo ? ' · 演示，未发送到禅道' : ''}<div className="wb-muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{issue.writeBack.comment}</div></div></div>}
        {issue?.timesheet && <div className="wb-field"><label>工时</label><div className="wb-rel">已填报 <b>{issue.timesheet.hours}h</b> · {issue.timesheet.date} · Sparkin「{issue.timesheet.sparkinTaskName}」<span className="wb-muted"> · 记录 {issue.timesheet.entryId}{issue.timesheet.demo ? ' · 演示，未写入 Sparkin' : ''}</span></div></div>}
        {issue?.note && <div className={`wb-banner ${issue.status === 'blocked' ? 'err' : ''}`} style={{ margin: '4px 0' }}>{issue.note}</div>}
        {issue && (state.builds ?? []).some((b) => b.issueIds.includes(issue.id)) && <div className="wb-field"><label>构建验证</label>
          {(state.builds ?? []).filter((b) => b.issueIds.includes(issue.id)).reverse().map((b) => (
            <div className="wb-rel" key={b.id}><b style={{ color: buildColor(b.state) }}>{BUILD_LABEL[b.state]}</b> · {b.job}{b.number ? ` #${b.number}` : ''}<span className="wb-muted"> · {ago(b.createdAt)}{b.demo ? ' · 演示' : ''}</span>
              {b.buildUrl && <> <a href={b.buildUrl} target="_blank" rel="noreferrer noopener">打开 ↗</a></>}{b.error && <div style={{ color: 'var(--wb-red)' }}>{b.error}</div>}</div>))}</div>}
        {issue && <div className="wb-field"><label>执行记录</label>
          {runs.length ? runs.map((r) => (
            <div className="wb-rel" key={r.id}>
              <b>{r.status === 'running' ? '运行中' : r.status === 'completed' ? '已结束' : r.status === 'failed' ? '出错' : '已中断'}</b>
              <span className="wb-muted"> · {agentName(state, r.agentId)} · {ago(r.startedAt)}</span>
              {r.error && <div style={{ color: 'var(--wb-red)' }}>{r.error}</div>}
              {r.finalText && <div className="wb-muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', marginTop: 4 }}>{r.finalText}</div>}
            </div>
          )) : <div className="wb-muted">暂无执行记录</div>}</div>}
        <div className="wb-row">{issue && <button className="wb-btn danger" onClick={() => { void remove() }}>删除</button>}
          {issue && <button className="wb-btn" disabled={issue.status === 'in_progress'} title={issue.status === 'in_progress' ? '进行中的卡片不能归档' : '归档后默认从看板和待办隐藏，可在「显示已归档」里找回'} onClick={() => { void archive() }}>{issue.archivedAt ? '取消归档' : '归档'}</button>}
          {issue && canWriteBack(issue) && <button className="wb-btn" onClick={() => setWritingBack(true)}>回写禅道</button>}
          {issue?.status === 'done' && !issue.timesheet && <button className="wb-btn" onClick={() => setReporting(true)}>填报 Sparkin 工时</button>}
          <span className="wb-grow" />
          <button className="wb-btn" onClick={onClose}>取消</button>
          <button className="wb-btn" disabled={busy} onClick={() => { void save(false) }}>{issue ? '保存' : '创建'}</button>
          {canStart && <button className="wb-btn primary" disabled={busy} onClick={() => { void save(true) }}>{issue ? '保存并开工' : '创建并开工'}</button>}</div>
      </div>
    </div>
  )
}

const agentName = (s: PageProps['state'], id: string) => s.agents.find((a) => a.id === id)?.name ?? id

/** Task chain: who comes before / after this card. Changes apply immediately. */
function ChainField({ issue, p }: { issue: Issue; p: PageProps }) {
  const { state } = p
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const before = state.issues.filter((i) => i.nextId === issue.id)
  const next = state.issues.find((i) => i.id === issue.nextId)
  const options = state.issues.filter((i) => i.id !== issue.id && !i.archivedAt)
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await p.refresh() } catch (e) { p.notify((e as Error).message) } }
  const startNext = async () => { if (next) await act(async () => { await rpc('issue.start', { id: next.id }); p.notify(`已开工下一个任务：${next.key}`) }) }

  return (
    <div className="wb-field"><label>任务链（做完这个，下一个做什么）</label>
      {before.length > 0 && <div className="wb-sub" style={{ marginBottom: 4 }}>前置任务：{before.map((b) => `${b.key} ${b.title}`).join('；')}（它的结论会带进本任务的首条消息）</div>}
      <div className="wb-row">
        <select className="wb-select" value={issue.nextId ?? ''} onChange={(e) => { void act(() => rpc('issue.next', { id: issue.id, nextId: e.target.value })) }}>
          <option value="">没有后续任务</option>
          {options.map((i) => <option key={i.id} value={i.id}>{i.key} {i.title}</option>)}
        </select>
        <button className="wb-btn" style={{ whiteSpace: 'nowrap' }} onClick={() => setAdding(!adding)}>＋ 新建后续任务</button>
        {next && ['backlog', 'todo', 'blocked'].includes(next.status) && ['in_review', 'done'].includes(issue.status) &&
          <button className="wb-btn primary" style={{ whiteSpace: 'nowrap' }} onClick={() => { void startNext() }}>开工下一个</button>}
      </div>
      {adding && <div className="wb-row" style={{ marginTop: 6 }}>
        <input className="wb-input" autoFocus placeholder="后续任务标题（继承本任务的项目和智能体）" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) { void act(async () => { await rpc('issue.followup', { id: issue.id, title }); setTitle(''); setAdding(false) }) } }} />
        <button className="wb-btn" disabled={!title.trim()} onClick={() => { void act(async () => { await rpc('issue.followup', { id: issue.id, title }); setTitle(''); setAdding(false) }) }}>创建</button></div>}
    </div>
  )
}

/** 代码与验证: the task branch, what changed, the project's tests, and the merge request. */
function CodeField({ issue, p, onChanges }: { issue: Issue; p: PageProps; onChanges: () => void }) {
  const project = p.state.projects.find((x) => x.id === issue.projectId)
  const last = issue.checks?.at(-1)
  const [busy, setBusy] = useState<'test' | 'mr'>()
  const [open, setOpen] = useState(false)
  if (!project || (issue.status === 'backlog' && !issue.branch)) return null
  const act = async (kind: 'test' | 'mr') => {
    if (kind === 'mr' && !(await ask(`将提交 ${issue.key} 的改动并把分支「${issue.branch}」推送到 origin，然后在 GitLab 创建合并请求（目标分支 ${issue.baseBranch}）。继续？`))) return
    setBusy(kind)
    try {
      if (kind === 'test') { await rpc('issue.test', { id: issue.id }); p.notify('已开始运行测试') } else { const r = await rpc<Issue>('issue.mr', { id: issue.id }); p.notify(`已创建合并请求 !${r.mr?.iid}`) }
      await p.refresh()
    } catch (e) { p.notify((e as Error).message); await p.refresh() } finally { setBusy(undefined) }
  }
  return (
    <div className="wb-field"><label>代码与验证</label>
      <div className="wb-rel">
        {issue.branch ? <>分支 <b>{issue.branch}</b><span className="wb-muted"> ← 基线 {issue.baseBranch}{issue.worktree ? ` · 工作树 ${issue.worktree}` : ''}</span></> : <span className="wb-muted">直接在项目目录运行（没有独立分支）</span>}
        {issue.mr && <div>合并请求：<a href={issue.mr.url} target="_blank" rel="noreferrer noopener">!{issue.mr.iid} ↗</a></div>}
        {last && <div>测试：<b style={{ color: checkColor(last.state) }}>{checkLabel(last.state)}</b><span className="wb-muted"> · {last.cmd}{last.ms ? ` · ${(last.ms / 1000).toFixed(1)}s` : ''}</span>
          {last.state !== 'running' && <> <button className="wb-linkbtn" onClick={() => setOpen(!open)}>{open ? '收起输出' : '查看输出'}</button></>}
          {open && <pre className="wb-pre" style={{ maxHeight: 180, border: '1px solid var(--wb-bd1)', borderRadius: 6, marginTop: 4 }}>{last.output || '（无输出）'}</pre>}</div>}
      </div>
      <div className="wb-row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        <button className="wb-btn" onClick={onChanges}>查看改动</button>
        <button className="wb-btn" disabled={!!busy || !project.testCmd || last?.state === 'running'} title={project.testCmd ? `运行：${project.testCmd}` : '项目还没有配置测试命令（项目 → 编辑）'} onClick={() => { void act('test') }}>{busy === 'test' || last?.state === 'running' ? '测试运行中…' : '运行测试'}</button>
        {issue.branch && !issue.mr && <button className="wb-btn" disabled={!!busy || issue.status === 'in_progress'} title="提交改动、推送分支，并在 GitLab 创建合并请求" onClick={() => { void act('mr') }}>{busy === 'mr' ? '提交中…' : '提交 MR'}</button>}
      </div>
    </div>
  )
}
