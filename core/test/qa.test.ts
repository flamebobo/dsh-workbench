// Regression tests for problems found in the full QA pass (docs/qa/README.md lists them by number).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { demoZentao } from '../fixtures/demo.ts'
import { Store, Workbench } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

function setup(creds: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-qa-'))
  const driver = new FakeDriver()
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver, creds: async (n) => creds[n], fetch: fetchImpl })
  wb.seedDemoProjects(join(dir, 'repos'))
  wb.saveSettings({ isolateByDefault: false })
  return { dir, driver, wb }
}
const bug = demoZentao[0]!
const zentaoCreds = { WORKBENCH_ZENTAO_URL: 'http://z.test', WORKBENCH_ZENTAO_ACCOUNT: 'a', WORKBENCH_ZENTAO_PASSWORD: 'p' }

test('Q3 a double click on 回写禅道 resolves the bug once, not twice', async () => {
  let posts = 0
  const f = (async (u: string) => {
    if (u.endsWith('/tokens')) return Response.json({ token: 't' })
    if (u.includes('/resolve')) { posts++; await new Promise((r) => setTimeout(r, 40)) }
    return Response.json({})
  }) as typeof fetch
  const { wb } = setup(zentaoCreds, f)
  const { issue } = await wb.startWork({ item: bug })
  wb.setStatus(issue.id, 'done')
  const r = await Promise.allSettled([wb.writeBackZentao(issue.id, 'x'), wb.writeBackZentao(issue.id, 'x')])
  assert.equal(posts, 1)
  assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected'])
  assert.ok(wb.listIssues().find((i) => i.id === issue.id)!.writeBack)
})

test('Q4 a double click on 填报工时 books the hours once', async () => {
  const { wb } = setup()
  const { issue } = await wb.startWork({ item: bug })
  wb.setStatus(issue.id, 'done')
  let submits = 0
  const orig = wb.sparkin.submit.bind(wb.sparkin)
  wb.sparkin.submit = async (x) => { submits++; await new Promise((r) => setTimeout(r, 30)); return orig(x) }
  const task = Object.values((await wb.sparkinInfo()).tasks).flat()[0]!
  const entry = { issueId: issue.id, hours: 1, taskId: task.id }
  const [a, b] = await Promise.all([wb.reportTimesheet({ date: '2026-10-24', entries: [entry] }), wb.reportTimesheet({ date: '2026-10-24', entries: [entry] })])
  assert.equal(submits, 1)
  assert.deepEqual([a[0]!.ok, b[0]!.ok].sort(), [false, true])
})

test('Q3b a double click on 提交 MR pushes and opens one merge request', async () => {
  let posts = 0
  const f = (async (_u: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts++; await new Promise((r) => setTimeout(r, 40)) }
    return Response.json({ web_url: 'https://gitlab.test/mr/7', iid: 7 }, { status: 201 })
  }) as typeof fetch
  const { wb, dir, driver } = setup({ WORKBENCH_GITLAB_URL: 'https://gitlab.test', WORKBENCH_GITLAB_TOKEN: 'tok' }, f)
  wb.saveSettings({ isolateByDefault: true })
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  git(dir, 'init', '-q', '--bare', join(dir, 'origin.git')); git(project.cwd, 'remote', 'add', 'origin', join(dir, 'origin.git'))
  wb.saveProject({ ...project, gitlabProjectId: 101 })
  const i = wb.createIssue({ title: 'x', projectId: project.id, status: 'todo' })
  await wb.startIssue(i.id)
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' })
  writeFileSync(join(wb.listIssues()[0]!.worktree!, 'a.txt'), 'a')
  const r = await Promise.allSettled([wb.submitMergeRequest(i.id), wb.submitMergeRequest(i.id)])
  assert.equal(posts, 1)
  assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected'])
})

/** Zentao stand-in: products listed in `bad` answer 403, product 12 has one bug assigned to `a`. */
const zentaoFetch = (bad: number[]) => (async (u: string) => {
  if (u.endsWith('/tokens')) return Response.json({ token: 't' })
  const m = /products\/(\d+)\/bugs/.exec(u)
  if (m) return bad.includes(Number(m[1])) ? new Response('no', { status: 403 }) : Response.json({ bugs: Number(m[1]) === 12 ? [{ id: 9, title: '真实缺陷', pri: 2, status: 'active', assignedTo: 'a', steps: '' }] : [] })
  return Response.json({ executions: [], tasks: [] })
}) as typeof fetch

test('Q1 one Zentao product the account cannot read does not turn the whole source into demo data', async () => {
  const { wb } = setup(zentaoCreds, zentaoFetch([5]))
  const t = await wb.listTodos()
  assert.equal(t.sources.zentao.mode, 'live')
  assert.match(t.sources.zentao.error!, /产品 5/) // said out loud, not hidden
  assert.deepEqual(t.items.filter((i) => i.source === 'zentao').map((i) => i.ref), ['BUG-9'])
})

test('Q1b a source that fell back to demo data does not put the demo to-dos on the board as real cards', async () => {
  const { wb } = setup(zentaoCreds, zentaoFetch([12, 5, 8, 9]))
  const t = await wb.listTodos()
  assert.equal(t.sources.zentao.mode, 'fallback')
  assert.ok(t.items.some((i) => i.ref === 'BUG-4821')) // still shown, with the red banner
  assert.equal(wb.listIssues().filter((i) => i.sourceRef?.source === 'zentao').length, 0)
})

test('Q1c a card is not flagged "gone from the source" while part of that source could not be read', async () => {
  const bad: number[] = []
  const { wb } = setup(zentaoCreds, zentaoFetch(bad))
  await wb.listTodos()
  const card = wb.listIssues().find((i) => i.sourceRef?.ref === 'BUG-9')!
  assert.ok(card)
  bad.push(12) // product 12 stops answering; BUG-9 is not in the list this time, but only because the read failed
  bad.push(5)
  await wb.listTodos()
  assert.equal(wb.listIssues().find((i) => i.id === card.id)!.note, undefined)
})

test('Q6 un-archiving a card on the board also brings its to-do back (they must agree)', async () => {
  const { wb } = setup()
  await wb.listTodos()
  const card = wb.listIssues().find((i) => i.sourceRef?.ref === 'BUG-4821')!
  wb.archiveTodo('zentao', 'BUG-4821', true)
  assert.equal((await wb.listTodos()).items.find((i) => i.ref === 'BUG-4821')!.archived, true)
  wb.archiveIssue(card.id, false) // 「取消归档」 on the card
  assert.equal(wb.listIssues().find((i) => i.id === card.id)!.archivedAt, undefined)
  assert.equal((await wb.listTodos()).items.find((i) => i.ref === 'BUG-4821')!.archived, false)
})

test('Q7 a test run that was in flight when the Host restarted is closed as failed, so it can be run again', async () => {
  const { wb, dir } = setup()
  const { issue } = await wb.startWork({ item: bug })
  wb.store.update((d) => { d.issues.find((x) => x.id === issue.id)!.checks = [{ id: 'c1', cmd: 'node --test', state: 'running', output: '', at: new Date().toISOString() }] })
  const wb2 = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver: new FakeDriver(), creds: async () => undefined })
  const c = wb2.listIssues().find((x) => x.id === issue.id)!.checks![0]!
  assert.equal(c.state, 'failed')
  assert.match(c.output, /宿主重启/)
  wb2.saveProject({ ...wb2.listProjects().find((p) => p.name.endsWith('payment-core'))!, testCmd: 'node -e "0"' })
  await wb2.runChecks(issue.id) // not refused with 「测试正在运行」
})

