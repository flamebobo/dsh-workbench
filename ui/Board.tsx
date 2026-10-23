import * as React from 'react'
import { ago, COMMANDS, fmtSize, isImage, rpc, STATUS_LABEL, uploadFile, type Attachment, type Issue, type Status } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect, useRef } = React
const COLUMNS: Status[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked']

export function Board(p: PageProps) {
  const { state } = p
  const [dragging, setDragging] = useState<string>()
  const [over, setOver] = useState<Status>()
  const [openId, setOpenId] = useState<string | undefined>(p.focusIssue)
  const [creating, setCreating] = useState<Status>()
  useEffect(() => { if (p.focusIssue) setOpenId(p.focusIssue) }, [p.focusIssue])

  const running = new Set(state.runs.filter((r) => r.status === 'running').map((r) => r.issueId))
  const agentName = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id

  async function move(id: string, status: Status) {
    const cur = state.issues.find((i) => i.id === id)
    if (!cur || cur.status === status) return
    try { await rpc('issue.status', { id, status }); await p.refresh() } catch (e) { p.notify((e as Error).message) }
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
                <button className="wb-btn" style={{ padding: '0 8px' }} aria-label={`在${STATUS_LABEL[col]}新建`} onClick={() => setCreating(col)}>+</button></div>
              <div className="wb-col-b">
                {items.map((i) => (
                  <article key={i.id} className={`wb-card ${dragging === i.id ? 'drag' : ''}`} draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', i.id); setDragging(i.id) }} onDragEnd={() => { setDragging(undefined); setOver(undefined) }}
                    onClick={() => setOpenId(i.id)}>
                    <div className="k">
                      {running.has(i.id) && <span className="wb-spin" title="会话运行中" />}
                      <span>{i.key}</span>{i.sourceRef && <span>· {i.sourceRef.ref}</span>}
                    </div>
                    <div className="t">{i.title}</div>
                    {i.note && <div className="wb-ellipsis" style={{ color: i.status === 'blocked' ? 'var(--wb-red)' : 'var(--wb-amber)', fontSize: 11, marginBottom: 4 }} title={i.note}>{i.note}</div>}
                    <div className="m"><span className="wb-pill">{agentName(i.agentId)}</span><span style={{ marginLeft: 'auto' }}>{ago(i.updatedAt)}</span></div>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {open && <IssueModal issue={open} p={p} onClose={() => setOpenId(undefined)} />}
      {creating && <IssueModal initialStatus={creating} p={p} onClose={() => setCreating(undefined)} />}
    </div>
  )
}

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
const STARTABLE: Status[] = ['backlog', 'todo', 'blocked']

/** Create (no `issue`) or edit one card. 开工 saves the form, then starts a DSH session in the chosen project's directory. */
function IssueModal({ issue, initialStatus, p, onClose }: { issue?: Issue; initialStatus?: Status; p: PageProps; onClose: () => void }) {
  const { state } = p
  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
  const [acceptance, setAcceptance] = useState((issue?.acceptance ?? []).join('\n'))
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>(issue?.priority ?? 'P2')
  const [projectId, setProjectId] = useState(issue?.projectId ?? '')
  const [agentId, setAgentId] = useState(issue?.agentId ?? 'fullstack')
  const [status, setStatus] = useState<Status>(issue?.status ?? initialStatus ?? 'backlog')
  const [command, setCommand] = useState(issue?.command ?? '')
  const [links, setLinks] = useState<string[]>(issue?.links ?? [])
  const [linkInput, setLinkInput] = useState('')
  const [files, setFiles] = useState<Attachment[]>(issue?.attachments ?? [])
  const [uploading, setUploading] = useState(0)
  const [over, setOver] = useState(false)
  const previews = useRef(new Map<string, string>()) // object URLs for images added in this dialog
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => () => { previews.current.forEach((u) => URL.revokeObjectURL(u)) }, [])
  useEffect(() => { if (issue) setStatus(issue.status) }, [issue?.status]) // a session ending changes it under us
  const runs = issue ? state.runs.filter((r) => r.issueId === issue.id).reverse() : []
  const canStart = !issue || STARTABLE.includes(issue.status)
  const lines = acceptance.split('\n')

  async function addFiles(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      setUploading((n) => n + 1)
      try {
        const a = await uploadFile(f)
        if (f.type.startsWith('image/')) previews.current.set(a.id, URL.createObjectURL(f))
        setFiles((cur) => [...cur, a])
      } catch (e) { p.notify(`${f.name}：${(e as Error).message}`) } finally { setUploading((n) => n - 1) }
    }
  }
  function addLink() {
    const v = linkInput.trim()
    if (!v) return
    if (!/^https?:\/\//i.test(v)) { p.notify('链接必须以 http:// 或 https:// 开头'); return }
    if (!links.includes(v)) setLinks([...links, v])
    setLinkInput('')
  }

  const fields = () => ({ title, description, acceptance: lines, priority, projectId, agentId, command, links: linkInput.trim() && /^https?:\/\//i.test(linkInput.trim()) ? [...links, linkInput.trim()] : links, attachments: files })
  async function save(start: boolean) {
    if (!title.trim()) { p.notify('标题不能为空'); return }
    if (start && !projectId) { p.notify('开工前请先选择项目（会话的工作目录）'); return }
    setBusy(true)
    try {
      let id = issue?.id
      if (issue) {
        await rpc('issue.update', { id: issue.id, patch: fields() })
        if (!start && status !== issue.status) await rpc('issue.status', { id: issue.id, status })
      } else {
        id = (await rpc<Issue>('issue.create', { ...fields(), status })).id
      }
      if (start) {
        const r = await rpc<{ issue: Issue }>('issue.start', { id, agentId })
        p.notify(`已开工：${r.issue.key}，会话已创建`)
      }
      await p.refresh(); onClose()
    } catch (e) { p.notify((e as Error).message); await p.refresh() } finally { setBusy(false) }
  }
  async function remove() {
    if (!issue || !confirm(`删除卡片 ${issue.key}？`)) return
    await rpc('issue.delete', { id: issue.id }); await p.refresh(); onClose()
  }

  return (
    <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`wb-modal ${over ? 'drop' : ''}`} role="dialog" aria-label={issue?.key ?? '新建任务'}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false) }}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files) } }}>
        <div className="wb-row"><span className="wb-sub">{issue ? `${issue.key}${issue.sourceRef ? ` · ${issue.sourceRef.source} ${issue.sourceRef.ref}` : ' · 手工任务'}` : '新建任务'}</span><span className="wb-grow" />
          {issue?.sessionId && <button className="wb-btn" onClick={() => p.openSession(issue.sessionId!)}>打开关联会话 ↗</button>}
          <button className="wb-btn" aria-label="关闭" onClick={onClose}>✕</button></div>
        <div className="wb-field"><label>标题</label><input className="wb-input" autoFocus={!issue} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：补充对账脚本的幂等校验" /></div>
        <div className="wb-field"><label>描述 / 背景</label><textarea className="wb-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="任务背景、现状；可直接粘贴截图"
            onPaste={(e) => { const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); void addFiles(imgs) } }} /></div>
        <div className="wb-field"><label>验收标准（每行一条，开工时会写进首条消息）</label>
          <textarea className="wb-textarea" style={{ minHeight: 70 }} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder={'重复请求不重复入账\n补充单测并通过'} /></div>
        <div className="wb-field"><label>指令（相当于在 DSH 输入框里以 / 开头发送）</label>
          <select className="wb-select" value={command} onChange={(e) => setCommand(e.target.value)}>{COMMANDS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <div className="wb-sub" style={{ marginTop: 3 }}>{COMMANDS.find((c) => c.id === command)?.hint}</div></div>
        <div className="wb-field"><label>链接</label>
          {links.length > 0 && <div className="wb-chips">{links.map((l) => (
            <span className="wb-chipx" key={l}><a href={l} target="_blank" rel="noreferrer noopener" title={l}>{l.replace(/^https?:\/\//, '')}</a>
              <button aria-label="移除链接" onClick={() => setLinks(links.filter((x) => x !== l))}>✕</button></span>))}</div>}
          <div className="wb-row"><input className="wb-input" value={linkInput} placeholder="粘贴链接后回车，如需求文档、设计稿、接口文档" onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} /><button className="wb-btn" onClick={addLink}>添加</button></div></div>
        <div className="wb-field"><label>图片 / 文档（可拖入弹窗，或在描述里粘贴截图）</label>
          <input ref={picker} type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
          <div className="wb-row"><button className="wb-btn" onClick={() => picker.current?.click()}>＋ 添加图片 / 文档</button>
            {uploading > 0 && <span className="wb-muted">正在上传 {uploading} 个…</span>}</div>
          {files.length > 0 && <div className="wb-files">{files.map((a) => (
            <div className="wb-file" key={a.id}>
              {previews.current.get(a.id) ? <img src={previews.current.get(a.id)} alt="" /> : <span className="ic">{isImage(a) ? '🖼' : '📄'}</span>}
              <span className="wb-ellipsis wb-grow" title={a.name}>{a.name}</span><span className="wb-muted">{fmtSize(a.size)}</span>
              <button aria-label="移除附件" onClick={() => setFiles(files.filter((x) => x.id !== a.id))}>✕</button></div>))}</div>}</div>
        <div className="wb-row">
          <div className="wb-field wb-grow"><label>项目（工作目录）</label>
            <select className="wb-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">未选择</option>{state.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="wb-field" style={{ width: 90 }}><label>优先级</label>
            <select className="wb-select" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select></div>
        </div>
        <div className="wb-row">
          <div className="wb-field wb-grow"><label>指派智能体</label>
            <select className="wb-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>{state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div className="wb-field wb-grow"><label>状态（已完成只能由你设置）</label>
            <select className="wb-select" value={status} onChange={(e) => setStatus(e.target.value as Status)}>{COLUMNS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
        </div>
        {issue?.note && <div className={`wb-banner ${issue.status === 'blocked' ? 'err' : ''}`} style={{ margin: '4px 0' }}>{issue.note}</div>}
        {issue && <div className="wb-field"><label>执行记录</label>
          {runs.length ? runs.map((r) => (
            <div className="wb-rel" key={r.id}>
              <b>{r.status === 'running' ? '运行中' : r.status === 'completed' ? '已结束' : r.status === 'failed' ? '出错' : '已中断'}</b>
              <span className="wb-muted"> · {agentName(state, r.agentId)} · {ago(r.startedAt)}</span>
              {r.error && <div style={{ color: 'var(--wb-red)' }}>{r.error}</div>}
              {r.finalText && <div className="wb-muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', marginTop: 4 }}>{r.finalText}</div>}
            </div>
          )) : <div className="wb-muted">暂无执行记录</div>}</div>}
        <div className="wb-row">{issue && <button className="wb-btn danger" onClick={() => { void remove() }}>删除</button>}<span className="wb-grow" />
          <button className="wb-btn" onClick={onClose}>取消</button>
          <button className="wb-btn" disabled={busy} onClick={() => { void save(false) }}>{issue ? '保存' : '创建'}</button>
          {canStart && <button className="wb-btn primary" disabled={busy} onClick={() => { void save(true) }}>{issue ? '保存并开工' : '创建并开工'}</button>}</div>
      </div>
    </div>
  )
}

const agentName = (s: PageProps['state'], id: string) => s.agents.find((a) => a.id === id)?.name ?? id
