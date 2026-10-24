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
  openSession: (sessionId: string) => void
  go: (tab: Tab, issueId?: string) => void
  openGuide: () => void
  focusIssue?: string
}

export function App({ openSession }: { openSession: (id: string) => void }) {
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
    try { setTodos(await rpc<TodoResult>('todos.list')); setTodosAt(new Date()) } catch (e) { setError((e as Error).message) }
  }, [])
  const notify = useCallback((msg: string) => {
    setToast(msg); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(undefined), 4500)
  }, [])
  const go = useCallback((t: Tab, issueId?: string) => { setTab(t); setFocusIssue(issueId) }, [])

  // The board changes by itself when a session ends, so poll the cheap `state` call while the page is open.
  useEffect(() => {
    void refresh(); void loadTodos()
    const id = setInterval(() => { void refresh() }, 2000)
    return () => { clearInterval(id); clearTimeout(timer.current) }
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
  const demo = todos && Object.entries(todos.sources).filter(([, s]) => s.mode !== 'live')
  const props = state && { state, refresh, notify, openSession, go, focusIssue, openGuide: () => setGuide(true) }

  return (
    <div className="wb" style={{ position: 'relative' }}>
      <style>{css}</style>
      <div className="wb-head">
        <h2 className="wb-title">研发工作台</h2>
        <span className="wb-sub">{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
        {demo && demo.length > 0 && <span className="wb-pill demo" style={{ cursor: 'pointer' }} onClick={() => go('settings')} title={demo.map(([k, s]) => `${k}: ${s.mode === 'demo' ? '未配置凭据' : s.error}`).join('\n')}>演示数据</span>}
      </div>
      <div className="wb-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} className="wb-tab" role="tab" aria-selected={tab === k} onClick={() => go(k)}>{label}{k === 'board' && waiting > 0 && <span className="wb-badge" title="待审核 / 已阻塞，等你处理">{waiting}</span>}</button>
        ))}
      </div>
      {error && <div className="wb-banner err">{error}</div>}
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
