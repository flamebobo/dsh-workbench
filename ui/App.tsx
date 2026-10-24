import * as React from 'react'
import { css } from './styles.ts'
import { rpc, type State, type TodoResult } from './api.ts'
import { Todos } from './Todos.tsx'
import { Board } from './Board.tsx'
import { Agents } from './Agents.tsx'
import { Projects } from './Projects.tsx'
import { Settings } from './Settings.tsx'
import { StatsPage } from './Stats.tsx'
import { Onboarding } from './Onboarding.tsx'

const { useState, useEffect, useCallback, useRef } = React
export type Tab = 'todos' | 'board' | 'agents' | 'projects' | 'stats' | 'settings'
const TABS: [Tab, string][] = [['todos', '我的待办'], ['board', '看板'], ['agents', '智能体'], ['projects', '项目'], ['stats', '统计'], ['settings', '设置']]

/** Shared props for every page. */
export interface PageProps {
  state: State
  refresh: () => Promise<void>
  notify: (msg: string) => void
  /** Jump to the card's agent session in the host; absent where the host has no way to (Codex). */
  openSession?: (sessionId: string) => void
  go: (tab: Tab, issueId?: string) => void
  openGuide: () => void
  focusIssue?: string
}

export function App({ openSession }: { openSession?: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('todos')
  const [state, setState] = useState<State>()
  const [todos, setTodos] = useState<TodoResult>()
  const [todosAt, setTodosAt] = useState<Date>()
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [focusIssue, setFocusIssue] = useState<string>()
  const [guide, setGuide] = useState(false)
  const [guideDismissed, setGuideDismissed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const refresh = useCallback(async () => {
    try { setState(await rpc<State>('state')); setError(undefined) } catch (e) { setError((e as Error).message) }
  }, [])
  const loadTodos = useCallback(async () => {
    try {
      const r = await rpc<TodoResult>('todos.list'); setTodos(r); setTodosAt(new Date())
      if (r.cleanedDemo) notify(`已清理 ${r.cleanedDemo} 张演示卡片（这个系统已接入真实数据；开过工或编辑过的演示卡片保留，带「演示」标记）`)
    } catch (e) { setError((e as Error).message) }
  }, [])
  const notify = useCallback((msg: string) => {
    setToast(msg); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(undefined), 4500)
  }, [])
  const go = useCallback((t: Tab, issueId?: string) => { setTab(t); setFocusIssue(issueId) }, [])

  // desktop notifications: tell the entry-level notifier whether we are on screen, and jump to a card when one was clicked
  useEffect(() => {
    window.__wbOpen = true
    const open = (issueId?: string) => { if (issueId) go('board', issueId) }
    if (window.__wbPending) { open(window.__wbPending); window.__wbPending = undefined }
    const on = (e: Event) => open((e as CustomEvent<{ issueId?: string }>).detail?.issueId)
    window.addEventListener('wb:open', on)
    return () => { window.__wbOpen = false; window.removeEventListener('wb:open', on) }
  }, [go])

  // Esc closes the top-most dialog, by the same path as clicking outside it (the first-run guide has no such handler, so it stays)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return // the @ / / menus handle (and consume) their own Esc
      const masks = document.querySelectorAll('.wb-modal-mask')
      masks[masks.length - 1]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // The board changes by itself when a session ends, so poll the cheap `state` call while the page is open.
  useEffect(() => {
    void refresh(); void loadTodos()
    const id = setInterval(() => { void refresh() }, 2000)
    // the Codex page also hears about changes as they happen (runtime_events), not only on the next poll
    const changed = () => { void refresh() }
    window.addEventListener('wb:changed', changed)
    return () => { clearInterval(id); clearTimeout(timer.current); window.removeEventListener('wb:changed', changed) }
  }, [refresh, loadTodos])

  // auto-pull Zentao / GitLab / Jenkins; the interval is a plugin setting (默认每分钟)
  const pullSeconds = state?.settings?.todoRefreshSeconds ?? 60
  useEffect(() => {
    const pull = setInterval(() => { void loadTodos() }, pullSeconds * 1000)
    return () => clearInterval(pull)
  }, [loadTodos, pullSeconds])

  // Todos carry card ids/status; re-read them (cheap in demo mode, one round trip live) when issues change.
  const sig = state?.issues.map((i) => i.id + i.status + i.updatedAt).join(',')
  useEffect(() => { if (todos) void loadTodos() }, [sig])

  const waiting = state?.issues.filter((i) => !i.archivedAt && (i.status === 'in_review' || i.status === 'blocked')).length ?? 0
  const demo = todos && Object.entries(todos.sources).filter(([, s]) => s.mode === 'demo')
  const props = state && { state, refresh, notify, openSession, go, focusIssue, openGuide: () => setGuide(true) }

  return (
    <div className="wb" style={{ position: 'relative' }}>
      <style>{css}</style>
      <div className="wb-head">
        <h2 className="wb-title">研发工作台</h2>
        <span className="wb-sub">{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
        {demo && demo.length > 0 && <span className="wb-pill demo" style={{ cursor: 'pointer' }} onClick={() => go('settings')} title={demo.map(([k]) => `${k}: 未配置凭据`).join('\n')}>演示数据</span>}
      </div>
      <div className="wb-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} className="wb-tab" role="tab" aria-selected={tab === k} onClick={() => go(k)}>{label}{k === 'board' && waiting > 0 && <span className="wb-badge" title="待审核 / 已阻塞，等你处理">{waiting}</span>}</button>
        ))}
      </div>
      {error && <div className="wb-banner err">{error}</div>}
      {state?.update?.newer && (
        <div className="wb-banner" role="status">
          有新版本 <b>{state.update.latest}</b>（当前 {state.update.current}）{state.update.notes && <>：{state.update.notes}</>}
          {state.update.url && <> · <a href={state.update.url} target="_blank" rel="noreferrer noopener">下载更新包</a></>}
          <span className="wb-muted"> · 解压后运行里面的 install.sh（Windows 运行 install.ps1），会替换文件并重启 DSH，数据保留</span>
        </div>)}
      <div className="wb-body">
        {!props ? <div className="wb-empty" style={{ flex: 1 }}>{error ? '无法连接 Host。' : '加载中…'}</div> : (
          <>
            {tab === 'todos' && <Todos {...props} todos={todos} todosAt={todosAt} reloadTodos={loadTodos} />}
            {tab === 'board' && <Board {...props} />}
            {tab === 'agents' && <Agents {...props} />}
            {tab === 'projects' && <Projects {...props} />}
            {tab === 'stats' && <StatsPage p={props} />}
            {tab === 'settings' && <Settings {...props} reloadTodos={loadTodos} />}
          </>
        )}
      </div>
      {props && (guide || (state.settings?.onboarded === false && !guideDismissed)) && <Onboarding p={props} onClose={() => { setGuide(false); setGuideDismissed(true) }} />}
      {toast && <div className="wb-toast" role="status">{toast}</div>}
    </div>
  )
}
