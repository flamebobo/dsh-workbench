import * as React from 'react'
import { ago, BUILD_LABEL, buildColor, rpc, type Build, type Issue } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React

/** Verify a batch of cards: pick the Jenkins job for the target environment, optionally parameters, and build once. */
export function BuildModal({ p, onClose }: { p: PageProps; onClose: () => void }) {
  const { state } = p
  const candidates = state.issues.filter((i) => i.status === 'in_review' || i.status === 'done')
  const [picked, setPicked] = useState<Set<string>>(new Set(candidates.filter((i) => i.status === 'in_review').map((i) => i.id)))
  const [job, setJob] = useState('')
  const [jobs, setJobs] = useState<{ jobs: string[]; mode: 'live' | 'demo' | 'fallback'; error?: string }>()
  const [params, setParams] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void rpc<NonNullable<typeof jobs>>('jenkins.jobs').then(setJobs).catch((e) => p.notify((e as Error).message)) }, [])

  // jobs of the picked cards' projects first, so the likely target is at the top
  const mine = new Set(state.projects.filter((x) => x.jenkinsJob && state.issues.some((i) => picked.has(i.id) && i.projectId === x.id)).map((x) => x.jenkinsJob!))
  const sorted = (jobs?.jobs ?? []).slice().sort((a, b) => Number([...mine].some((m) => b.startsWith(m))) - Number([...mine].some((m) => a.startsWith(m))) || a.localeCompare(b))

  const toggle = (i: Issue) => setPicked((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n })
  const recent = (state.builds ?? []).slice().reverse().slice(0, 5)

  async function go() {
    const kv = Object.fromEntries(params.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const k = l.indexOf('='); return k > 0 ? [l.slice(0, k).trim(), l.slice(k + 1).trim()] : [l, ''] }))
    setBusy(true)
    try {
      const b = await rpc<Build>('builds.trigger', { job, params: kv, issueIds: [...picked] })
      p.notify(b.state === 'error' ? `触发失败：${b.error}` : `已触发构建 ${b.job}${b.demo ? '（演示：Jenkins 未配置，模拟构建）' : ''}`)
      await p.refresh()
      if (b.state !== 'error') setPicked(new Set())
    } catch (e) { p.notify((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal" role="dialog" aria-label="构建验证">
        <div className="wb-row"><b style={{ fontSize: 15 }}>构建验证</b><span className="wb-grow" /><button className="wb-btn" aria-label="关闭" onClick={onClose}>✕</button></div>
        <div className="wb-sub" style={{ margin: '4px 0 8px' }}>
          勾选这批已修复的卡片，选择对应环境的 Jenkins Job 构建一次，用来验证。
          {jobs?.mode === 'demo' && <span className="wb-pill demo" style={{ marginLeft: 6 }}>演示：Jenkins 未配置，构建为模拟</span>}
          {jobs?.mode === 'fallback' && <span className="wb-pill demo" style={{ marginLeft: 6 }} title={jobs.error}>Jenkins 读取失败，显示演示 Job</span>}
        </div>
        <div className="wb-field"><label>卡片（{picked.size}/{candidates.length}）</label>
          {candidates.length ? candidates.map((i) => (
            <label className="wb-pick" key={i.id}><input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i)} />
              <span className="wb-muted" style={{ marginRight: 6 }}>{i.key}</span><span className="wb-grow wb-ellipsis">{i.title}</span>
              <span className="wb-pill">{i.status === 'done' ? '已完成' : '待审核'}</span></label>
          )) : <div className="wb-muted">还没有待审核或已完成的卡片。</div>}</div>
        <div className="wb-field"><label>Jenkins Job（对应要验证的环境，可直接输入）</label>
          <input className="wb-input" list="wb-jobs" value={job} onChange={(e) => setJob(e.target.value)} placeholder="例如 order-service-test" />
          <datalist id="wb-jobs">{sorted.map((j) => <option key={j} value={j} />)}</datalist></div>
        <div className="wb-field"><label>构建参数（可选，每行 KEY=VALUE，例如 ENV=test）</label>
          <textarea className="wb-textarea" style={{ minHeight: 56 }} value={params} onChange={(e) => setParams(e.target.value)} /></div>
        <div className="wb-row"><span className="wb-grow" /><button className="wb-btn" onClick={onClose}>关闭</button>
          <button className="wb-btn primary" disabled={busy || !job.trim() || !picked.size} onClick={() => { void go() }}>{busy ? '触发中…' : '触发构建'}</button></div>
        {recent.length > 0 && <div className="wb-field" style={{ marginTop: 14 }}><label>最近构建</label>
          {recent.map((b) => (
            <div className="wb-rel" key={b.id}>
              <b style={{ color: buildColor(b.state) }}>{BUILD_LABEL[b.state]}</b>
              <span> · {b.job}{b.number ? ` #${b.number}` : ''}{b.params ? ` · ${Object.entries(b.params).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}</span>
              <span className="wb-muted"> · {b.issueIds.map((id) => state.issues.find((i) => i.id === id)?.key).filter(Boolean).join(' ')} · {ago(b.createdAt)}{b.demo ? ' · 演示' : ''}</span>
              {b.buildUrl && <> <a href={b.buildUrl} target="_blank" rel="noreferrer noopener">打开 ↗</a></>}
              {b.error && <div style={{ color: 'var(--wb-red)' }}>{b.error}</div>}
            </div>))}</div>}
      </div>
    </div>
  )
}
