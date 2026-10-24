import * as React from 'react'
import { rpc } from './api.ts'

const { useState, useEffect } = React
interface Listing { path: string; parent?: string; home: string; entries: { name: string; path: string; isGit: boolean }[]; places: { label: string; path: string }[] }

/** Folder picker over the Host's file system (a page in a sandbox has no native dialog): walk down, pick the current folder. */
export function DirPicker(p: { start?: string; onPick: (path: string) => void; onClose: () => void }) {
  const [at, setAt] = useState(p.start?.trim() || undefined)
  const [hidden, setHidden] = useState(false)
  const [list, setList] = useState<Listing>()
  const [err, setErr] = useState<string>()
  useEffect(() => {
    let live = true
    rpc<Listing>('dirs.list', { path: at, hidden }).then((r) => { if (live) { setList(r); setErr(undefined) } }, (e) => { if (live) setErr((e as Error).message) })
    return () => { live = false }
  }, [at, hidden])
  const sep = list?.path.includes('\\') ? '\\' : '/'
  const crumbs = list ? list.path.split(/[\\/]/).reduce<{ label: string; path: string }[]>((acc, part, i) => {
    if (!part && i > 0) return acc
    const path = i === 0 ? (part || '/') : acc[acc.length - 1]!.path.replace(/[\\/]$/, '') + sep + part
    return [...acc, { label: part || '/', path }]
  }, []) : []

  return (
    <div className="wb-modal-mask" style={{ zIndex: 60 }} onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose() }}>
      <div className="wb-modal" role="dialog" aria-label="选择工作目录" style={{ width: 560 }}>
        <h3 style={{ marginTop: 0 }}>选择工作目录</h3>
        {list && list.places.length > 0 && (
          <div className="wb-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {list.places.map((x) => <button key={x.path} className="wb-btn" title={x.path} onClick={() => setAt(x.path)}>{x.label}</button>)}
          </div>
        )}
        <div className="wb-sub" style={{ wordBreak: 'break-all', marginBottom: 6 }}>
          {crumbs.map((c, i) => <span key={c.path}>{i > 0 && ' › '}<a href="#" onClick={(e) => { e.preventDefault(); setAt(c.path) }}>{c.label}</a></span>)}
        </div>
        <div className="wb-dirs" style={{ height: 300, overflow: 'auto', border: '1px solid var(--wb-bd)', borderRadius: 7 }}>
          {err && <div style={{ padding: 10, color: 'var(--wb-red)' }}>{err}</div>}
          {list?.parent && <div className="wb-dir" role="button" tabIndex={0} onClick={() => setAt(list.parent)} style={rowStyle}>↰ 上一级</div>}
          {list?.entries.map((e) => (
            <div key={e.path} className="wb-dir" role="button" tabIndex={0} onClick={() => setAt(e.path)} onDoubleClick={() => p.onPick(e.path)} style={rowStyle}>
              <span>📁 {e.name}</span>{e.isGit && <span className="wb-pill live">git</span>}
            </div>
          ))}
          {list && !list.entries.length && !err && <div className="wb-sub" style={{ padding: 10 }}>没有子目录</div>}
        </div>
        <label className="wb-sub" style={{ display: 'block', margin: '6px 0' }}><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> 显示隐藏目录</label>
        <div className="wb-row"><span className="wb-sub wb-grow" style={{ wordBreak: 'break-all' }}>将选择：{list?.path ?? '…'}</span>
          <button className="wb-btn" onClick={p.onClose}>取消</button>
          <button className="wb-btn primary" disabled={!list} onClick={() => list && p.onPick(list.path)}>选择此目录</button></div>
      </div>
    </div>
  )
}

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid var(--wb-bd1)' }
