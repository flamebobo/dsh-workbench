import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { demoSparkin, demoZentao } from '../fixtures/demo.ts'
import { Store, suggestTask, Workbench } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

function setup(creds: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-flow-'))
  const driver = new FakeDriver()
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver, creds: async (n) => creds[n], fetch: fetchImpl })
  wb.seedDemoProjects(join(dir, 'repos'))
  wb.saveSettings({ isolateByDefault: false })
  return { dir, driver, wb }
}
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)) } }
const bug = demoZentao[0]!
const stateOf = (wb: Workbench, id: string) => wb.listIssues().find((i) => i.id === id)!

test('sparkin tasks appear in 我的待办 (demo), start on their project, and pre-select their own time-sheet task', async () => {
  const { wb, driver } = setup()
  const t = await wb.listTodos()
  assert.equal(t.sources.sparkin.mode, 'demo')
  assert.equal(t.items.filter((i) => i.source === 'sparkin').length, demoSparkin.length)
  const item = t.items.find((i) => i.ref === 'SPK-2031')!
  const { issue } = await wb.startWork({ item })
  assert.equal(issue.sparkinTaskId, 'SP-PAY-T2')
  assert.equal(driver.started[0]!.cwd, wb.listProjects().find((p) => p.sparkinProjectId === 'SP-PAY')!.cwd) // resolved through the Sparkin project id
  const tasks = await wb.sparkin.tasks('SP-PAY')
  assert.equal(suggestTask(issue, tasks)?.name, '需求开发')
  assert.equal(suggestTask({ ...issue, sparkinTaskId: undefined, sourceRef: { source: 'zentao', ref: 'BUG-1' } }, tasks)?.name, '缺陷修复') // other cards keep the heuristic
})

test('a live Sparkin failure falls back to demo data without touching the other systems', async () => {
  const { wb } = setup()
  ;(wb.sparkin as { mode: string }).mode = 'live'
  wb.sparkin.assigned = async () => { throw new Error('boom') }
  const t = await wb.listTodos()
  assert.deepEqual([t.sources.sparkin.mode, t.sources.sparkin.error], ['fallback', 'boom'])
  assert.ok(t.items.some((i) => i.source === 'sparkin'))
  assert.equal(t.sources.zentao.mode, 'demo')
})

test('status follows the session by itself: continuing it after review reopens the card, a plan answer too', async () => {
  const { wb, driver } = setup()
  const { issue, run } = await wb.startWork({ item: bug })
  assert.equal(issue.status, 'in_progress')
  driver.emit({ type: 'turn.completed', runId: run.id, status: 'completed', finalText: 'ok' })
  assert.equal(stateOf(wb, issue.id).status, 'in_review')
  // the human replies in the DSH session: a new turn on the same run
  driver.emit({ type: 'turn.started', runId: run.id, sessionId: `sess-${run.id}` })
  assert.equal(stateOf(wb, issue.id).status, 'in_progress')
  assert.equal(wb.listRuns().find((r) => r.id === run.id)!.status, 'running')
  driver.emit({ type: 'turn.completed', runId: run.id, status: 'completed', finalText: 'v2' })
  assert.equal(stateOf(wb, issue.id).status, 'in_review')
  assert.equal(wb.listRuns().find((r) => r.id === run.id)!.finalText, 'v2')

  // a plan handed over for approval parks the card in 待审核; the agent speaking again means it was answered
  const b = wb.createIssue({ title: 'p', projectId: wb.listProjects()[0]!.id, status: 'todo' })
  const r2 = (await wb.startIssue(b.id)).run
  driver.emit({ type: 'awaiting.user', runId: r2.id, reason: '计划已提交' })
  assert.equal(stateOf(wb, b.id).status, 'in_review')
  driver.emit({ type: 'message', runId: r2.id, text: '开始实施' })
  assert.equal(stateOf(wb, b.id).status, 'in_progress')

  // a finished card is never dragged back by late events
  wb.setStatus(issue.id, 'done')
  driver.emit({ type: 'turn.started', runId: run.id, sessionId: `sess-${run.id}` })
  assert.equal(stateOf(wb, issue.id).status, 'done')
})

test('tests passing move 待审核 -> 已完成 on their own; failing, disabled or no test command leave it to the human', async () => {
  const { wb, driver } = setup()
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  const run = async (testCmd: string | undefined) => {
    wb.saveProject({ ...project, testCmd })
    const i = wb.createIssue({ title: `t-${testCmd}`, projectId: project.id, status: 'todo' })
    const r = (await wb.startIssue(i.id)).run
    driver.emit({ type: 'turn.completed', runId: r.id, status: 'completed' })
    return i.id
  }
  const pass = await run('true')
  await until(() => stateOf(wb, pass).status === 'done')
  const fail = await run('false')
  await until(() => stateOf(wb, fail).checks?.at(-1)?.state === 'failed')
  assert.equal(stateOf(wb, fail).status, 'in_review')
  const none = await run(undefined)
  assert.equal(stateOf(wb, none).status, 'in_review')
  wb.saveSettings({ autoDoneOnPass: false })
  const off = await run('true')
  await until(() => stateOf(wb, off).checks?.at(-1)?.state === 'passed')
  assert.equal(stateOf(wb, off).status, 'in_review')
  assert.throws(() => wb.setStatus(off, 'done', 'system'), /只能由人设置/) // the system gate itself is unchanged
})

test('zentao write-back: only finished bugs, once; demo records nothing external; live posts resolve with the comment', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return String(url).endsWith('/tokens') ? Response.json({ token: 'TKN' }) : Response.json({ id: 4821 })
  }) as typeof fetch
  // demo: no credentials
  const demo = setup()
  const { issue, run } = await demo.wb.startWork({ item: bug })
  assert.equal(demo.wb.canWriteBack(issue.id), false) // not finished yet
  await assert.rejects(demo.wb.writeBackZentao(issue.id), /已完成、来自禅道 Bug/)
  demo.driver.emit({ type: 'turn.completed', runId: run.id, status: 'completed', finalText: '加了幂等键' })
  demo.wb.setStatus(issue.id, 'done')
  const d = await demo.wb.writeBackDraft(issue.id)
  assert.equal(d.mode, 'demo')
  assert.match(d.comment, /加了幂等键/)
  const done = await demo.wb.writeBackZentao(issue.id, '已修复，见 MR')
  assert.deepEqual([done.writeBack?.status, done.writeBack?.demo, done.writeBack?.comment], ['resolved', true, '已修复，见 MR'])
  await assert.rejects(demo.wb.writeBackZentao(issue.id), /已经回写/)

  // live: token, then POST /bugs/4821/resolve
  const live = setup({ WORKBENCH_ZENTAO_URL: 'https://z.test/', WORKBENCH_ZENTAO_ACCOUNT: 'me', WORKBENCH_ZENTAO_PASSWORD: 'pw' }, f)
  const l = await live.wb.startWork({ item: bug })
  live.driver.emit({ type: 'turn.completed', runId: l.run.id, status: 'completed' })
  live.wb.setStatus(l.issue.id, 'done')
  const r = await live.wb.writeBackZentao(l.issue.id, '修好了')
  assert.equal(r.writeBack?.demo, undefined)
  const post = calls.find((c) => c.url.endsWith('/bugs/4821/resolve'))!
  assert.equal(post.url, 'https://z.test/api.php/v1/bugs/4821/resolve')
  assert.equal((post.init!.headers as Record<string, string>).Token, 'TKN')
  assert.deepEqual(JSON.parse(String(post.init!.body)), { resolution: 'fixed', resolvedBuild: 'trunk', comment: '修好了' })

  // a Zentao task (not a bug) is never written back
  const task = demoZentao.find((x) => x.ref.startsWith('TASK-'))!
  const t = await live.wb.startWork({ item: task })
  live.wb.setStatus(t.issue.id, 'done')
  assert.equal(live.wb.canWriteBack(t.issue.id), false)
})

test('zentao write-back "auto": finishing the bug writes it back; a failure is kept on the card, not thrown', async () => {
  const ok = setup({}, undefined)
  ok.wb.saveSettings({ zentaoWriteBack: 'auto' })
  const a = await ok.wb.startWork({ item: bug })
  ok.driver.emit({ type: 'turn.completed', runId: a.run.id, status: 'completed' })
  ok.wb.setStatus(a.issue.id, 'done')
  await until(() => !!stateOf(ok.wb, a.issue.id).writeBack)

  const bad = setup({ WORKBENCH_ZENTAO_URL: 'https://z.test', WORKBENCH_ZENTAO_ACCOUNT: 'me', WORKBENCH_ZENTAO_PASSWORD: 'pw' }, (async () => new Response('no', { status: 500 })) as never)
  bad.wb.saveSettings({ zentaoWriteBack: 'auto' })
  const b = await bad.wb.startWork({ item: bug })
  bad.driver.emit({ type: 'turn.completed', runId: b.run.id, status: 'completed' })
  bad.wb.setStatus(b.issue.id, 'done')
  await until(() => !!stateOf(bad.wb, b.issue.id).note)
  assert.match(stateOf(bad.wb, b.issue.id).note!, /回写禅道失败/)
  assert.equal(stateOf(bad.wb, b.issue.id).writeBack, undefined)
})

test('日报/周报: draft from this period\'s cards, hours by Sparkin task and commit subjects; the task for 周报助手 only on request, once', async () => {
  const { wb } = setup()
  await assert.rejects(wb.buildReport('week'), /还没有可汇总/)
  const a = await wb.startWork({ item: bug })
  wb.setStatus(a.issue.id, 'done')
  wb.archiveIssue(a.issue.id, true) // archived done cards still count for the period
  const info = await wb.sparkinInfo()
  const today = new Date()
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  await wb.reportTimesheet({ date: ymd, entries: [{ issueId: a.issue.id, hours: 3, taskId: info.tasks['SP-PAY']![0]!.id }] })
  const open = wb.createIssue({ title: '还在做', projectId: a.issue.projectId, status: 'in_progress' })

  const day = await wb.buildReport('day')
  assert.match(day.title, /^日报 \d{4}-\d{2}-\d{2}$/)
  assert.match(day.text, /## 已完成（1）\n- WB-1（BUG-4821） 支付回调幂等修复 .* · 3h/)
  assert.match(day.text, /## 进行中（1）\n- WB-2 还在做/)
  assert.match(day.text, /已填报工时合计：3h（缺陷修复 3h）/)
  assert.equal(day.hours, 3)
  const week = await wb.buildReport('week')
  assert.match(week.title, /^周报 \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/)
  assert.equal(wb.listIssues().some((i) => i.agentId === 'weekly'), false) // a draft creates nothing

  const task = await wb.createReportTask('week', `${week.text}\n（我补了一句）`)
  assert.equal(task.status, 'backlog') // auto-run never picks it up
  assert.equal(task.agentId, 'weekly')
  assert.equal(task.projectId, a.issue.projectId)
  assert.match(task.description, /我补了一句/) // the edited draft is what the agent gets
  await assert.rejects(wb.createReportTask('week'), /已经生成过/)
  assert.ok((await wb.createReportTask('day')).title.startsWith('日报'))
  assert.ok(open)
})

test('notices: 待审核, 已阻塞 and write-back are announced once, in order; nothing replays after a start', async () => {
  const { wb, driver } = setup()
  const start = wb.noticesSince(undefined)
  assert.deepEqual([start.items.length, start.last, start.enabled], [0, 0, true])
  const a = await wb.startWork({ item: bug })
  assert.equal(wb.noticesSince(0).items.length, 0) // 进行中 is not news
  driver.emit({ type: 'turn.completed', runId: a.run.id, status: 'completed', finalText: 'x' })
  const b = wb.createIssue({ title: '会失败', projectId: wb.listProjects()[0]!.id, status: 'todo' })
  const rb = (await wb.startIssue(b.id)).run
  driver.emit({ type: 'turn.completed', runId: rb.id, status: 'failed', error: '模型出错' })
  const items = wb.noticesSince(0).items
  assert.deepEqual(items.map((n) => [n.kind, n.issueId]), [['review', a.issue.id], ['blocked', b.id]])
  assert.match(items[0]!.title, /^WB-1 支付回调幂等修复/)
  assert.equal(items[1]!.text, '模型出错')
  wb.setStatus(a.issue.id, 'done')
  await wb.writeBackZentao(a.issue.id, '修好了')
  const last = wb.noticesSince(items.at(-1)!.id)
  assert.deepEqual(last.items.map((n) => n.kind), ['writeback']) // only what is newer than the id the page saw
  assert.match(last.items[0]!.text, /已回写禅道 BUG-4821.*演示/)
  assert.equal(wb.noticesSince(last.last).items.length, 0)
  wb.saveSettings({ desktopNotify: false })
  assert.equal(wb.noticesSince(0).enabled, false)
})

test('board sync: every to-do gets a 待规划 card once, keeps its own edits, and a deleted card stays deleted', async () => {
  const { wb } = setup()
  const t1 = await wb.listTodos()
  const sourced = t1.items.filter((i) => i.source !== 'manual')
  assert.ok(sourced.length >= 15)
  assert.ok(sourced.every((i) => i.issueId && i.issueStatus === 'backlog'))
  const cards = wb.listIssues()
  assert.equal(cards.length, sourced.length)
  const card = cards.find((c) => c.sourceRef?.ref === 'BUG-4821')!
  assert.deepEqual([card.status, card.agentId, card.projectId, card.priority], ['backlog', 'fullstack', wb.resolveProject(bug)!.id, 'P0'])
  await wb.listTodos() // pulling again adds nothing
  assert.equal(wb.listIssues().length, cards.length)
  const gitlab = cards.find((c) => c.sourceRef?.source === 'gitlab')!
  assert.equal(gitlab.agentId, 'reviewer') // the per-source default agent

  // auto-run never picks them up: 待规划 is not 待办
  wb.setAutoRun(true)
  await wb.tick()
  assert.equal(wb.workingCount(), 0)

  // deleting the card on purpose keeps it off the board; asking for it again (编辑) brings it back
  wb.deleteIssue(card.id)
  await wb.listTodos()
  assert.equal(wb.listIssues().some((c) => c.sourceRef?.ref === 'BUG-4821'), false)
  assert.equal((await wb.listTodos()).items.find((i) => i.ref === 'BUG-4821')!.issueId, undefined)
  wb.adoptTodo({ item: bug })
  assert.equal(wb.listIssues().some((c) => c.sourceRef?.ref === 'BUG-4821'), true)
  wb.deleteIssue(wb.listIssues().find((c) => c.sourceRef?.ref === 'BUG-4821')!.id)

  // switched off: the old behaviour, cards only when started
  const off = setup()
  off.wb.saveSettings({ syncTodosToBoard: false })
  await off.wb.listTodos()
  assert.equal(off.wb.listIssues().length, 0)
})

test('deadline and related info are edited on the card and win over the source; clearing sticks', async () => {
  const { wb } = setup()
  const row = async () => (await wb.listTodos()).items.find((i) => i.ref === 'BUG-4821')!
  let r = await row()
  assert.equal(r.due, '2026-10-23') // the source's own to start with
  assert.ok(r.related.length >= 3)
  const card = wb.listIssues().find((c) => c.sourceRef?.ref === 'BUG-4821')!
  wb.updateIssue(card.id, { due: '2026-11-02', related: [{ label: '  分支 fix/new ', detail: '改过的说明' }, { label: '  ' }, { label: '只有标题' }] })
  r = await row()
  assert.equal(r.due, '2026-11-02')
  assert.deepEqual(r.related, [{ label: '分支 fix/new', detail: '改过的说明' }, { label: '只有标题', detail: undefined }])
  assert.throws(() => wb.updateIssue(card.id, { due: '明天' }), /YYYY-MM-DD/)
  assert.throws(() => wb.updateIssue(card.id, { due: '2026-13-45' }), /YYYY-MM-DD/)
  wb.updateIssue(card.id, { due: '', related: [] })
  r = await row()
  assert.deepEqual([r.due, r.related], [undefined, []]) // cleared on purpose: the source's values do not come back

  // manual cards carry them too
  const m = wb.createIssue({ title: '手工', due: '2026-12-01', related: [{ label: '文档', detail: 'wiki' }], status: 'todo' })
  const mr = (await wb.listTodos()).items.find((i) => i.ref === m.key)!
  assert.deepEqual([mr.due, mr.related], ['2026-12-01', [{ label: '文档', detail: 'wiki' }]])
})

test('a card whose item left a live source is flagged, and unflagged when it returns', async () => {
  let gone = false
  const f = (async (url: string) => {
    const u = String(url)
    if (u.endsWith('/tokens')) return Response.json({ token: 'T' })
    if (u.includes('/products/12/bugs')) return Response.json({ bugs: gone ? [] : [{ id: 7, title: '线上缺陷', pri: 1, status: 'active', assignedTo: 'me' }] })
    return Response.json({ bugs: [], tasks: [], executions: [], products: [] })
  }) as typeof fetch
  const { wb } = setup({ WORKBENCH_ZENTAO_URL: 'https://z.test', WORKBENCH_ZENTAO_ACCOUNT: 'me', WORKBENCH_ZENTAO_PASSWORD: 'pw' }, f)
  await wb.listTodos()
  const card = () => wb.listIssues().find((c) => c.sourceRef?.ref === 'BUG-7')!
  assert.equal(card().note, undefined)
  gone = true
  await wb.listTodos()
  assert.match(card().note!, /已不在你的待办中/)
  gone = false
  await wb.listTodos()
  assert.equal(card().note, undefined)
})
