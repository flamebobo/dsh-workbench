import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, Workbench } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

function setup(over: { creds?: Record<string, string>; fetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-rev-'))
  const driver = new FakeDriver()
  const creds = over.creds ?? {}
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver, creds: async (n) => creds[n], fetch: over.fetch as typeof fetch })
  wb.seedDemoProjects(join(dir, 'repos'))
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  return { dir, driver, wb, project, repo: project.cwd }
}
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)) } }

test('settings: defaults, clamping, validation, and the values actually being used', async () => {
  const { wb } = setup()
  assert.deepEqual([wb.settings().autoRunConcurrency, wb.settings().todoRefreshSeconds, wb.settings().isolateByDefault], [1, 60, true])
  const s = wb.saveSettings({ autoRunConcurrency: 99, defaultHours: 0.7, todoRefreshSeconds: 1, branchPrefix: '../evil', maxUploadMB: 1 })
  assert.deepEqual([s.autoRunConcurrency, s.defaultHours, s.todoRefreshSeconds, s.branchPrefix], [5, 0.5, 15, 'wb/']) // clamped; a bad ref prefix falls back
  assert.throws(() => wb.saveSettings({ defaultAgents: { gitlab: 'nope' } as never }), /默认智能体「nope」/)
  assert.throws(() => wb.saveUpload({ name: 'big.bin', data: new Uint8Array(2 * 1024 * 1024) }), /超过 1 MB/) // maxUploadMB is honoured
  assert.equal(wb.saveSettings({ defaultAgents: { gitlab: 'tester' } as never }).defaultAgents.gitlab, 'tester')
  assert.equal(wb.settings().defaultAgents.zentao, 'fullstack') // partial updates keep the rest
})

test('agent: reasoning effort and explicit skills reach the driver and the first message', async () => {
  const { wb, driver, project } = setup()
  wb.saveSettings({ isolateByDefault: false })
  const a = wb.saveAgent({ ...wb.agent('fullstack'), effort: 'high', skills: ['office-docx', 'find-skills', 'office-docx', 'Bad Name'] })
  assert.deepEqual(a.skills, ['office-docx', 'find-skills']) // de-duplicated, invalid names dropped
  const i = wb.createIssue({ title: 't', projectId: project.id, status: 'todo' })
  await wb.startIssue(i.id)
  const req = driver.started[0]!
  assert.equal(req.profile.effort, 'high')
  assert.deepEqual(req.profile.skills, ['office-docx', 'find-skills'])
  assert.match(req.prompt, /## 指定技能\n请按这些技能的说明工作：\/office-docx \/find-skills/)
  wb.saveAgent({ ...wb.agent('fullstack'), effort: '', skills: [] })
  assert.equal(wb.agent('fullstack').effort, undefined)
})

test('isolation: each task gets its own branch + worktree; reuse, opt-out, non-git, and cleanup that never loses work', async () => {
  const { wb, driver, project, repo, dir } = setup()
  const main = sh(repo, 'rev-parse', 'main')
  const a = wb.createIssue({ title: '修复回调！', projectId: project.id, status: 'todo' })
  await wb.startIssue(a.id)
  const ia = wb.listIssues().find((i) => i.id === a.id)!
  assert.equal(ia.branch, 'wb/wb-1') // non-ascii title leaves only the key
  assert.equal(ia.worktree, join(dir, 'worktrees', project.id, 'WB-1'))
  assert.equal(driver.started[0]!.cwd, ia.worktree) // the agent works there, not in the project directory
  assert.deepEqual([ia.baseBranch, ia.baseSha], ['main', main])
  assert.equal(sh(ia.worktree!, 'rev-parse', '--abbrev-ref', 'HEAD'), 'wb/wb-1')
  assert.equal(sh(repo, 'status', '--porcelain'), '') // the main checkout is untouched

  // a restart of the same card reuses the same checkout
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'failed', error: 'x' })
  await wb.startIssue(a.id)
  assert.equal(driver.started[1]!.cwd, ia.worktree)

  // two tasks never share a checkout
  const b = wb.createIssue({ title: 'fix callback idempotency', projectId: project.id, status: 'todo' })
  await wb.startIssue(b.id)
  const ib = wb.listIssues().find((i) => i.id === b.id)!
  assert.equal(ib.branch, 'wb/wb-2-fix-callback-idempotency')
  assert.notEqual(ib.worktree, ia.worktree)

  // opt-out and non-git projects run in place
  const plain = wb.saveProject({ name: 'plain', cwd: join(dir, 'plain') }); mkdirSync(plain.cwd)
  const c = wb.createIssue({ title: 'c', projectId: plain.id, status: 'todo' }); await wb.startIssue(c.id)
  assert.equal(driver.started.at(-1)!.cwd, plain.cwd)
  wb.saveProject({ ...project, isolate: false })
  const d = wb.createIssue({ title: 'd', projectId: project.id, status: 'todo' }); await wb.startIssue(d.id)
  assert.equal(driver.started.at(-1)!.cwd, repo)
  assert.equal(wb.listIssues().find((i) => i.id === d.id)!.worktree, undefined)
  wb.saveProject({ ...project, isolate: undefined })

  // deleting removes a clean checkout, but a checkout with uncommitted work is kept
  writeFileSync(join(ib.worktree!, 'precious.txt'), 'unsaved')
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().find((r) => r.issueId === b.id)!.id, status: 'completed' })
  wb.deleteIssue(b.id); await new Promise((r) => setTimeout(r, 400))
  assert.ok(existsSync(join(ib.worktree!, 'precious.txt')))
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().find((r) => r.issueId === a.id)!.id, status: 'completed' })
  wb.deleteIssue(a.id); await until(() => !existsSync(ia.worktree!))
  assert.ok(sh(repo, 'branch', '--list', 'wb/wb-1').includes('wb/wb-1')) // the branch itself stays
})

test('isolation: a branch that cannot be created blocks the card with the reason instead of running in the main checkout', async () => {
  const { wb, driver, project, repo } = setup()
  sh(repo, 'branch', 'wb/wb-1-x'); sh(repo, 'checkout', '-q', 'wb/wb-1-x') // the branch is checked out in the main worktree, so a second checkout is refused
  const i = wb.createIssue({ title: 'x', projectId: project.id, status: 'todo' })
  await assert.rejects(() => wb.startIssue(i.id), /创建任务分支「wb\/wb-1-x」失败/)
  assert.equal(driver.started.length, 0)
  assert.equal(wb.listIssues()[0]!.status, 'blocked')
})

test('changes: what the agent did on the task branch, committed or not, including new files', async () => {
  const { wb, project } = setup()
  const i = wb.createIssue({ title: 'review me', projectId: project.id, status: 'todo' })
  await wb.startIssue(i.id)
  const wt = wb.listIssues()[0]!.worktree!
  writeFileSync(join(wt, 'README.md'), readFileSync(join(wt, 'README.md'), 'utf8') + '\n新增一行\n')
  writeFileSync(join(wt, 'src', 'new-file.js'), 'export const x = 1\n')
  sh(wt, 'add', 'README.md'); sh(wt, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-qm', 'readme') // one change committed, one only on disk
  writeFileSync(join(wt, 'src', 'ledger.js'), '// changed\n')
  const r = await wb.issueChanges(i.id)
  assert.equal(r.isolated, true)
  assert.deepEqual(r.files.map((f) => [f.path, f.status]).sort(), [['README.md', 'M'], ['src/ledger.js', 'M'], ['src/new-file.js', 'A']])
  assert.match(r.files.find((f) => f.path === 'README.md')!.patch, /\+新增一行/)
  assert.equal(r.files.find((f) => f.path === 'src/new-file.js')!.additions, 1)
  await assert.rejects(() => wb.issueChanges('iss_nope'), /不存在/)
})

test('checks: the project test command runs in the task checkout, in the background, and reports pass/fail', async () => {
  const { wb, project, driver } = setup()
  const i = wb.createIssue({ title: 't', projectId: project.id, status: 'todo' })
  await wb.startIssue(i.id)
  wb.saveProject({ ...project, testCmd: 'node -e "console.log(process.cwd()); process.exit(0)"' })
  const first = await wb.runChecks(i.id)
  assert.equal(first.state, 'running')
  await assert.rejects(() => wb.runChecks(i.id), /正在运行/)
  await until(() => wb.listIssues()[0]!.checks![0]!.state !== 'running')
  const done = wb.listIssues()[0]!.checks![0]!
  assert.equal(done.state, 'passed')
  assert.ok(done.output.includes(wb.listIssues()[0]!.worktree!.replace(/^\/private/, ''))) // ran in the worktree

  wb.saveProject({ ...project, testCmd: 'node -e "console.error(\'boom\'); process.exit(3)"' })
  await wb.runChecks(i.id)
  await until(() => wb.listIssues()[0]!.checks!.at(-1)!.state !== 'running')
  const bad = wb.listIssues()[0]!
  assert.deepEqual([bad.checks!.at(-1)!.state, bad.checks!.at(-1)!.code], ['failed', 3])
  assert.match(bad.checks!.at(-1)!.output, /boom/)
  assert.equal(bad.note, '测试未通过（退出码 3）')

  // finishing a run triggers the tests by itself (the setting is on by default)
  wb.saveProject({ ...project, testCmd: 'node -e "process.exit(0)"' })
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' })
  await until(() => wb.listIssues()[0]!.checks!.length === 3 && wb.listIssues()[0]!.checks!.at(-1)!.state === 'passed')
  wb.saveProject({ ...project, testCmd: '' })
  await assert.rejects(() => wb.runChecks(i.id), /还没有配置测试命令/)
})

test('merge request: commit, push the task branch to origin, open the MR on GitLab with the task context', async () => {
  const calls: { url: string; body?: any; headers?: any }[] = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers })
    return Response.json({ web_url: 'https://gitlab.test/pay/-/merge_requests/7', iid: 7 }, { status: 201 })
  }
  const creds = { WORKBENCH_GITLAB_URL: 'https://gitlab.test/', WORKBENCH_GITLAB_TOKEN: 'glpat' }
  const { wb, project, repo, dir, driver } = setup({ creds, fetch: fetchImpl })
  const origin = join(dir, 'origin.git')
  sh(dir, 'init', '-q', '--bare', origin); sh(repo, 'remote', 'add', 'origin', origin)
  wb.saveProject({ ...project, gitlabProjectId: 101 })

  const i = wb.createIssue({ title: '支付回调幂等修复', description: '重复回调不重复入账', acceptance: ['不重复入账'], projectId: project.id, status: 'todo' })
  await assert.rejects(() => wb.submitMergeRequest(i.id), /只有在独立任务分支上/) // never started
  await wb.startIssue(i.id)
  await assert.rejects(() => wb.submitMergeRequest(i.id), /正在进行中/)
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed', finalText: '已按幂等键修复并补了测试' })
  await assert.rejects(() => wb.submitMergeRequest(i.id), /没有任何改动/) // an empty branch is not worth an MR

  const wt = wb.listIssues()[0]!.worktree!
  writeFileSync(join(wt, 'src', 'pay-callback.js'), '// fixed\n')
  const issue = await wb.submitMergeRequest(i.id)
  assert.deepEqual([issue.mr!.iid, issue.mr!.url], [7, 'https://gitlab.test/pay/-/merge_requests/7'])
  assert.ok(sh(origin, 'branch', '--list', 'wb/wb-1').includes('wb/wb-1')) // pushed
  assert.match(sh(wt, 'log', '-1', '--format=%s'), /^WB-1 支付回调幂等修复/) // committed with the task's name
  assert.equal(sh(wt, 'status', '--porcelain'), '')

  const post = calls.find((c) => c.url.endsWith('/api/v4/projects/101/merge_requests'))!
  assert.equal(post.headers['PRIVATE-TOKEN'], 'glpat')
  assert.deepEqual([post.body.source_branch, post.body.target_branch, post.body.title], ['wb/wb-1', 'main', 'WB-1 支付回调幂等修复'])
  assert.match(post.body.description, /## 背景\n重复回调不重复入账/)
  assert.match(post.body.description, /- \[ \] 不重复入账/)
  assert.match(post.body.description, /## 智能体总结\n已按幂等键修复并补了测试/)
  await assert.rejects(() => wb.submitMergeRequest(i.id), /已经提交过合并请求/)
})

test('merge request: refusals and an already-open MR are handled, and the token never goes into git', async () => {
  let mode: 'exists' | 'down' = 'exists'
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return mode === 'exists' ? new Response('{"message":["Another open merge request already exists for this source branch"]}', { status: 409 }) : new Response('boom', { status: 500 })
    return Response.json([{ web_url: 'https://gitlab.test/pay/-/merge_requests/3', iid: 3 }])
  }
  const { wb, project, repo, dir, driver } = setup({ creds: {}, fetch: fetchImpl })
  const origin = join(dir, 'origin.git'); sh(dir, 'init', '-q', '--bare', origin)
  const i = wb.createIssue({ title: 'x', projectId: project.id, status: 'todo' })
  await wb.startIssue(i.id)
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' })
  writeFileSync(join(wb.listIssues()[0]!.worktree!, 'a.txt'), 'a')
  await assert.rejects(() => wb.submitMergeRequest(i.id), /GitLab 项目 ID/)
  wb.saveProject({ ...project, gitlabProjectId: 101 })
  await assert.rejects(() => wb.submitMergeRequest(i.id), /没有 origin 远程/)
  sh(repo, 'remote', 'add', 'origin', origin)
  await assert.rejects(() => wb.submitMergeRequest(i.id), /GitLab 未配置/)
  assert.equal(sh(origin, 'branch', '--list').trim(), '') // nothing was pushed before every precondition held

  const w2 = setup({ creds: { WORKBENCH_GITLAB_URL: 'https://gitlab.test', WORKBENCH_GITLAB_TOKEN: 'tok' }, fetch: fetchImpl })
  const o2 = join(w2.dir, 'origin.git'); sh(w2.dir, 'init', '-q', '--bare', o2); sh(w2.repo, 'remote', 'add', 'origin', o2)
  w2.wb.saveProject({ ...w2.project, gitlabProjectId: 101 })
  const j = w2.wb.createIssue({ title: 'y', projectId: w2.project.id, status: 'todo' })
  await w2.wb.startIssue(j.id)
  w2.driver.emit({ type: 'turn.completed', runId: w2.wb.listRuns().at(-1)!.id, status: 'completed' })
  writeFileSync(join(w2.wb.listIssues()[0]!.worktree!, 'b.txt'), 'b')
  const done = await w2.wb.submitMergeRequest(j.id) // 409: reuse the open MR for this branch
  assert.equal(done.mr!.iid, 3)
  assert.ok(!readFileSync(join(w2.repo, '.git', 'config'), 'utf8').includes('tok'))

  mode = 'down'
  const k = w2.wb.createIssue({ title: 'z', projectId: w2.project.id, status: 'todo' })
  await w2.wb.startIssue(k.id)
  w2.driver.emit({ type: 'turn.completed', runId: w2.wb.listRuns().at(-1)!.id, status: 'completed' })
  writeFileSync(join(w2.wb.listIssues().find((x) => x.id === k.id)!.worktree!, 'c.txt'), 'c')
  await assert.rejects(() => w2.wb.submitMergeRequest(k.id), /分支已推送，但GitLab 创建合并请求失败：HTTP 500/)
})
