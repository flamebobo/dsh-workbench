import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
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
  assert.equal(req.profile.presetId, 'fullstack')
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
  assert.deepEqual(Object.values(t.sources).map((s) => s.mode), ['demo', 'demo', 'demo'])
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
