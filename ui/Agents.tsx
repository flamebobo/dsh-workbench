import * as React from 'react'
import { rpc, type AgentProfile } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React
const NEW = '__new'

export function Agents(p: PageProps) {
  const { state } = p
  const [id, setId] = useState(state.agents[0]?.id ?? NEW)
  const cur = id === NEW ? undefined : state.agents.find((a) => a.id === id)
  const [f, setF] = useState<AgentProfile>(blank(cur))
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { setF(blank(cur)) }, [id])
  useEffect(() => { void rpc<typeof models>('models.list').then(setModels).catch(() => {}) }, [])

  async function save() {
    const agent = { ...f, id: cur ? cur.id : `agent-${Date.now().toString(36)}` }
    try {
      const saved = await rpc<AgentProfile>('agent.save', agent)
      await p.refresh(); setId(saved.id); p.notify(`已保存「${saved.name}」，并已注册为 DSH 智能体预设（工作台 · ${saved.name}）`)
    } catch (e) { p.notify((e as Error).message) }
  }

  return (
    <div className="wb-split" style={{ flex: 1 }}>
      <div className="wb-list">
        {state.agents.map((a) => (
          <button key={a.id} className="wb-li" aria-selected={a.id === id} onClick={() => setId(a.id)}>
            <b>{a.name}</b><div className="wb-muted wb-ellipsis">{a.description}</div>
          </button>
        ))}
        <button className="wb-btn" style={{ width: '100%' }} onClick={() => setId(NEW)}>+ 新建智能体</button>
      </div>
      <div className="wb-pane">
        <h3 style={{ marginTop: 0 }}>{cur ? cur.name : '新建智能体'}</h3>
        <div className="wb-field"><label>名称</label><input className="wb-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="wb-field"><label>描述</label><input className="wb-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="wb-field"><label>模型</label>
          <select className="wb-select" value={f.model ?? ''} onChange={(e) => setF({ ...f, model: e.target.value || undefined })}>
            <option value="">跟随 DSH 默认模型</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select></div>
        <div className="wb-field"><label>系统指令</label><textarea className="wb-textarea" style={{ minHeight: 220 }} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
        <div className="wb-row"><button className="wb-btn primary" onClick={() => { void save() }}>保存</button>
          <span className="wb-muted">保存后注册为 DSH 智能体预设，开工时按卡片指派的智能体使用。</span></div>
      </div>
    </div>
  )
}

const blank = (a?: AgentProfile): AgentProfile => a ? { ...a } : { id: '', name: '', description: '', instructions: '' }
