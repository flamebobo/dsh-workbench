import * as React from 'react'
import { rpc, type Project } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState } = React
type Draft = Omit<Project, 'id'> & { id?: string }
const EMPTY: Draft = { name: '', cwd: '' }
const num = (v: string) => (v.trim() ? Number(v) : undefined)

export function Projects(p: PageProps) {
  const [draft, setDraft] = useState<Draft | undefined>()

  async function save() {
    if (!draft) return
    try { await rpc('project.save', draft); setDraft(undefined); await p.refresh() } catch (e) { p.notify((e as Error).message) }
  }
  async function remove(x: Project) {
    if (!confirm(`删除项目「${x.name}」？`)) return
    await rpc('project.delete', { id: x.id }); await p.refresh()
  }
  const f = (k: keyof Draft, label: string, ph = '') => (
    <div className="wb-field wb-grow"><label>{label}</label>
      <input className="wb-input" placeholder={ph} value={String(draft?.[k] ?? '')}
        onChange={(e) => setDraft({ ...draft!, [k]: k === 'gitlabProjectId' || k === 'zentaoProductId' ? num(e.target.value) : e.target.value })} /></div>
  )

  return (
    <div className="wb-main" style={{ position: 'relative' }}>
      <div className="wb-toolbar"><span className="wb-sub">开工时使用「工作目录」作为 DSH 会话的 cwd；其余字段用于把待办对应到项目。</span><span className="wb-grow" />
        <button className="wb-btn primary" onClick={() => setDraft({ ...EMPTY })}>+ 添加项目</button></div>
      <table className="wb-table">
        <thead><tr><th>名称</th><th>工作目录</th><th style={{ width: 110 }}>GitLab 项目 ID</th><th style={{ width: 110 }}>禅道产品 ID</th><th style={{ width: 140 }}>Jenkins Job</th><th style={{ width: 150 }} /></tr></thead>
        <tbody>
          {p.state.projects.map((x) => (
            <tr key={x.id}><td>{x.name}</td><td className="wb-ellipsis" style={{ maxWidth: 320 }} title={x.cwd}>{x.cwd}</td>
              <td>{x.gitlabProjectId ?? '—'}</td><td>{x.zentaoProductId ?? '—'}</td><td>{x.jenkinsJob ?? '—'}</td>
              <td><button className="wb-btn" onClick={() => setDraft({ ...x })}>编辑</button> <button className="wb-btn danger" onClick={() => { void remove(x) }}>删除</button></td></tr>
          ))}
        </tbody>
      </table>
      {!p.state.projects.length && <div className="wb-empty">还没有项目。添加后，待办才能「开工」。</div>}
      {draft && (
        <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setDraft(undefined) }}>
          <div className="wb-modal" role="dialog" aria-label="项目">
            <h3 style={{ marginTop: 0 }}>{draft.id ? '编辑项目' : '添加项目'}</h3>
            {f('name', '名称', '云支付 / payment-core')}
            {f('cwd', '工作目录（绝对路径）', '/Users/me/code/payment-core')}
            <div className="wb-row">{f('gitlabProjectId', 'GitLab 项目 ID', '101')}{f('zentaoProductId', '禅道产品 ID', '12')}{f('jenkinsJob', 'Jenkins Job 名', 'payment-core')}</div>
            <div className="wb-row"><span className="wb-grow" /><button className="wb-btn" onClick={() => setDraft(undefined)}>取消</button><button className="wb-btn primary" onClick={() => { void save() }}>保存</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
