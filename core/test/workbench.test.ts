import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync } from 'node:fs'
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
