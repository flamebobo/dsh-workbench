import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, Workbench } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

function setup(demoMode: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-demo-'))
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver: new FakeDriver(), creds: async () => undefined, demoRepoDir: join(dir, 'demo-repos') })
  wb.saveSettings({ demoMode, isolateByDefault: false })
  return { dir, wb }
}

test('demo mode is on by default; off: nothing unconfigured shows, no demo builds, board and projects start empty', async () => {
  const on = setup(true).wb
  assert.equal(on.settings().demoMode, true)
  assert.ok((await on.listTodos()).items.length > 0)

  const { wb } = setup(false)
  const t = await wb.listTodos()
  assert.deepEqual(t.items, [])
  assert.deepEqual(Object.values(t.sources).map((s) => s.mode), ['none', 'none', 'none', 'none'])
  assert.deepEqual(wb.listIssues(), []) // nothing synced to the board
  assert.deepEqual(wb.listProjects(), [])
  assert.deepEqual(await wb.jenkinsJobs(), { jobs: [], mode: 'none' })
  const card = wb.createIssue({ title: '手工任务' })
  const b = await wb.triggerBuild({ job: 'x', issueIds: [card.id] })
  assert.equal(b.state, 'error') // not simulated: Jenkins is not connected
  assert.match(b.error!, /Jenkins 未配置/)
  assert.equal((await wb.listTodos()).items.length, 1) // a manual task still shows
})

test('turning demo mode on creates the demo projects next to real ones; turning it off and clearing keeps what is not demo', async () => {
  const { dir, wb } = setup(false)
  const real = join(dir, 'real-repo'); mkdirSync(real)
  wb.saveProject({ name: '我的项目', cwd: real })
  wb.createIssue({ title: '我自己的卡片', projectId: wb.listProjects()[0]!.id })
  wb.saveSettings({ demoMode: true })
  assert.equal(wb.listProjects().length, 8) // 7 demo + mine
  assert.ok(existsSync(join(dir, 'demo-repos/payment-core')))
  await wb.listTodos() // demo to-dos land on the board as demo cards
  assert.ok(wb.listIssues().some((i) => i.demo))
  wb.saveSettings({ demoMode: false })
  assert.ok(wb.listIssues().some((i) => i.demo)) // switching off does not delete anything by itself
  const r = wb.removeDemoData()
  assert.ok(r.cards > 0 && r.projects === 7)
  assert.deepEqual(wb.listProjects().map((p) => p.name), ['我的项目'])
  assert.deepEqual(wb.listIssues().map((i) => i.title), ['我自己的卡片'])
})

test('scanRepos: the host\'s own project directories are listed first-hand, only if they are git repositories', async () => {
  const { dir, wb } = setup(false)
  const repo = join(dir, 'codex-proj'); mkdirSync(join(repo, '.git'), { recursive: true })
  const plain = join(dir, 'scratch'); mkdirSync(plain)
  const r = await wb.scanRepos([], [repo, plain, join(dir, 'gone')])
  assert.deepEqual(r.repos.map((x) => x.path), [repo])
})
