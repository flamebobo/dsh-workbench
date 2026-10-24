import * as React from 'react'
import { rpc, type AgentProfile, type ModelInfo, type SkillInfo } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React
const NEW = '__new'

export function Agents(p: PageProps) {
  const { state } = p
  const [id, setId] = useState(state.agents[0]?.id ?? NEW)
  const cur = id === NEW ? undefined : state.agents.find((a) => a.id === id)
  const [f, setF] = useState<AgentProfile>(blank(cur))
  const [models, setModels] = useState<ModelInfo[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [skillQ, setSkillQ] = useState('')
  useEffect(() => { setF(blank(cur)) }, [id])
  useEffect(() => {
    void rpc<{ models: ModelInfo[]; defaultModel: string }>('models.list').then((r) => { setModels(r.models); setDefaultModel(r.defaultModel) }).catch(() => {})
    void rpc<SkillInfo[]>('skills.list').then(setSkills).catch(() => {})
  }, [])
  const model = models.find((m) => m.id === (f.model || defaultModel))
  const efforts = model?.efforts ?? []
  const chosen = new Set(f.skills ?? [])
  const toggleSkill = (name: string) => { const next = new Set(chosen); if (next.has(name)) next.delete(name); else next.add(name); setF({ ...f, skills: [...next] }) }
  const shown = skills.filter((k) => `${k.name} ${k.description}`.toLowerCase().includes(skillQ.trim().toLowerCase()))

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
        <div className="wb-row">
          <div className="wb-field wb-grow"><label>模型</label>
            <select className="wb-select" value={f.model ?? ''} onChange={(e) => {
              const m = models.find((x) => x.id === (e.target.value || defaultModel))
              setF({ ...f, model: e.target.value || undefined, effort: m?.efforts?.some((x) => x.id === f.effort) ? f.effort : undefined })
            }}>
              <option value="">跟随 DSH 默认模型{defaultModel ? `（${defaultModel}）` : ''}</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
          <div className="wb-field wb-grow"><label>模型强度（推理等级）</label>
            <select className="wb-select" value={f.effort ?? ''} disabled={!efforts.length} onChange={(e) => setF({ ...f, effort: e.target.value || undefined })}>
              <option value="">{efforts.length ? `模型默认${model?.defaultEffort ? `（${efforts.find((x) => x.id === model.defaultEffort)?.name ?? model.defaultEffort}）` : ''}` : '当前模型没有可选强度'}</option>
              {efforts.map((x) => <option key={x.id} value={x.id} title={x.description}>{x.name}</option>)}
            </select></div>
        </div>
        <div className="wb-field"><label>关联技能（多选；开工时在首条消息里用 /技能名 显式指定，智能体会先加载它们）</label>
          {chosen.size > 0 && <div className="wb-chips" style={{ marginBottom: 6 }}>{[...chosen].map((k) => (
            <span className="wb-chipx" key={k}><b style={{ fontWeight: 600 }}>/{k}</b><button aria-label={`移除 ${k}`} onClick={() => toggleSkill(k)}>✕</button></span>))}</div>}
          <input className="wb-input" type="search" placeholder={skills.length ? `搜索 ${skills.length} 个可用技能` : '没有读取到可用技能'} value={skillQ} onChange={(e) => setSkillQ(e.target.value)} />
          {skills.length > 0 && <div className="wb-skills">{shown.map((k) => (
            <label className="wb-pick" key={k.name} style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={chosen.has(k.name)} onChange={() => toggleSkill(k.name)} />
              <span><b>{k.name}</b> <span className="wb-muted">· {k.source}</span><div className="wb-sub">{k.description}</div></span></label>))}
            {!shown.length && <div className="wb-muted" style={{ padding: 8 }}>没有匹配的技能</div>}</div>}
        </div>
        <div className="wb-field"><label>系统指令</label><textarea className="wb-textarea" style={{ minHeight: 220 }} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
        <div className="wb-row"><button className="wb-btn primary" onClick={() => { void save() }}>保存</button>
          <span className="wb-muted">保存后注册为 DSH 智能体预设，开工时按卡片指派的智能体使用。</span></div>
      </div>
    </div>
  )
}

const blank = (a?: AgentProfile): AgentProfile => a ? { ...a } : { id: '', name: '', description: '', instructions: '' }
