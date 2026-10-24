import * as React from 'react'
import { rpc, type Issue } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React

/** 回写禅道: review the comment, then resolve the bug in Zentao (status 已解决, resolution 已修复). Nothing is sent before the click. */
export function WriteBackModal({ issue, p, onClose }: { issue: Issue; p: PageProps; onClose: () => void }) {
  const [comment, setComment] = useState<string>()
  const [mode, setMode] = useState<'live' | 'demo'>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    void rpc<{ comment: string; mode: 'live' | 'demo' }>('issue.writeback.draft', { id: issue.id }).then((d) => { setComment(d.comment); setMode(d.mode) }).catch((e) => setError((e as Error).message))
  }, [])
  async function send() {
    setBusy(true); setError(undefined)
    try {
      await rpc('issue.writeback', { id: issue.id, comment })
      p.notify(mode === 'demo' ? `已回写 ${issue.sourceRef?.ref}（演示：未发送到禅道）` : `已回写禅道 ${issue.sourceRef?.ref}：评论已提交，状态改为已解决`)
      await p.refresh(); onClose()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="wb-modal-mask" style={{ zIndex: 40 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal" role="dialog" aria-label="回写禅道">
        <div className="wb-row"><h3 style={{ margin: 0 }}>回写禅道 · {issue.sourceRef?.ref}</h3><span className="wb-grow" />
          <button className="wb-btn" aria-label="关闭" onClick={onClose}>✕</button></div>
        <div className="wb-sub" style={{ margin: '6px 0 10px' }}>
          将在禅道上：给这个 Bug 添加下面的评论，并把状态改为「已解决」（解决方案：已修复）。{mode === 'demo' && '未配置禅道账号，当前是演示：只在工作台里记录，不会发送。'}
        </div>
        <div className="wb-field"><label>评论（可修改）</label>
          <textarea className="wb-textarea" style={{ minHeight: 160 }} value={comment ?? '正在生成…'} disabled={comment === undefined} onChange={(e) => setComment(e.target.value)} /></div>
        {error && <div className="wb-banner err">{error}</div>}
        <div className="wb-row"><span className="wb-grow" />
          <button className="wb-btn" onClick={onClose}>取消</button>
          <button className="wb-btn primary" disabled={busy || !comment?.trim()} onClick={() => { void send() }}>{busy ? '回写中…' : '评论并改为已解决'}</button></div>
      </div>
    </div>
  )
}
