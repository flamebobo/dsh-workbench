import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { demoZentao } from '../fixtures/demo.ts'
import { Store, Workbench, WorkbenchError } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

function setup(creds: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-'))
  const driver = new FakeDriver()
  const wb = new Workbench({
    store: new Store(join(dir, 'workbench.json')), driver, creds: async (n) => creds[n], fetch: fetchImpl,
  })
  wb.seedDemoProjects(join(dir, 'repos'))
  wb.saveSettings({ isolateByDefault: false }) // most tests assert on the project directory itself; isolation has its own tests
  return { dir, driver, wb }
}
const bug = demoZentao[0]!

test('开工 creates one in_progress card, starts a session in the project cwd with title/detail/acceptance', async () => {
  const { driver, wb, dir } = setup()
  const { issue, run } = await wb.startWork({ item: bug })
  assert.equal(issue.status, 'in_progress')
  assert.equal(issue.key, 'WB-1') // card keys don't share the counter with project ids
  assert.equal(issue.sessionId, `sess-${run.id}`)
  const req = driver.started[0]!
  assert.equal(req.cwd, join(dir, 'repos', 'payment-core'))
  assert.match(req.prompt, /支付回调幂等修复/)
  assert.match(req.prompt, /灰度环境出现同一笔支付回调重复入账/)
  assert.match(req.prompt, /1\. 重复回调不重复入账/)
  assert.match(req.prompt, /指派给你的角色：全栈工程师（.+）/)
  assert.equal(req.profile.presetId, 'fullstack')
  assert.match(req.profile.instructions, /^你的角色是「全栈工程师」/)
  assert.match(req.profile.instructions, /第一句话先说明你是「全栈工程师」/)
})

test('same source ref cannot be started twice', async () => {
  const { wb } = setup()
  const first = await wb.startWork({ item: bug })
  await assert.rejects(() => wb.startWork({ item: bug }), (e: unknown) =>
    e instanceof WorkbenchError && e.code === 'duplicate' && e.issueId === first.issue.id)
  assert.equal(wb.listIssues().length, 1)
})

test('turn.completed -> in_review; failed -> blocked; interrupted -> blocked', async () => {
  const { wb, driver } = setup()
  const a = await wb.startWork({ item: demoZentao[0]! })
  const b = await wb.startWork({ item: { ...demoZentao[2]!, project: '云支付 / payment-core' } })
  const c = await wb.startWork({ item: { ...demoZentao[3]!, project: '云支付 / payment-core' } })
  driver.emit({ type: 'turn.completed', runId: a.run.id, status: 'completed', finalText: 'ok' })
  driver.emit({ type: 'turn.completed', runId: b.run.id, status: 'failed', error: 'boom' })
  driver.emit({ type: 'turn.completed', runId: c.run.id, status: 'interrupted' })
  const by = (id: string) => wb.listIssues().find((i) => i.id === id)!
  assert.equal(by(a.issue.id).status, 'in_review')
  assert.equal(by(b.issue.id).status, 'blocked')
  assert.equal(by(b.issue.id).note, 'boom')
  assert.equal(by(c.issue.id).status, 'blocked')
  assert.equal(wb.listRuns(a.issue.id)[0]!.finalText, 'ok')
})

test('a late event never overrides a card the human already moved or finished', async () => {
  const { wb, driver } = setup()
  const a = await wb.startWork({ item: bug })
  wb.setStatus(a.issue.id, 'blocked')
  driver.emit({ type: 'turn.completed', runId: a.run.id, status: 'completed' })
  assert.equal(wb.listIssues()[0]!.status, 'blocked')
  driver.emit({ type: 'turn.completed', runId: a.run.id, status: 'failed' }) // duplicate event is ignored
  assert.equal(wb.listRuns()[0]!.status, 'completed')
})

test('done can only be set by a human', async () => {
  const { wb } = setup()
  const { issue } = await wb.startWork({ item: bug })
  assert.throws(() => wb.setStatus(issue.id, 'done', 'system'), (e: unknown) => e instanceof WorkbenchError && e.code === 'forbidden')
  assert.throws(() => wb.createIssue({ title: 'x', status: 'done' }), /只能由人/)
  assert.equal(wb.setStatus(issue.id, 'done', 'human').status, 'done')
})

test('start failure marks the card blocked with the error', async () => {
  const { wb, driver } = setup()
  driver.failStart = new Error('workspace denied')
  await assert.rejects(() => wb.startWork({ item: bug }), /workspace denied/)
  const i = wb.listIssues()[0]!
  assert.equal(i.status, 'blocked')
  assert.equal(i.note, 'workspace denied')
})

test('missing project mapping is refused before any card is created', async () => {
  const { wb } = setup()
  await assert.rejects(() => wb.startWork({ item: { ...bug, project: '未知', zentaoProductId: 999 } }), /没有对应的项目/)
  assert.equal(wb.listIssues().length, 0)
})

test('state survives a restart; runs left running are reconciled to blocked', async () => {
  const { wb, dir, driver } = setup()
  const { issue } = await wb.startWork({ item: bug })
  const wb2 = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver, creds: async () => undefined })
  const again = wb2.listIssues().find((i) => i.id === issue.id)!
  assert.equal(again.status, 'blocked')
  assert.match(again.note!, /宿主重启/)
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.tmp')).length, 0)
})

test('todos: no credentials -> demo; started items carry their card id', async () => {
  const { wb } = setup()
  const { issue } = await wb.startWork({ item: bug })
  const t = await wb.listTodos()
  assert.deepEqual(Object.values(t.sources).map((s) => s.mode), ['demo', 'demo', 'demo', 'demo'])
  assert.equal(t.items[0]!.priority, 'P0')
  assert.equal(t.items.find((x) => x.ref === 'BUG-4821')!.issueId, issue.id)
})

test('todos: live failure falls back to demo with the error, other systems stay live', async () => {
  const fetchImpl = (async (url: string) => {
    if (String(url).includes('gitlab')) return new Response('nope', { status: 500 })
    return Response.json({ jobs: [] })
  }) as typeof fetch
  const { wb } = setup({
    WORKBENCH_GITLAB_URL: 'https://gitlab.test', WORKBENCH_GITLAB_TOKEN: 't',
    WORKBENCH_JENKINS_URL: 'https://jenkins.test', WORKBENCH_JENKINS_USER: 'u', WORKBENCH_JENKINS_TOKEN: 't',
  }, fetchImpl)
  const t = await wb.listTodos()
  assert.equal(t.sources.gitlab.mode, 'fallback')
  assert.match(t.sources.gitlab.error!, /HTTP 500/)
  assert.equal(t.sources.jenkins.mode, 'live')
  assert.equal(t.items.filter((i) => i.source === 'jenkins').length, 0)
})

test('agents and projects are editable', () => {
  const { wb } = setup()
  assert.deepEqual(wb.listAgents().map((a) => a.name), ['全栈工程师', '代码审查员', '测试工程师', '构建修复员', '周报助手'])
  wb.saveAgent({ id: 'fullstack', name: '全栈', description: 'd', instructions: 'i', model: 'deepseek-pro' })
  assert.equal(wb.agent('fullstack').model, 'deepseek-pro')
  assert.throws(() => wb.saveProject({ name: 'x', cwd: 'relative/path' }), /绝对路径/)
})

test('every demo to-do resolves to a seeded demo project', async () => {
  const { wb } = setup()
  const { items } = await wb.listTodos()
  const missing = items.filter((i) => !wb.resolveProject(i)).map((i) => i.ref)
  assert.deepEqual(missing, [])
})

test('board-created task: appears in my to-dos, can be started once a project is chosen', async () => {
  const { wb, driver, dir } = setup()
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  const issue = wb.createIssue({ title: '手工任务：补充对账脚本', description: '背景', acceptance: [' 脚本可重复执行 ', ''], priority: 'P1', status: 'todo' })
  assert.deepEqual(issue.acceptance, ['脚本可重复执行'])

  const todo = (await wb.listTodos()).items.find((i) => i.source === 'manual' && i.ref === issue.key)!
  assert.equal(todo.title, '手工任务：补充对账脚本')
  assert.equal(todo.priority, 'P1')
  assert.equal(todo.issueId, issue.id)
  assert.equal(todo.project, '未选择项目')

  await assert.rejects(() => wb.startIssue(issue.id), /还没有选择项目/)
  assert.equal(wb.listIssues()[0]!.status, 'todo') // a refused start leaves the card alone

  wb.updateIssue(issue.id, { projectId: project.id, acceptance: ['a', 'b'] })
  const { issue: started } = await wb.startIssue(issue.id, 'tester')
  assert.equal(started.status, 'in_progress')
  assert.equal(started.agentId, 'tester')
  const req = driver.started[0]!
  assert.equal(req.cwd, join(dir, 'repos', 'payment-core'))
  assert.match(req.prompt, /手工任务：补充对账脚本/)
  assert.match(req.prompt, /1\. a\n2\. b/)
  assert.equal(req.profile.presetId, 'tester')

  await assert.rejects(() => wb.startIssue(issue.id), /正在进行中/)
  driver.emit({ type: 'turn.completed', runId: wb.listRuns()[0]!.id, status: 'completed' })
  assert.equal(wb.listIssues()[0]!.status, 'in_review')
  assert.equal((await wb.listTodos()).items.find((i) => i.ref === issue.key)!.project, project.name)
})

test('a blocked card can be started again; done cards cannot', async () => {
  const { wb, driver } = setup()
  const { issue } = await wb.startWork({ item: bug })
  driver.emit({ type: 'turn.completed', runId: wb.listRuns()[0]!.id, status: 'failed', error: 'x' })
  assert.equal(wb.listIssues()[0]!.status, 'blocked')
  await wb.startIssue(issue.id)
  assert.equal(wb.listRuns().length, 2)
  assert.equal(wb.listIssues()[0]!.status, 'in_progress')
  wb.setStatus(issue.id, 'done', 'human')
  await assert.rejects(() => wb.startIssue(issue.id), /已完成/)
})

test('task extras: attachments and /plan reach the driver; bad input is refused', async () => {
  const { wb, driver, dir } = setup()
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  const att = wb.saveUpload({ name: '../设计稿.png', mediaType: 'image/png', data: Buffer.from('png-bytes') })
  assert.equal(att.name, '.._设计稿.png') // never a path
  assert.equal(readFileSync(wb.uploadPath(att), 'utf8'), 'png-bytes')
  assert.throws(() => wb.saveUpload({ name: 'empty', data: new Uint8Array() }), /文件为空/)

  assert.throws(() => wb.createIssue({ title: 'x', command: 'rm' }), /不支持的指令/)

  const issue = wb.createIssue({
    title: '带附件的任务', projectId: project.id, command: 'plan',
    attachments: [att, { id: '00000000-0000-0000-0000-000000000000', name: 'ghost', mediaType: 'x', size: 1 }],
  })
  assert.deepEqual(issue.attachments!.map((a) => a.name), ['.._设计稿.png']) // the missing file is dropped

  await wb.startIssue(issue.id)
  const req = driver.started[0]!
  assert.equal(req.command, 'plan')
  assert.deepEqual(req.attachments, [{ name: '.._设计稿.png', mediaType: 'image/png', path: join(dir, 'uploads', att.id) }])
  assert.match(req.prompt, /## 附件.*\n- \.\._设计稿\.png/)

  wb.updateIssue(issue.id, { command: '' }) // clearing the command
  assert.equal(wb.listIssues()[0]!.command, undefined)
  wb.deleteIssue(issue.id)
  assert.equal(existsSync(wb.uploadPath(att)), false)
})

test('awaiting.user hands the card to review while the turn is still open; a later turn end keeps it there', async () => {
  const { wb, driver } = setup()
  const { issue, run } = await wb.startWork({ item: bug })
  driver.emit({ type: 'awaiting.user', runId: run.id, reason: '计划已提交' })
  assert.equal(wb.listIssues()[0]!.status, 'in_review')
  assert.equal(wb.listIssues()[0]!.note, '计划已提交')
  assert.equal(wb.listRuns()[0]!.status, 'running')
  driver.emit({ type: 'turn.completed', runId: run.id, status: 'completed' })
  assert.equal(wb.listIssues()[0]!.status, 'in_review')
  assert.equal(wb.listIssues()[0]!.note, undefined)
  assert.equal(wb.listRuns()[0]!.status, 'completed')
  wb.setStatus(issue.id, 'blocked') // a human moved it; a stray event must not change it
  driver.emit({ type: 'awaiting.user', runId: run.id, reason: 'x' })
  assert.equal(wb.listIssues()[0]!.status, 'blocked')
})

test('@ file mentions: fuzzy search inside the project, and mentioned files are listed in the prompt', async () => {
  const { wb, driver } = setup()
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  assert.deepEqual(wb.searchFiles(project.id, 'pcb').slice(0, 1), ['src/pay-callback.js']) // scattered letters
  assert.equal(wb.searchFiles(project.id, 'ledger')[0], 'src/ledger.js') // name hit first
  assert.ok(wb.searchFiles(project.id, '').length >= 4) // empty query lists files, shallow first
  assert.deepEqual(wb.searchFiles(project.id, 'zzzz-nope'), [])
  assert.throws(() => wb.searchFiles('prj_missing', 'x'), /请先选择项目/)

  const issue = wb.createIssue({
    title: '引用文件', projectId: project.id,
    description: '看 @src/pay-callback.js，还有 @test/pay-callback.test.js。别碰 @../../etc/passwd 和 @src/missing.js，也别重复 @src/pay-callback.js',
  })
  await wb.startIssue(issue.id)
  const prompt = driver.started[0]!.prompt
  assert.match(prompt, /## 引用的项目文件.*\n- src\/pay-callback\.js\n- test\/pay-callback\.test\.js\n/)
  const section = prompt.slice(prompt.indexOf('## 引用的项目文件'))
  assert.doesNotMatch(section, /passwd|missing/) // escapes and non-existent files are not listed
  assert.equal((prompt.match(/^- src\/pay-callback\.js$/gm) ?? []).length, 1)
})

test('task chain: next card, no loops, hand-over summary in the next prompt, delete clears links', async () => {
  const { wb, driver } = setup()
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  const a = wb.createIssue({ title: '先做 A', projectId: project.id })
  const b = wb.createFollowUp(a.id, { title: '再做 B' })
  assert.equal(wb.listIssues().find((i) => i.id === a.id)!.nextId, b.id)
  assert.deepEqual([b.projectId, b.agentId, b.status], [project.id, a.agentId, 'todo']) // follow-up inherits project & agent
  assert.match(b.description, /承接 WB-1「先做 A」/)
  assert.throws(() => wb.setNext(b.id, a.id), /环/)
  assert.throws(() => wb.setNext(a.id, a.id), /环/)
  const c = wb.createIssue({ title: 'C' })
  wb.setNext(b.id, c.id)
  assert.throws(() => wb.setNext(c.id, a.id), /环/) // a -> b -> c -> a

  const { run } = await wb.startIssue(a.id)
  driver.emit({ type: 'turn.completed', runId: run.id, status: 'completed', finalText: '已把回调幂等做完，改了 src/pay-callback.js' })
  await wb.startIssue(b.id)
  assert.match(driver.started[1]!.prompt, /## 前置任务 WB-1 先做 A\n.*\n已把回调幂等做完/)

  wb.deleteIssue(b.id)
  assert.equal(wb.listIssues().find((i) => i.id === a.id)!.nextId, undefined)
})

test('archive: hides cards and to-do rows, restores them, refuses a running card; archive all done', async () => {
  const { wb, driver } = setup()
  const { issue, run } = await wb.startWork({ item: bug })
  assert.throws(() => wb.archiveIssue(issue.id, true), /正在进行中/)
  driver.emit({ type: 'turn.completed', runId: run.id, status: 'completed' })
  const m = wb.createIssue({ title: '手工' })
  wb.setStatus(issue.id, 'done'); wb.setStatus(m.id, 'done')
  assert.equal(wb.archiveDone(), 2)
  assert.equal(wb.archiveDone(), 0)
  let t = await wb.listTodos()
  assert.equal(t.items.find((i) => i.ref === 'BUG-4821')!.archived, true)
  assert.equal(t.items.find((i) => i.ref === m.key)!.archived, true)
  wb.archiveTodo('zentao', 'BUG-4821', false)
  t = await wb.listTodos()
  assert.equal(t.items.find((i) => i.ref === 'BUG-4821')!.archived, false)
  // a connector row with no card is hidden locally and can be brought back
  wb.archiveTodo('gitlab', '!11290', true)
  assert.equal((await wb.listTodos()).items.find((i) => i.ref === '!11290')!.archived, true)
  wb.archiveTodo('gitlab', '!11290', false)
  assert.equal((await wb.listTodos()).items.find((i) => i.ref === '!11290')!.archived, false)
  assert.deepEqual(wb.store.data.hiddenTodos, [])
})

test('Sparkin time sheet: only finished cards, once each, hours checked, entry remembered on the card', async () => {
  const { wb } = setup()
  const info = await wb.sparkinInfo()
  assert.equal(info.mode, 'demo')
  const proj = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  assert.equal(proj.sparkinProjectId, 'SP-PAY')
  const tasks = info.tasks['SP-PAY']!
  const fix = tasks.find((t) => t.name === '缺陷修复')!
  assert.equal(wb.suggestSparkinTask({ sourceRef: { source: 'zentao', ref: 'BUG-4821' }, title: 'x' }, tasks)!.id, fix.id)
  assert.equal(wb.suggestSparkinTask({ sourceRef: { source: 'gitlab', ref: '!1' }, title: 'x' }, tasks)!.name, '代码评审')

  const a = wb.createIssue({ title: 'a', projectId: proj.id, status: 'todo' })
  const b = wb.createIssue({ title: 'b', projectId: proj.id, status: 'todo' })
  wb.setStatus(a.id, 'done')
  const r = await wb.reportTimesheet({ date: '2026-10-24', entries: [
    { issueId: a.id, hours: 2.5, taskId: fix.id },
    { issueId: b.id, hours: 1, taskId: fix.id }, // not done
    { issueId: 'iss_nope', hours: 1, taskId: fix.id },
  ] })
  assert.deepEqual(r.map((x) => x.ok), [true, false, false])
  assert.match(r[1]!.error!, /还没有完成/)
  const ts = wb.listIssues().find((i) => i.id === a.id)!.timesheet!
  assert.deepEqual([ts.hours, ts.date, ts.sparkinTaskName, ts.demo], [2.5, '2026-10-24', '缺陷修复', true])
  const again = await wb.reportTimesheet({ date: '2026-10-24', entries: [{ issueId: a.id, hours: 1, taskId: fix.id }] })
  assert.match(again[0]!.error!, /已经填报过 2.5h/)
  wb.setStatus(b.id, 'done')
  const bad = await wb.reportTimesheet({ date: '2026-10-24', entries: [{ issueId: b.id, hours: 30, taskId: fix.id }, { issueId: b.id, hours: 1, taskId: 'nope' }] })
  assert.deepEqual(bad.map((x) => x.ok), [false, false])
  await assert.rejects(() => wb.reportTimesheet({ date: 'tomorrow', entries: [] }), /工作日期/)
})

const titles = (wb: Workbench, status: string) => wb.listIssues().filter((i) => i.status === status).sort((a, b) => a.order! - b.order!).map((i) => i.title)

test('ordering: reorder inside a column, move across columns, entering a column goes to the end, legacy cards get positions', async () => {
  const { wb, dir, driver } = setup()
  const [a, b, c] = ['A', 'B', 'C'].map((t) => wb.createIssue({ title: t, status: 'todo' }))
  assert.deepEqual(titles(wb, 'todo'), ['A', 'B', 'C']) // new cards queue at the bottom
  wb.moveIssue(c!.id, 'todo', a!.id)
  assert.deepEqual(titles(wb, 'todo'), ['C', 'A', 'B'])
  wb.moveIssue(c!.id, 'todo') // no target = to the end
  assert.deepEqual(titles(wb, 'todo'), ['A', 'B', 'C'])
  wb.moveIssue(a!.id, 'todo', a!.id) // dropping onto itself changes nothing
  assert.deepEqual(titles(wb, 'todo'), ['A', 'B', 'C'])
  wb.moveIssue(b!.id, 'blocked')
  assert.deepEqual([titles(wb, 'todo'), titles(wb, 'blocked')], [['A', 'C'], ['B']])
  assert.throws(() => wb.moveIssue(a!.id, 'done', undefined, 'system'), /只能由人/)

  // finishing a run puts the card at the bottom of 待审核
  const p = wb.listProjects()[0]!
  const x = wb.createIssue({ title: 'X', projectId: p.id, status: 'todo' })
  const r = await wb.startIssue(x.id)
  driver.emit({ type: 'turn.completed', runId: r.run.id, status: 'completed' })
  wb.moveIssue(a!.id, 'in_review')
  assert.deepEqual(titles(wb, 'in_review'), ['X', 'A'])

  // cards saved before ordering existed get positions by age
  const file = join(dir, 'workbench.json')
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  for (const i of raw.issues) delete i.order
  writeFileSync(file, JSON.stringify(raw))
  const again = new Workbench({ store: new Store(file), driver, creds: async () => undefined })
  assert.ok(again.listIssues().every((i) => typeof i.order === 'number'))
  assert.deepEqual(titles(again, 'in_review'), ['A', 'X']) // by age: A was created before X
})

test('auto-run: 待办 top to bottom, one agent at a time, follows the order, skips what cannot run', async () => {
  const { wb, driver } = setup()
  const p = wb.listProjects().find((x) => x.name.endsWith('payment-core'))!
  const mk = (title: string, o: object = {}) => wb.createIssue({ title, projectId: p.id, status: 'todo', ...o })
  const a = mk('A'), b = mk('B'), c = mk('C')
  const noProject = wb.createIssue({ title: 'N', status: 'todo' })
  const planned = mk('P', { status: 'backlog' })
  const archived = mk('Z'); wb.archiveIssue(archived.id, true)
  wb.moveIssue(c.id, 'todo', a.id) // queue: C A B N

  await wb.tick() // manual mode: nothing starts by itself
  assert.equal(driver.started.length, 0)
  assert.equal(wb.workingCount(), 0)

  wb.setAutoRun(true)
  await wb.tick()
  assert.deepEqual(driver.started.map((s) => s.title.split(' ')[1]), ['C']) // top of the queue, only one
  assert.equal(wb.workingCount(), 1)
  assert.equal(wb.listIssues().find((i) => i.id === noProject.id)!.note, '自动运行已跳过：请先选择项目')

  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' })
  await wb.tick()
  assert.deepEqual(driver.started.map((s) => s.title.split(' ')[1]), ['C', 'A'])
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'failed', error: 'boom' }) // a failure doesn't stop the queue
  await wb.tick()
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' })
  await wb.tick()
  assert.deepEqual(driver.started.map((s) => s.title.split(' ')[1]), ['C', 'A', 'B'])
  assert.deepEqual([titles(wb, 'blocked'), titles(wb, 'backlog')], [['A'], ['P']])
  assert.equal(wb.listIssues().find((i) => i.id === planned.id)!.status, 'backlog') // 待规划 is never auto-run
  assert.equal(driver.started.length, 3) // N (no project) and the archived card were not started

  // a card dropped into 待办 while auto-run is on is picked up
  const d = mk('D', { status: 'backlog' })
  wb.moveIssue(d.id, 'todo'); await wb.tick()
  assert.equal(driver.started.length, 4)

  // a start that throws is parked as blocked, not retried forever
  wb.updateIssue(a.id, { agentId: 'gone' })
  wb.moveIssue(a.id, 'todo'); driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' }); await wb.tick()
  assert.equal(wb.listIssues().find((i) => i.id === a.id)!.status, 'blocked')
  assert.match(wb.listIssues().find((i) => i.id === a.id)!.note!, /自动运行启动失败/)

  wb.setAutoRun(false)
  mk('E'); await wb.tick()
  assert.equal(driver.started.length, 4)
})

test('编辑 a source item: local backlog card overrides the source copy, can still be started, never duplicates', async () => {
  const { driver, wb } = setup()
  const card = wb.adoptTodo({ item: bug })
  assert.equal(card.status, 'backlog')
  assert.equal(card.projectId, wb.resolveProject(bug)?.id)
  wb.updateIssue(card.id, { title: '改过的标题', priority: 'P0', acceptance: ['新验收'] })
  const row = (await wb.listTodos()).items.find((i) => i.source === bug.source && i.ref === bug.ref)!
  assert.equal(row.title, '改过的标题')
  assert.equal(row.priority, 'P0')
  assert.deepEqual(row.acceptance, ['新验收'])
  assert.equal(row.issueStatus, 'backlog')
  assert.throws(() => wb.adoptTodo({ item: bug }), /已经开过卡片/)
  const started = await wb.startWork({ item: bug }) // starting the item starts that card, it does not make a second one
  assert.equal(started.issue.id, card.id)
  assert.equal(wb.listIssues().filter((i) => i.sourceRef?.ref === bug.ref).length, 1)
  assert.match(driver.started[0]!.prompt, /改过的标题/)
  await assert.rejects(wb.startWork({ item: bug }), /已经开过卡片/) // once it is under way, starting again is refused
})
