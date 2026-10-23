import * as React from 'react'
import { rpc, type ConnectionView } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React

/**
 * Credentials for the three systems. They are stored in DSH's credential store by the Host; the page only learns whether a secret is set
 * (a secret field left empty keeps the stored value) and can never read it back.
 */
export function Settings(p: PageProps & { reloadTodos: () => Promise<void> }) {
  const [conns, setConns] = useState<ConnectionView[]>()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [busy, setBusy] = useState<string>()

  const load = async () => { setConns(await rpc<ConnectionView[]>('connections.list')) }
  useEffect(() => { void load().catch((e) => p.notify((e as Error).message)) }, [])
  if (!conns) return <div className="wb-empty" style={{ flex: 1 }}>加载中…</div>

  const valueOf = (c: ConnectionView, f: ConnectionView['fields'][number]) => edits[f.key] ?? (f.secret ? '' : f.value ?? '')
  const say = (id: string, ok: boolean, text: string) => setMsg((m) => ({ ...m, [id]: { ok, text } }))

  async function run(c: ConnectionView, action: 'save' | 'test' | 'clear') {
    setBusy(`${c.id}:${action}`)
    try {
      if (action === 'clear') {
        if (!confirm(`清除${c.label}的全部凭据？`)) return
        setConns(await rpc<ConnectionView[]>('connections.clear', { id: c.id }))
        setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !c.fields.some((f) => f.key === k))))
        say(c.id, true, '已清除，待办回到演示数据')
        await p.refresh(); await p.reloadTodos()
        return
      }
      if (action === 'save' || Object.keys(edits).some((k) => c.fields.some((f) => f.key === k))) {
        const values = Object.fromEntries(c.fields.filter((f) => f.key in edits).map((f) => [f.key, edits[f.key]]))
        setConns(await rpc<ConnectionView[]>('connections.save', { id: c.id, values }))
        setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !c.fields.some((f) => f.key === k))))
      }
      if (action === 'save') { say(c.id, true, '已保存'); await p.reloadTodos(); return }
      const r = await rpc<{ ok: boolean; message: string }>('connections.test', { id: c.id })
      say(c.id, r.ok, r.message)
      if (r.ok) await p.reloadTodos()
    } catch (e) { say(c.id, false, (e as Error).message) } finally { setBusy(undefined) }
  }

  return (
    <div className="wb-main"><div className="wb-pane" style={{ maxWidth: 820 }}>
      <h3 style={{ marginTop: 0 }}>连接设置</h3>
      <div className="wb-sub" style={{ marginBottom: 12 }}>
        账号、密码和 Token 保存在 DSH 的凭据库（<code>~/.dsh/.credentials.yaml</code>，仅本机用户可读），不会出现在页面、提示词或日志里。配置好后「我的待办」自动拉取真实数据，每分钟刷新一次；没配的系统继续显示演示数据。
      </div>
      {conns.map((c) => (
        <section className="wb-conn" key={c.id}>
          <div className="wb-row"><b style={{ fontSize: 14 }}>{c.label}</b>
            <span className={`wb-pill ${c.configured ? 'live' : 'demo'}`}>{c.configured ? '已配置' : '未配置 · 演示数据'}</span></div>
          {c.fields.map((f) => (
            <div className="wb-field" key={f.key}><label>{f.label}{f.optional ? '（可选）' : ''}</label>
              <input className="wb-input" type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false}
                value={valueOf(c, f)} placeholder={f.secret && f.set ? '已设置，留空表示不修改' : f.placeholder}
                onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })} /></div>
          ))}
          <div className="wb-row">
            <button className="wb-btn primary" disabled={!!busy} onClick={() => { void run(c, 'save') }}>{busy === `${c.id}:save` ? '保存中…' : '保存'}</button>
            <button className="wb-btn" disabled={!!busy} onClick={() => { void run(c, 'test') }}>{busy === `${c.id}:test` ? '测试中…' : '保存并测试连接'}</button>
            {c.fields.some((f) => f.set) && <button className="wb-btn danger" disabled={!!busy} onClick={() => { void run(c, 'clear') }}>清除</button>}
            {msg[c.id] && <span style={{ color: msg[c.id]!.ok ? 'var(--wb-green)' : 'var(--wb-red)' }}>{msg[c.id]!.text}</span>}
          </div>
        </section>
      ))}
    </div></div>
  )
}
