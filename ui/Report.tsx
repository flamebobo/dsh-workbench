import * as React from 'react'
import { rpc, type Issue } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React

/** 日报 / 周报: a draft built from your cards. Edit it, copy it, or hand it to 周报助手 to polish. Nothing is sent anywhere. */
export function ReportModal({ p, onClose, onTask }: { p: PageProps; onClose: () => void; onTask: (issue: Issue) => void }) {
  const [kind, setKind] = useState<'day' | 'week'>('day')
  const [title, setTitle] = useState('')
  const [text, setText] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setText(undefined); setError(undefined)
    void rpc<{ title: string; text: string }>('report.draft', { kind }).then((r) => { setTitle(r.title); setText(r.text) }).catch((e) => setError((e as Error).message))
  }, [kind])

  async function copy() {
    if (text === undefined) return
    try { await navigator.clipboard.writeText(text) } catch {
      const el = document.querySelector<HTMLTextAreaElement>('.wb-report-text')
      el?.select(); document.execCommand('copy') // clipboard API can be blocked in embedded pages
    }
    p.notify('已复制')
  }
  async function toAgent() {
    setBusy(true)
    try { const i = await rpc<Issue>('report.task', { kind, text }); await p.refresh(); p.notify(`已生成 ${i.key}「${i.title}」，在待规划里，确认后点开工`); onTask(i); onClose() } catch (e) { p.notify((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal" style={{ width: 'min(720px, 100%)' }} role="dialog" aria-label="日报周报">
        <div className="wb-row"><h3 style={{ margin: 0 }}>{title || '日报 / 周报'}</h3><span className="wb-grow" />
          <div className="wb-seg" role="group" aria-label="报告类型">
            <button aria-pressed={kind === 'day'} onClick={() => setKind('day')}>日报</button>
            <button aria-pressed={kind === 'week'} onClick={() => setKind('week')}>周报</button></div>
          <button className="wb-btn" aria-label="关闭" onClick={onClose}>✕</button></div>
        <div className="wb-sub" style={{ margin: '6px 0 8px' }}>根据卡片、合并请求、任务分支上的提交和已填报的工时生成的草稿，可以直接修改；不会自动发送到任何地方。</div>
        {error ? <div className="wb-banner err">{error}</div>
          : <textarea className="wb-textarea wb-report-text" style={{ minHeight: 320, fontFamily: 'inherit' }} value={text ?? '正在生成…'} disabled={text === undefined} onChange={(e) => setText(e.target.value)} />}
        <div className="wb-row" style={{ marginTop: 10 }}>
          <button className="wb-btn" title="生成一个任务，交给周报助手整理成正式的报告；在待规划里，不会自动运行" disabled={busy || text === undefined} onClick={() => { void toAgent() }}>交给周报助手润色</button>
          <span className="wb-grow" />
          <button className="wb-btn primary" disabled={text === undefined} onClick={() => { void copy() }}>复制</button></div>
      </div>
    </div>
  )
}
