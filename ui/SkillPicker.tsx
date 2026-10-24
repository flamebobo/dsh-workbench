import * as React from 'react'
import { rpc, type SkillInfo } from './api.ts'

const { useState, useEffect } = React

/** Multi-select over the skills DSH can load (global, project and the configured skill packs). */
export function SkillPicker({ label, value, onChange }: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [q, setQ] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { void rpc<SkillInfo[]>('skills.list').then(setSkills).catch(() => {}).finally(() => setLoaded(true)) }, [])
  const chosen = new Set(value)
  const toggle = (name: string) => { const next = new Set(chosen); if (next.has(name)) next.delete(name); else next.add(name); onChange([...next]) }
  const shown = skills.filter((k) => `${k.name} ${k.description}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="wb-field"><label>{label}</label>
      {chosen.size > 0 && <div className="wb-chips" style={{ marginBottom: 6 }}>{[...chosen].map((k) => (
        <span className="wb-chipx" key={k}><b style={{ fontWeight: 600 }}>/{k}</b><button aria-label={`移除 ${k}`} onClick={() => toggle(k)}>✕</button></span>))}</div>}
      <input className="wb-input" type="search" placeholder={skills.length ? `搜索 ${skills.length} 个可用技能` : loaded ? '没有读取到可用技能' : '正在读取技能…'} value={q} onChange={(e) => setQ(e.target.value)} />
      {skills.length > 0 && <div className="wb-skills">{shown.map((k) => (
        <label className="wb-pick" key={k.name} style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={chosen.has(k.name)} onChange={() => toggle(k.name)} />
          <span><b>{k.name}</b> <span className="wb-muted">· {k.source}</span><div className="wb-sub">{k.description}</div></span></label>))}
        {!shown.length && <div className="wb-muted" style={{ padding: 8 }}>没有匹配的技能</div>}</div>}
    </div>
  )
}
