import * as React from 'react'
import { ago, BUILD_LABEL, buildColor, rpc, STATUS_LABEL, type Issue, type Project, type Status } from './api.ts'
import { SkillPicker } from './SkillPicker.tsx'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React
type Draft = Omit<Project, 'id'> & { id?: string }
const EMPTY: Draft = { name: '', cwd: '' }
const num = (v: string) => (v.trim() ? Number(v) : undefined)
const ORDER: Status[] = ['in_progress', 'in_review', 'blocked', 'todo', 'backlog', 'done']

/** Live (not archived) cards of one project, counted the way the cards show them. */
function statsOf(issues: Issue[]) {
  const n = (s: Status) => issues.filter((i) => i.status === s).length
  return { active: n('in_progress'), review: n('in_review'), blocked: n('blocked'), todo: n('todo') + n('backlog'), done: n('done'), total: issues.length }
}
const attention = (s: ReturnType<typeof statsOf>) => (s.blocked ? { text: '需处理', color: 'var(--wb-red)' } : s.review ? { text: '需关注', color: 'var(--wb-amber)' } : undefined)

export function Projects(p: PageProps) {
  const [openId, setOpenId] = useState<string>()
  const [draft, setDraft] = useState<Draft | undefined>()
  const [sparkin, setSparkin] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { void rpc<{ projects: { id: string; name: string }[] }>('sparkin.info').then((i) => setSparkin(i.projects)).catch(() => {}) }, [])
  const open = p.state.projects.find((x) => x.id === openId)

  async function save() {
    if (!draft) return
    try { await rpc('project.save', draft); setDraft(undefined); await p.refresh() } catch (e) { p.notify((e as Error).message) }
  }
  async function remove(x: Project) {
    if (!confirm(`删除项目「${x.name}」？卡片不会被删除，但没有项目的卡片不能开工。`)) return
    await rpc('project.delete', { id: x.id }); setOpenId(undefined); await p.refresh()
  }
  const f = (k: keyof Draft, label: string, ph = '') => (
    <div className="wb-field wb-grow"><label>{label}</label>
      <input className="wb-input" placeholder={ph} value={String(draft?.[k] ?? '')}
        onChange={(e) => setDraft({ ...draft!, [k]: k === 'gitlabProjectId' || k === 'zentaoProductId' ? num(e.target.value) : e.target.value })} /></div>
  )

  return (
    <div className="wb-main" style={{ position: 'relative' }}>
      {open
        ? <ProjectDetail p={p} project={open} sparkin={sparkin} onBack={() => setOpenId(undefined)} onEdit={() => setDraft({ ...open })} onDelete={() => { void remove(open) }} />
        : <ProjectGrid p={p} sparkin={sparkin} onOpen={setOpenId} onAdd={() => setDraft({ ...EMPTY })} />}
      {draft && (
        <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setDraft(undefined) }}>
          <div className="wb-modal" role="dialog" aria-label="项目">
            <h3 style={{ marginTop: 0 }}>{draft.id ? '编辑项目' : '添加项目'}</h3>
            {f('name', '名称', '云支付 / payment-core')}
            {f('cwd', '工作目录（绝对路径）', '/Users/me/code/payment-core 或 D:\\code\\payment-core')}
            <div className="wb-row">{f('gitlabProjectId', 'GitLab 项目 ID', '101')}{f('zentaoProductId', '禅道产品 ID', '12')}{f('jenkinsJob', 'Jenkins Job 名', 'payment-core')}</div>
            <div className="wb-field"><label>测试命令（开工后用来验证改动，在任务的工作树里运行）</label>
              <input className="wb-input" placeholder="npm test / mvn -q test / pytest" value={draft.testCmd ?? ''} onChange={(e) => setDraft({ ...draft, testCmd: e.target.value || undefined })} /></div>
            <div className="wb-row">
              <div className="wb-field wb-grow"><label>基线分支（任务从它切出，MR 指向它；留空 = origin 的默认分支）</label>
                <input className="wb-input" placeholder="main" value={draft.baseBranch ?? ''} onChange={(e) => setDraft({ ...draft, baseBranch: e.target.value || undefined })} /></div>
              <div className="wb-field" style={{ width: 200 }}><label>分支隔离</label>
                <select className="wb-select" value={draft.isolate === undefined ? '' : draft.isolate ? 'on' : 'off'} onChange={(e) => setDraft({ ...draft, isolate: e.target.value === '' ? undefined : e.target.value === 'on' })}>
                  <option value="">跟随插件设置</option><option value="on">开：每个任务独立分支</option><option value="off">关：直接在项目目录</option></select></div>
            </div>
            <SkillPicker label="项目规范技能（多选；这个项目的任务开工时自动加载，例如公司代码规范，和智能体自己的技能合并）" value={draft.skills ?? []} onChange={(skills) => setDraft({ ...draft, skills })} />
            <div className="wb-field"><label>Sparkin 项目（填报工时时对应到它的任务）</label>
              <select className="wb-select" value={draft.sparkinProjectId ?? ''} onChange={(e) => setDraft({ ...draft, sparkinProjectId: e.target.value || undefined })}>
                <option value="">未关联</option>{sparkin.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="wb-row"><span className="wb-grow" /><button className="wb-btn" onClick={() => setDraft(undefined)}>取消</button><button className="wb-btn primary" onClick={() => { void save() }}>保存</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function Chips({ x, sparkin }: { x: Project; sparkin: { id: string; name: string }[] }) {
  const items = [
    x.gitlabProjectId != null && `GitLab #${x.gitlabProjectId}`, x.zentaoProductId != null && `禅道产品 ${x.zentaoProductId}`,
    x.jenkinsJob && `Jenkins ${x.jenkinsJob}`, x.testCmd && `测试 ${x.testCmd}`, x.skills?.length && `技能 ${x.skills.map((k) => `/${k}`).join(' ')}`, x.sparkinProjectId && `Sparkin ${sparkin.find((s) => s.id === x.sparkinProjectId)?.name ?? x.sparkinProjectId}`,
  ].filter(Boolean) as string[]
  return items.length ? <div className="wb-chips">{items.map((t) => <span className="wb-pill" key={t}>{t}</span>)}</div> : <span className="wb-muted">还没有关联 GitLab / 禅道 / Jenkins / Sparkin</span>
}

function ProjectGrid({ p, sparkin, onOpen, onAdd }: { p: PageProps; sparkin: { id: string; name: string }[]; onOpen: (id: string) => void; onAdd: () => void }) {
  return (
    <>
      <div className="wb-toolbar"><span className="wb-sub">每个项目对应一个工作目录（开工时作为 DSH 会话的 cwd），并关联 GitLab / 禅道 / Jenkins / Sparkin。点卡片查看概览。</span><span className="wb-grow" />
        <button className="wb-btn primary" onClick={onAdd}>+ 添加项目</button></div>
      <div className="wb-pgrid">
        {p.state.projects.map((x) => {
          const mine = p.state.issues.filter((i) => i.projectId === x.id && !i.archivedAt)
          const s = statsOf(mine)
          const flag = attention(s)
          const last = mine.map((i) => i.updatedAt).sort().at(-1)
          return (
            <button key={x.id} className="wb-pcard" onClick={() => onOpen(x.id)}>
              <div className="wb-row"><b className="wb-ellipsis" style={{ fontSize: 15 }}>{x.name}</b>
                {flag && <span className="wb-flag" style={{ color: flag.color }}>● {flag.text}</span>}</div>
              <div className="wb-muted wb-ellipsis" title={x.cwd} style={{ margin: '4px 0 10px', fontSize: 12 }}>📁 {x.cwd}</div>
              <div className="wb-nums">
                <div><b style={{ color: 'var(--wb-blue)' }}>{s.active}</b><span>进行中</span></div>
                <div><b style={{ color: 'var(--wb-amber)' }}>{s.review}</b><span>待审核</span></div>
                <div><b style={{ color: s.blocked ? 'var(--wb-red)' : undefined }}>{s.blocked}</b><span>阻塞</span></div>
                <div><b>{s.todo}</b><span>待办</span></div>
              </div>
              <Chips x={x} sparkin={sparkin} />
              <div className="wb-muted" style={{ marginTop: 8, fontSize: 11 }}>{last ? `更新于 ${ago(last)}` : '还没有任务'}</div>
            </button>
          )
        })}
        <button className="wb-pcard add" onClick={onAdd}>＋ 添加项目</button>
      </div>
      {!p.state.projects.length && <div className="wb-empty">还没有项目。添加后，待办才能「开工」。</div>}
    </>
  )
}

function ProjectDetail({ p, project: x, sparkin, onBack, onEdit, onDelete }: { p: PageProps; project: Project; sparkin: { id: string; name: string }[]; onBack: () => void; onEdit: () => void; onDelete: () => void }) {
  const [tab, setTab] = useState<'overview' | 'work'>('overview')
  const mine = p.state.issues.filter((i) => i.projectId === x.id && !i.archivedAt)
  const s = statsOf(mine)
  const flag = attention(s)
  const ids = new Set(mine.map((i) => i.id))
  const builds = (p.state.builds ?? []).filter((b) => b.issueIds.some((id) => ids.has(id))).slice().reverse().slice(0, 4)
  const hours = mine.reduce((n, i) => n + (i.timesheet?.hours ?? 0), 0)
  const agent = (id: string) => p.state.agents.find((a) => a.id === id)?.name ?? id
  const byRecent = (a: Issue, b: Issue) => b.updatedAt.localeCompare(a.updatedAt)

  const current = mine.filter((i) => ['in_progress', 'todo', 'backlog'].includes(i.status)).sort(byRecent)
  const waiting = [
    ...mine.filter((i) => i.status === 'in_review').map((i) => ({ i, tag: '需复核', color: 'var(--wb-amber)' })),
    ...mine.filter((i) => i.status === 'blocked').map((i) => ({ i, tag: '需处理', color: 'var(--wb-red)' })),
    ...mine.filter((i) => i.status === 'done' && !i.timesheet).map((i) => ({ i, tag: '待填工时', color: 'var(--wb-green)' })),
  ]
  const Row = ({ i, tag, color }: { i: Issue; tag?: string; color?: string }) => (
    <button className="wb-prow" onClick={() => p.go('board', i.id)}>
      <span className={`wb-dot ${i.status}`} />
      <span className="wb-muted" style={{ width: 52, flex: 'none' }}>{i.key}</span>
      <span className="wb-grow wb-ellipsis" style={{ textAlign: 'left' }}>{i.title}<span className="wb-muted"> · {agent(i.agentId)} · 更新于 {ago(i.updatedAt)}</span></span>
      <span className="wb-pill" style={color ? { color } : undefined}>{tag ?? STATUS_LABEL[i.status]}</span>
    </button>
  )

  return (
    <div className="wb-pdetail">
      <div className="wb-crumb"><button onClick={onBack}>‹ 项目管理</button><span className="wb-muted">›</span><b>{x.name}</b></div>
      <div className="wb-row" style={{ margin: '8px 0 2px' }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>{x.name}</h2>
        {flag && <span className="wb-flag" style={{ color: flag.color }}>● {flag.text}</span>}
        <span className="wb-grow" />
        <button className="wb-btn" onClick={onEdit}>编辑</button>
        <button className="wb-btn danger" onClick={onDelete}>删除项目</button>
      </div>
      <div className="wb-tabs" style={{ padding: '8px 0 0', borderBottom: 0 }} role="tablist">
        {([['overview', '概览'], ['work', `工作 ${mine.length}`]] as const).map(([k, l]) => (
          <button key={k} className="wb-tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>))}
      </div>

      {tab === 'overview' ? (
        <>
          <div className="wb-ptop">
            <section className="wb-panel"><h4>项目事实</h4>
              <div className="wb-muted wb-ellipsis" title={x.cwd} style={{ margin: '4px 0 10px' }}>📁 {x.cwd}</div>
              <Chips x={x} sparkin={sparkin} /></section>
            <section className="wb-panel"><h4>当前状态</h4>
              <div className="wb-bigs">
                <div><b style={{ color: 'var(--wb-blue)' }}>{s.active}</b><span>进行中</span></div>
                <div><b style={{ color: 'var(--wb-amber)' }}>{s.review}</b><span>待审核</span></div>
                <div><b style={{ color: s.blocked ? 'var(--wb-red)' : undefined }}>{s.blocked}</b><span>阻塞</span></div>
              </div>
              <div className="wb-muted" style={{ fontSize: 12, marginTop: 8 }}>待办 {s.todo} · 已完成 {s.done} · 已填报工时 {hours}h</div></section>
            <section className="wb-panel"><h4>近期构建</h4>
              {builds.length ? builds.map((b) => (
                <div className="wb-rel" key={b.id}><b style={{ color: buildColor(b.state) }}>{BUILD_LABEL[b.state]}</b> · {b.job}{b.number ? ` #${b.number}` : ''}
                  <span className="wb-muted"> · {ago(b.createdAt)}{b.demo ? ' · 演示' : ''}</span></div>)) : <div className="wb-muted">还没有触发过构建验证。</div>}</section>
          </div>
          <div className="wb-pcols">
            <section className="wb-panel"><h4>当前工作 <span className="wb-muted">{current.length}</span></h4>
              {current.length ? current.slice(0, 8).map((i) => <Row key={i.id} i={i} />) : <div className="wb-muted">没有进行中或待办的任务。</div>}</section>
            <section className="wb-panel"><h4>等你处理 <span className="wb-muted">{waiting.length}</span></h4>
              {waiting.length ? waiting.slice(0, 8).map(({ i, tag, color }) => <Row key={i.id + tag} i={i} tag={tag} color={color} />) : <div className="wb-muted">没有需要你处理的事项。</div>}</section>
          </div>
        </>
      ) : (
        <section className="wb-panel" style={{ marginTop: 14 }}>
          {mine.length ? [...mine].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || byRecent(a, b)).map((i) => <Row key={i.id} i={i} />) : <div className="wb-muted">这个项目还没有任务。</div>}
        </section>
      )}
    </div>
  )
}
