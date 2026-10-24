import * as React from 'react'
import { rpc, type Changes, type Issue } from './api.ts'

const { useState, useEffect } = React
const ST: Record<string, string> = { A: '新增', M: '修改', D: '删除', R: '重命名' }

/** Read-only review of what a task changed: file list with +/-, click a file for its diff. */
export function ChangesModal({ issue, onClose, notify }: { issue: Issue; onClose: () => void; notify: (m: string) => void }) {
  const [data, setData] = useState<Changes>()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string>()
  useEffect(() => { void rpc<Changes>('issue.changes', { id: issue.id }).then((c) => { setData(c); if (c.files.length <= 3) setOpen(new Set(c.files.map((f) => f.path))) }).catch((e) => setErr((e as Error).message)) }, [issue.id])
  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const add = data?.files.reduce((n, f) => n + f.additions, 0) ?? 0
  const del = data?.files.reduce((n, f) => n + f.deletions, 0) ?? 0

  return (
    <div className="wb-modal-mask" style={{ zIndex: 40 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal" style={{ width: 'min(960px, 100%)' }} role="dialog" aria-label="改动">
        <div className="wb-row"><b style={{ fontSize: 15 }}>{issue.key} 的改动</b>
          {data && <span className="wb-muted">{data.isolated ? `分支 ${data.branch}（相对 ${data.base}）` : `项目目录未提交的改动（${data.branch}）`}</span>}
          <span className="wb-grow" /><button className="wb-btn" aria-label="关闭" onClick={onClose}>✕</button></div>
        {err && <div className="wb-banner err">{err}</div>}
        {!data && !err && <div className="wb-muted" style={{ padding: 12 }}>读取中…</div>}
        {data && (
          <>
            <div className="wb-sub" style={{ margin: '8px 0' }}>{data.files.length} 个文件 · <span style={{ color: 'var(--wb-green)' }}>+{add}</span> <span style={{ color: 'var(--wb-red)' }}>−{del}</span>{data.truncated ? ' · 改动较大，部分文件的 diff 已省略' : ''}</div>
            {!data.files.length && <div className="wb-empty" style={{ padding: 20 }}>相对基线还没有任何改动。</div>}
            {data.files.map((f) => (
              <div className="wb-diff" key={f.path}>
                <button className="wb-diff-h" onClick={() => toggle(f.path)}>
                  <span className={`wb-st st-${f.status}`}>{ST[f.status] ?? f.status}</span>
                  <span className="wb-grow wb-ellipsis" style={{ textAlign: 'left' }}>{f.path}</span>
                  <span style={{ color: 'var(--wb-green)' }}>+{f.additions}</span><span style={{ color: 'var(--wb-red)' }}>−{f.deletions}</span>
                  <span className="wb-muted">{open.has(f.path) ? '▾' : '▸'}</span>
                </button>
                {open.has(f.path) && <pre className="wb-pre">{f.patch.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l)).map((l, n) => (
                  <div key={n} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>{l || ' '}</div>))}</pre>}
              </div>
            ))}
          </>
        )}
        <div className="wb-row" style={{ marginTop: 12 }}><span className="wb-grow" /><button className="wb-btn" onClick={() => { onClose(); notify('改动只读展示；想让智能体继续改，请在关联会话里追问') }}>关闭</button></div>
      </div>
    </div>
  )
}
