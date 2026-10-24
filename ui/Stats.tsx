import * as React from 'react'
import { rpc } from './api.ts'
import type { Stats } from '../core/src/stats.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React

interface Payload { payload: unknown; last?: { at: string; ok: boolean; error?: string } }
const SOURCE: Record<string, string> = { zentao: '禅道', gitlab: 'GitLab', jenkins: 'Jenkins', sparkin: 'Sparkin', manual: '手工' }

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 统计: your own numbers, computed from this machine's cards and runs. Anonymous reporting is opt-in (设置 → 插件设置). */
export function StatsPage({ p }: { p: PageProps }) {
  const [stats, setStats] = useState<Stats>()
  const [pay, setPay] = useState<Payload>()
  const [showPay, setShowPay] = useState(false)
  const [busy, setBusy] = useState(false)
  const s = p.state.settings
  const load = () => { void rpc<Stats>('stats.get').then(setStats).catch((e) => p.notify((e as Error).message)); void rpc<Payload>('stats.payload').then(setPay).catch(() => {}) }
  useEffect(load, [p.state.issues.map((i) => i.id + i.status + i.updatedAt).join()])

  async function report() {
    setBusy(true)
    try {
      const r = await rpc<{ ok: boolean; error?: string }>('stats.report')
      p.notify(r.ok ? '已上报' : `上报失败：${r.error}`); load()
    } catch (e) { p.notify((e as Error).message) } finally { setBusy(false) }
  }
  async function exportAs(kind: 'csv' | 'json') {
    try {
      const { rows, csv } = await rpc<{ rows: unknown[]; csv: string }>('stats.export')
      const stamp = new Date().toISOString().slice(0, 10)
      if (kind === 'csv') download(`workbench-cards-${stamp}.csv`, csv, 'text/csv;charset=utf-8')
      else download(`workbench-stats-${stamp}.json`, JSON.stringify({ stats, cards: rows }, null, 2), 'application/json')
    } catch (e) { p.notify((e as Error).message) }
  }

  if (!stats) return <div className="wb-empty" style={{ flex: 1 }}>正在统计…</div>
  const t = stats.totals
  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`)
  const tiles: [string, string, string?][] = [
    ['开工数', String(t.started), `共 ${t.cards} 张卡片`], ['完成数', String(t.done), `完成率 ${t.doneRate}%`],
    ['审核通过率', `${t.reviewPassRate}%`, `${t.reviewed} 张到过待审核`], ['合并请求', String(t.mrs)],
    ['测试通过', `${t.testsPassed} / ${t.testsRun}`], ['已填报工时', `${t.hoursReported}h`], ['智能体累计运行', hours(t.agentMinutes)],
  ]
  const max = Math.max(1, ...stats.byWeek.flatMap((w) => [w.started, w.done]))
  const last = pay?.last

  return (
    <div className="wb-pane" style={{ display: 'block' }}>
      <div className="wb-row"><h3 style={{ margin: 0 }}>统计</h3><span className="wb-sub">只统计这台电脑上的数据；「完成」以你拖到已完成为准，工时是你填报过的，不做估算。</span><span className="wb-grow" />
        <button className="wb-btn" onClick={() => { void exportAs('csv') }}>导出 CSV</button>
        <button className="wb-btn" onClick={() => { void exportAs('json') }}>导出 JSON</button></div>

      <div className="wb-tiles">{tiles.map(([k, v, sub]) => <div className="wb-tile" key={k}><div className="wb-sub">{k}</div><div className="wb-tile-v">{v}</div>{sub && <div className="wb-sub">{sub}</div>}</div>)}</div>

      <h4 className="wb-sec">最近 8 周</h4>
      <div className="wb-weeks" role="img" aria-label="最近 8 周的开工数和完成数">
        {stats.byWeek.map((w) => (
          <div className="wb-week" key={w.week} title={`${w.week} 起一周：开工 ${w.started}，完成 ${w.done}`}>
            <div className="wb-bars"><i className="a" style={{ height: `${(w.started / max) * 100}%` }} /><i className="b" style={{ height: `${(w.done / max) * 100}%` }} /></div>
            <div className="wb-sub">{w.week.slice(5)}</div>
          </div>))}
      </div>
      <div className="wb-sub"><i className="wb-key a" /> 开工　<i className="wb-key b" /> 完成</div>

      <div className="wb-pcols" style={{ marginTop: 14 }}>
        <section className="wb-panel"><h4>按智能体</h4>
          {stats.byAgent.length ? stats.byAgent.map((a) => <div className="wb-rel wb-row" key={a.agentId}><span className="wb-grow">{p.state.agents.find((x) => x.id === a.agentId)?.name ?? a.agentId}</span><span className="wb-muted">开工 {a.started} · 完成 {a.done}</span></div>) : <div className="wb-muted">还没有数据</div>}</section>
        <section className="wb-panel"><h4>按来源</h4>
          {stats.bySource.length ? stats.bySource.map((a) => <div className="wb-rel wb-row" key={a.source}><span className="wb-grow">{SOURCE[a.source] ?? a.source}</span><span className="wb-muted">开工 {a.started} · 完成 {a.done}</span></div>) : <div className="wb-muted">还没有数据</div>}</section>
      </div>

      <h4 className="wb-sec">匿名上报</h4>
      <div className="wb-sub" style={{ marginBottom: 8 }}>
        默认关闭。在「设置 → 插件设置 → 统计与上报」填写上报地址并开启后，每天最多上报一次上面的汇总数字（不含任务标题、编号、路径、人名）。
        当前：{s?.statsReportUrl ? `地址 ${s.statsReportUrl}，${s.statsReportEnabled ? '每日自动上报已开启' : '自动上报未开启'}` : '未填写上报地址'}。
        {last && <span style={{ color: last.ok ? 'var(--wb-green)' : 'var(--wb-red)' }}> 上次 {new Date(last.at).toLocaleString('zh-CN', { hour12: false })} {last.ok ? '成功' : `失败：${last.error}`}</span>}
      </div>
      <div className="wb-row">
        <button className="wb-btn" onClick={() => setShowPay(!showPay)}>{showPay ? '收起' : '查看将上报的内容'}</button>
        <button className="wb-btn" disabled={busy || !s?.statsReportUrl} title={s?.statsReportUrl ? '立即发送一次（不受自动上报开关限制）' : '先填写上报地址'} onClick={() => { void report() }}>{busy ? '上报中…' : '立即上报'}</button>
      </div>
      {showPay && <pre className="wb-pre">{JSON.stringify(pay?.payload, null, 2)}</pre>}
    </div>
  )
}
