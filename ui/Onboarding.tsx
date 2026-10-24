import * as React from 'react'
import { rpc, type ConnectionView, type RepoCandidate, type ScanResult } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React

/** First-run guide: 1) which systems are connected, 2) find local repositories and match them to GitLab, 3) create the projects. */
export function Onboarding({ p, onClose }: { p: PageProps; onClose: () => void }) {
  const [step, setStep] = useState(1)
  const [conns, setConns] = useState<ConnectionView[]>()
  const [roots, setRoots] = useState('')
  const [scan, setScan] = useState<ScanResult>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void rpc<ConnectionView[]>('connections.list').then(setConns).catch((e) => setError((e as Error).message))
    void rpc<string[]>('onboarding.roots').then((r) => setRoots(r.join('\n'))).catch(() => {})
  }, [])

  async function finish() {
    try { await rpc('settings.save', { ...p.state.settings, onboarded: true }); await p.refresh() } catch (e) { p.notify((e as Error).message) }
    onClose()
  }
  async function doScan() {
    setBusy(true); setError(undefined)
    try {
      const r = await rpc<ScanResult>('onboarding.scan', { roots: roots.split('\n').map((x) => x.trim()).filter(Boolean) })
      setScan(r); setPicked(new Set(r.repos.filter((x) => !x.known).map((x) => x.path)))
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function doImport() {
    if (!scan) return
    setBusy(true)
    try {
      const made = await rpc<unknown[]>('onboarding.import', { items: scan.repos.filter((r) => picked.has(r.path)).map((r) => ({ path: r.path, name: r.name, gitlabProjectId: r.gitlabProjectId, testCmd: r.testCmd })) })
      p.notify(`已创建 ${made.length} 个项目`)
      await finish()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const toggle = (path: string) => setPicked((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })
  const badge = (r: RepoCandidate) => r.known ? <span className="wb-pill">已是项目</span>
    : r.gitlabProjectId != null ? <span className="wb-pill live">GitLab #{r.gitlabProjectId}</span>
    : r.gitlabPath ? <span className="wb-pill demo" title="远程地址指向已配置的 GitLab，但没查到项目">未匹配 {r.gitlabPath}</span>
    : r.remote ? <span className="wb-pill" title={r.remote}>非当前 GitLab</span> : <span className="wb-pill">无远程</span>

  return (
    <div className="wb-modal-mask" style={{ zIndex: 50 }}>
      <div className="wb-modal" style={{ width: 'min(760px, 100%)' }} role="dialog" aria-label="首次使用引导">
        <div className="wb-row"><h3 style={{ margin: 0 }}>欢迎使用研发工作台 · 第 {step} / 2 步</h3><span className="wb-grow" />
          <button className="wb-btn" onClick={() => { void finish() }}>跳过引导</button></div>
        {error && <div className="wb-banner err" style={{ margin: '8px 0' }}>{error}</div>}

        {step === 1 && (
          <>
            <div className="wb-sub" style={{ margin: '8px 0 10px' }}>先连接你用到的系统。没有连接的系统，「我的待办」里显示的是演示数据，连接后会自动换成你自己的待办。</div>
            {(conns ?? []).map((c) => (
              <div className="wb-rel wb-row" key={c.id}><b>{c.label}</b>
                <span className={`wb-pill ${c.configured ? 'live' : 'demo'}`}>{c.configured ? '已配置' : '未配置 · 演示数据'}</span></div>))}
            <div className="wb-sub" style={{ margin: '10px 0' }}>账号、Token 在「设置」里填写并可以测试连接；也可以先跳过，之后随时配置。</div>
            <div className="wb-row"><button className="wb-btn" onClick={() => { onClose(); p.go('settings') }}>去设置连接</button><span className="wb-grow" />
              <button className="wb-btn primary" onClick={() => setStep(2)}>下一步：添加项目</button></div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="wb-sub" style={{ margin: '8px 0 10px' }}>在下面的目录里查找 git 仓库（每行一个目录，最多往下找两层），根据 <code>git remote</code> 自动匹配 GitLab 项目，并建好项目（工作目录、GitLab 项目 ID、测试命令）。</div>
            <div className="wb-field"><label>扫描目录</label>
              <textarea className="wb-textarea" style={{ minHeight: 64 }} value={roots} onChange={(e) => setRoots(e.target.value)} placeholder="~/code" /></div>
            <div className="wb-row"><button className="wb-btn" disabled={busy || !roots.trim()} onClick={() => { void doScan() }}>{busy && !scan ? '扫描中…' : scan ? '重新扫描' : '扫描'}</button>
              {scan && <span className="wb-muted">找到 {scan.repos.length} 个仓库{scan.gitlab === 'not_configured' ? '，未配置 GitLab，无法匹配项目 ID' : scan.gitlab === 'error' ? `，GitLab 查询出错：${scan.error}` : ''}</span>}</div>
            {scan && (
              <div style={{ maxHeight: 260, overflow: 'auto', margin: '10px 0' }}>
                {scan.repos.map((r) => (
                  <label className="wb-rel wb-row wb-pick" key={r.path} style={{ cursor: r.known ? 'default' : 'pointer' }}>
                    <input type="checkbox" disabled={r.known} checked={picked.has(r.path)} onChange={() => toggle(r.path)} />
                    <span className="wb-grow"><b>{r.name}</b><div className="wb-sub wb-ellipsis" title={r.path}>{r.path}{r.testCmd ? ` · 测试：${r.testCmd}` : ''}</div></span>{badge(r)}
                  </label>))}
                {!scan.repos.length && <div className="wb-empty">没有找到仓库，换个目录试试。</div>}
              </div>)}
            <div className="wb-row"><button className="wb-btn" onClick={() => setStep(1)}>上一步</button><span className="wb-grow" />
              <button className="wb-btn primary" disabled={busy || !scan || !picked.size} onClick={() => { void doImport() }}>创建 {picked.size || ''} 个项目并完成</button>
              <button className="wb-btn" onClick={() => { void finish() }}>完成</button></div>
          </>
        )}
      </div>
    </div>
  )
}
