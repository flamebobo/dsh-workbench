import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { demoZentao } from '../fixtures/demo.ts'
import { Store, Workbench } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

function setup(fetchImpl?: typeof fetch, now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-stats-'))
  const driver = new FakeDriver()
  const wb = new Workbench({ store: new Store(join(dir, 'w.json')), driver, creds: async () => undefined, fetch: fetchImpl, now, version: '9.9.9' })
  wb.seedDemoProjects(join(dir, 'repos'))
  wb.saveSettings({ isolateByDefault: false })
  return { driver, wb }
}

async function scenario() {
  const s = setup()
  const a = await s.wb.startWork({ item: demoZentao[0]! }) // finished and accepted
  s.driver.emit({ type: 'turn.completed', runId: a.run.id, status: 'completed' })
  s.wb.setStatus(a.issue.id, 'done')
  const b = await s.wb.startWork({ item: demoZentao[2]! }) // blocked
  s.driver.emit({ type: 'turn.completed', runId: b.run.id, status: 'failed', error: 'x' })
  s.wb.createIssue({ title: '没开始的', status: 'todo' })
  return { ...s, a, b }
}

test('stats are derived from the stored cards and runs', async () => {
  const { wb, a } = await scenario()
  const info = await wb.sparkinInfo()
  await wb.reportTimesheet({ date: '2026-10-24', entries: [{ issueId: a.issue.id, hours: 2.5, taskId: info.tasks['SP-PAY']![0]!.id }] })
  const t = wb.stats().totals
  assert.deepEqual([t.cards, t.started, t.done, t.doneRate], [3, 2, 1, 50])
  assert.deepEqual([t.reviewed, t.reviewPassRate], [1, 100]) // only A's agent finished; B failed
  assert.equal(t.hoursReported, 2.5)
  const s = wb.stats()
  assert.equal(s.byWeek.length, 8)
  assert.equal(s.byWeek.at(-1)!.started, 2) // both started this week
  assert.equal(s.byWeek.at(-1)!.done, 1)
  assert.deepEqual(s.bySource.find((x) => x.source === 'zentao'), { source: 'zentao', started: 2, done: 1 })
})

test('anonymous payload carries counts only: no titles, refs, paths or custom agent names', async () => {
  const { wb } = await scenario()
  wb.saveAgent({ id: 'secret-agent', name: '内部智能体', description: 'd', instructions: 'i' })
  const issue = wb.createIssue({ title: '机密标题', agentId: 'secret-agent', status: 'todo' })
  assert.ok(issue)
  const p = wb.statsPayload()
  const text = JSON.stringify(p)
  for (const leak of ['机密标题', 'BUG-4821', '支付回调', 'secret-agent', '内部智能体', 'repos', 'payment-core']) assert.ok(!text.includes(leak), `leaked ${leak}`)
  assert.equal(p.version, '9.9.9')
  assert.equal(p.clientId, wb.statsPayload().clientId) // stable across calls
  assert.match(p.clientId, /^[0-9a-f-]{36}$/)
})

test('reporting needs an address; manual report sends, the daily one only when on and at most once a day', async () => {
  const bodies: unknown[] = []
  let t = Date.parse('2026-10-24T08:00:00Z')
  const f = (async (url: string, init?: RequestInit) => { bodies.push({ url, body: JSON.parse(String(init!.body)) }); return new Response('ok') }) as typeof fetch
  const { wb } = setup(f, () => t)
  await assert.rejects(wb.reportStats(true), /还没有填写上报地址/)
  assert.throws(() => wb.saveSettings({ statsReportUrl: 'ftp://x' }), /上报地址必须以 http/) // only http(s) addresses are kept
  wb.saveSettings({ statsReportUrl: 'https://stats.corp/in' })
  await assert.rejects(wb.reportStats(), /没有开启/) // the switch is off
  await wb.maybeReportStats()
  assert.equal(bodies.length, 0)
  assert.equal((await wb.reportStats(true)).ok, true) // the button works regardless of the switch
  wb.saveSettings({ statsReportEnabled: true })
  await wb.maybeReportStats() // reported just now
  assert.equal(bodies.length, 1)
  t += 25 * 3600_000
  await wb.maybeReportStats()
  assert.equal(bodies.length, 2)
  assert.equal((bodies[1] as { url: string }).url, 'https://stats.corp/in')
})

test('a failing endpoint is recorded, not thrown, by the daily report', async () => {
  const { wb } = setup((async () => new Response('no', { status: 503 })) as never)
  wb.saveSettings({ statsReportUrl: 'https://stats.corp/in', statsReportEnabled: true })
  await wb.maybeReportStats()
  assert.deepEqual([wb.store.data.statsReport?.ok, wb.store.data.statsReport?.error], [false, 'HTTP 503'])
})

test('export: one row per card, CSV escapes quotes and commas and starts with a BOM', async () => {
  const { wb } = await scenario()
  wb.createIssue({ title: '带"引号",逗号', status: 'todo' })
  const { rows, csv } = wb.exportCards()
  assert.equal(rows.length, 4)
  assert.ok(csv.startsWith('﻿key,source,ref,title,status'))
  assert.ok(csv.includes('"带""引号"",逗号"'))
})
