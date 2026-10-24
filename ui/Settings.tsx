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
  const [sel, setSel] = useState<'zentao' | 'gitlab' | 'jenkins' | 'sparkin'>('zentao')

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

  const HELP: Record<string, string> = {
    zentao: '使用能登录禅道网页的账号。Bug 按「项目」页的禅道产品 ID 拉取，任务按下面的执行 / 迭代 ID 拉取；两者都没填时自动读取你能看到的产品和进行中的执行。',
    gitlab: '在 GitLab「用户设置 → Access Tokens」创建，勾选 read_api。工作台只读取指派给你评审的合并请求，不会改动仓库。',
    jenkins: '在 Jenkins「用户 → Configure → API Token」生成。待办里读取失败的构建；要用看板的「构建验证」，这个账号还需要有目标 Job 的构建权限。',
  }
  const cur = conns.find((c) => c.id === sel)
  return (
    <div className="wb-split" style={{ flex: 1 }}>
      <nav className="wb-list" style={{ width: 220 }} aria-label="设置菜单">
        <div className="wb-menu-h">连接</div>
        {conns.map((c) => (
          <button key={c.id} className="wb-li" aria-selected={sel === c.id} onClick={() => setSel(c.id)}>
            <div className="wb-row"><b>{c.label}</b><span className="wb-grow" />
              <span className="wb-dotx" style={{ background: c.configured ? 'var(--wb-green)' : 'var(--wb-fg3)' }} /></div>
            <div className="wb-muted" style={{ fontSize: 12 }}>{c.configured ? '已配置 · 实时数据' : '未配置 · 演示数据'}</div>
          </button>
        ))}
        <button className="wb-li" aria-selected={sel === 'sparkin'} onClick={() => setSel('sparkin')}>
          <div className="wb-row"><b>Sparkin</b><span className="wb-grow" /><span className="wb-dotx" style={{ background: 'var(--wb-amber)' }} /></div>
          <div className="wb-muted" style={{ fontSize: 12 }}>演示模式 · 待对接</div>
        </button>
      </nav>
      <div className="wb-pane" style={{ maxWidth: 720 }}>
        {cur ? (
          <>
            <div className="wb-row"><h3 style={{ margin: 0 }}>{cur.label}</h3>
              <span className={`wb-pill ${cur.configured ? 'live' : 'demo'}`}>{cur.configured ? '已配置' : '未配置 · 演示数据'}</span></div>
            <div className="wb-sub" style={{ margin: '6px 0 14px' }}>{HELP[cur.id]}</div>
            {cur.fields.map((f) => (
              <div className="wb-field" key={f.key}><label>{f.label}{f.optional ? '（可选）' : ''}</label>
                <input className="wb-input" type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false}
                  value={valueOf(cur, f)} placeholder={f.secret && f.set ? '已设置，留空表示不修改' : f.placeholder}
                  onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })} /></div>
            ))}
            <div className="wb-row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
              <button className="wb-btn primary" disabled={!!busy} onClick={() => { void run(cur, 'save') }}>{busy === `${cur.id}:save` ? '保存中…' : '保存'}</button>
              <button className="wb-btn" disabled={!!busy} onClick={() => { void run(cur, 'test') }}>{busy === `${cur.id}:test` ? '测试中…' : '保存并测试连接'}</button>
              {cur.fields.some((f) => f.set) && <button className="wb-btn danger" disabled={!!busy} onClick={() => { void run(cur, 'clear') }}>清除凭据</button>}
            </div>
            {msg[cur.id] && <div className="wb-banner" style={{ margin: '12px 0 0', ...(msg[cur.id]!.ok ? { background: 'color-mix(in srgb, var(--wb-green) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--wb-green) 35%, transparent)' } : { background: 'color-mix(in srgb, var(--wb-red) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--wb-red) 35%, transparent)' }) }}>{msg[cur.id]!.text}</div>}
            <div className="wb-sub" style={{ marginTop: 22 }}>
              账号、密码和 Token 保存在 DSH 的凭据库（<code>~/.dsh/.credentials.yaml</code>，仅本机用户可读），不会出现在页面、提示词或日志里；Token / 密码栏留空表示不修改。配置好后「我的待办」自动拉取真实数据，每分钟刷新一次。
            </div>
          </>
        ) : (
          <>
            <div className="wb-row"><h3 style={{ margin: 0 }}>Sparkin（工时系统）</h3><span className="wb-pill demo">演示模式</span></div>
            <div className="wb-sub" style={{ margin: '8px 0' }}>
              Sparkin 的接口文档还没提供，所以「填报 Sparkin 工时」目前只把工时记录在工作台里，不会写入 Sparkin。拿到文档后在这里增加地址和 Token 即可接入，填报流程不变。
              项目与 Sparkin 项目的对应关系在「项目」里编辑项目时设置。
            </div>
          </>
        )}
      </div>
    </div>
  )
}
