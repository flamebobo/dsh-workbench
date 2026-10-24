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
