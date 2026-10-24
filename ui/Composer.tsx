import * as React from 'react'
import { COMMANDS, fmtSize, isImage, rpc, uploadFile, type Attachment } from './api.ts'

const { useState, useRef, useEffect } = React

type Item = { key: string; label: string; sub?: string; desc?: string; section: '添加' | '指令' | '项目文件' }
const ITEMS: Item[] = [
  { key: 'file', label: '文件', desc: '添加图片或文档', section: '添加' },
  ...COMMANDS.map((c) => ({ key: c.id, label: c.label, desc: c.desc, section: '指令' as const })),
]
const SECTIONS = ['添加', '指令', '项目文件'] as const

/**
 * DSH-composer-like task description box: type `/` for the command menu (a leading `/plan` or `/goal` becomes the task's command),
 * `@` to fuzzy-search and mention files of the chosen project, `+` / drag-and-drop / paste to attach images and documents.
 * Links are just text.
 */
export function Composer(p: {
  text: string; onText: (t: string) => void
  files: Attachment[]; onFiles: (f: Attachment[]) => void
  notify: (m: string) => void
  /** Project whose working directory `@` searches; without one the menu asks the user to pick a project. */
  projectId?: string
  placeholder?: string
}) {
  const [uploading, setUploading] = useState(0)
  const [over, setOver] = useState(false)
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [caret, setCaret] = useState(0)
  const [hits, setHits] = useState<string[]>([])
  const [hitErr, setHitErr] = useState<string>()
  const previews = useRef(new Map<string, string>()) // object URLs for images added in this dialog
  const picker = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const filesRef = useRef(p.files)
  filesRef.current = p.files
  useEffect(() => () => { previews.current.forEach((u) => URL.revokeObjectURL(u)) }, [])

  // `/` menu only while the whole text is a slash token; `@` menu for the mention under the caret
  const q = /^\/([a-z]*)$/.exec(p.text)
  const before = p.text.slice(0, caret)
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(before)
  const mentionQuery = !q && mention ? mention[1]! : undefined
  const slashItems = q && !dismissed ? ITEMS.filter((i) => i.key.startsWith(q[1]!) || i.label.startsWith(q[1]!)) : []
  const fileItems: Item[] = mentionQuery !== undefined && !dismissed && p.projectId
    ? hits.map((f) => ({ key: f, label: f.slice(f.lastIndexOf('/') + 1), sub: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '', section: '项目文件' as const }))
    : []
  const items = slashItems.length ? slashItems : fileItems
  const needProject = mentionQuery !== undefined && !dismissed && !p.projectId
  useEffect(() => { setIndex(0) }, [p.text, hits])
  useEffect(() => {
    if (mentionQuery === undefined || !p.projectId) { setHits([]); setHitErr(undefined); return }
    let live = true
    const t = setTimeout(() => {
      rpc<string[]>('files.search', { projectId: p.projectId, q: mentionQuery })
        .then((r) => { if (live) { setHits(r); setHitErr(undefined) } })
        .catch((e) => { if (live) { setHits([]); setHitErr((e as Error).message) } })
    }, 120)
    return () => { live = false; clearTimeout(t) }
  }, [mentionQuery, p.projectId])

  async function add(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      setUploading((n) => n + 1)
      try {
        const a = await uploadFile(f)
        if (f.type.startsWith('image/')) previews.current.set(a.id, URL.createObjectURL(f))
        p.onFiles([...filesRef.current, a])
      } catch (e) { p.notify(`${f.name}：${(e as Error).message}`) } finally { setUploading((n) => n - 1) }
    }
  }
  function choose(i: Item) {
    if (i.section === '项目文件') {
      const start = before.length - (mention![1]!.length + 1)
      const next = `${p.text.slice(0, start)}@${i.key} ${p.text.slice(caret)}`
      const pos = start + i.key.length + 2
      p.onText(next); setCaret(pos)
      requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(pos, pos) })
    } else if (i.key === 'file') { p.onText(''); picker.current?.click() } else { p.onText(`/${i.key} `); area.current?.focus() }
  }

  return (
    <div className={`wb-composer ${over ? 'drop' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); void add(e.dataTransfer.files) } }}>
      {(items.length > 0 || needProject || (hitErr && mentionQuery !== undefined) || (fileItems.length === 0 && mentionQuery !== undefined && !dismissed && p.projectId && !hitErr && hits.length === 0 && mentionQuery !== '')) && (
        <div className="wb-slash" role="listbox">
          {SECTIONS.map((sec) => items.some((i) => i.section === sec) && (
            <div key={sec}><div className="wb-slash-h">{sec}</div>
              {items.filter((i) => i.section === sec).map((i) => (
                <div key={i.key} role="option" aria-selected={items[index] === i} className="wb-slash-i"
                  onMouseEnter={() => setIndex(items.indexOf(i))} onMouseDown={(e) => { e.preventDefault(); choose(i) }}>
                  <b>{i.label}</b>{i.section === '指令' || i.section === '添加' ? <span className="k">{i.key}</span> : <span className="k wb-ellipsis">{i.sub}</span>}
                  {i.desc && <span className="d">{i.desc}</span>}
                </div>))}
            </div>))}
          {needProject && <div className="wb-slash-h">请先在下方选择项目，才能搜索项目文件</div>}
          {hitErr && <div className="wb-slash-h" style={{ color: 'var(--wb-red)' }}>{hitErr}</div>}
          {!items.length && !needProject && !hitErr && <div className="wb-slash-h">没有匹配的文件</div>}
        </div>
      )}
      {p.files.length > 0 && (
        <div className="wb-files in">{p.files.map((a) => (
          <div className="wb-file" key={a.id}>
            {previews.current.get(a.id) ? <img src={previews.current.get(a.id)} alt="" /> : <span className="ic">{isImage(a) ? '🖼' : '📄'}</span>}
            <span className="wb-ellipsis wb-grow" title={a.name}>{a.name}</span><span className="wb-muted">{fmtSize(a.size)}</span>
            <button aria-label="移除附件" onClick={() => p.onFiles(p.files.filter((x) => x.id !== a.id))}>✕</button></div>))}
        </div>
      )}
      <textarea ref={area} className="wb-composer-text" value={p.text} placeholder={p.placeholder}
        onChange={(e) => { p.onText(e.target.value); setCaret(e.target.selectionStart); setDismissed(false) }}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)} onClick={(e) => setCaret(e.currentTarget.selectionStart)}
        onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); void add(fs) } }}
        onKeyDown={(e) => {
          if (!items.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((index + 1) % items.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((index - 1 + items.length) % items.length) }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(items[index]!) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(true) }
        }} />
      <div className="wb-composer-bar">
        <input ref={picker} type="file" multiple hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = '' }} />
        <button className="wb-plus" aria-label="添加图片或文档" title="添加图片或文档" onClick={() => picker.current?.click()}>＋</button>
        {uploading > 0 && <span className="wb-muted">正在上传 {uploading} 个…</span>}
        <span className="wb-grow" />
        <span className="wb-muted">{COMMANDS.length ? '输入 / 选择指令 · ' : ''}@ 引用项目文件 · 可粘贴或拖入图片、文档</span>
      </div>
    </div>
  )
}
