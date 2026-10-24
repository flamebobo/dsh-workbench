// Regression tests for problems found in the full QA pass (docs/qa/README.md lists them by number).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
const realBug = { ...bug, title: '线上缺陷', description: '来自真实禅道' } // the demo bug's number, a real bug's content
const zentaoCreds = { WORKBENCH_ZENTAO_URL: 'http://z.test', WORKBENCH_ZENTAO_ACCOUNT: 'a', WORKBENCH_ZENTAO_PASSWORD: 'p' }

test('Q3 a double click on 回写禅道 resolves the bug once, not twice', async () => {
  let posts = 0
  const f = (async (u: string) => {
    if (u.endsWith('/tokens')) return Response.json({ token: 't' })
    if (u.includes('/resolve')) { posts++; await new Promise((r) => setTimeout(r, 40)) }
    return Response.json({})
  }) as typeof fetch
  const { wb } = setup(zentaoCreds, f)
  const { issue } = await wb.startWork({ item: realBug })
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

test('Q1b a source whose every read failed shows no rows and puts nothing on the board', async () => {
  const { wb } = setup(zentaoCreds, zentaoFetch([12, 5, 8, 9]))
  const t = await wb.listTodos()
  assert.equal(t.sources.zentao.mode, 'error')
  assert.equal(t.items.filter((i) => i.source === 'zentao').length, 0) // no demo rows standing in for the real list
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

test('Q8 a card whose session is still running cannot be started a second time', async () => {
  const { wb, driver } = setup()
  const { issue } = await wb.startWork({ item: bug })
  wb.moveIssue(issue.id, 'todo') // dragged back while the agent is still working
  await assert.rejects(() => wb.startIssue(issue.id), /会话还在运行/)
  assert.equal(driver.started.length, 1)
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' })
  await wb.startIssue(issue.id) // once the session ended it can be started again
  assert.equal(driver.started.length, 2)
})

test('Q8b nothing can be dragged into 进行中 by hand: it would spin with no session behind it', () => {
  const { wb } = setup()
  const c = wb.createIssue({ title: 'manual', projectId: wb.listProjects()[0]!.id })
  assert.throws(() => wb.moveIssue(c.id, 'in_progress'), /开工/)
})

test('Q9 a Zentao item without a priority is not shown as P0', async () => {
  const { parseBugs, parseTasks } = await import('../src/connectors/zentao.ts')
  const b = parseBugs({ bugs: [{ id: 1, title: 'a', status: 'active', assignedTo: 'me' }, { id: 2, title: 'b', pri: 0, status: 'active', assignedTo: 'me' }, { id: 3, title: 'c', pri: 1, status: 'active', assignedTo: 'me' }, { id: 4, title: 'd', pri: 9, status: 'active', assignedTo: 'me' }] }, 'me', 1, 'http://z')
  assert.deepEqual(b.map((x) => x.priority), ['P2', 'P2', 'P0', 'P3'])
  assert.equal(parseTasks({ tasks: [{ id: 5, name: 't', pri: '', status: 'wait', assignedTo: 'me' }] }, 'me', 1, 'http://z')[0]!.priority, 'P2')
})

test('Q5 a due date that is not a real calendar day is refused', () => {
  const { wb } = setup()
  for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31']) assert.throws(() => wb.createIssue({ title: 't', due: bad }), /截止日期/, bad)
  assert.equal(wb.createIssue({ title: 't', due: '2028-02-29' }).due, '2028-02-29') // a leap day is real
})

test('Q10 a brief Jenkins hiccup while following a build does not end the tracking for good', async () => {
  let down = false
  let clock = Date.parse('2026-10-24T10:00:00Z')
  const f = (async (url: string, init?: RequestInit) => {
    if (down) throw new Error('fetch failed')
    if (url.endsWith('/crumb-issuer/api/json')) return new Response('', { status: 404 })
    if (init?.method === 'POST') return new Response(null, { status: 201, headers: { location: 'https://j/queue/item/7' } })
    if (url.endsWith('/queue/item/7/api/json')) return Response.json({ executable: { number: 8, url: 'https://j/job/x/8/' } })
    return Response.json({ building: false, result: 'SUCCESS', number: 8 })
  }) as typeof fetch
  const dir = mkdtempSync(join(tmpdir(), 'wb-qa-'))
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver: new FakeDriver(), now: () => clock, fetch: f,
    creds: async (n) => ({ WORKBENCH_JENKINS_URL: 'https://j', WORKBENCH_JENKINS_USER: 'u', WORKBENCH_JENKINS_TOKEN: 't' } as Record<string, string>)[n] })
  const a = wb.createIssue({ title: 'a' })
  await wb.triggerBuild({ job: 'x', issueIds: [a.id] })
  down = true
  for (let n = 0; n < 3; n++) { clock += 5000; assert.equal((await wb.refreshBuilds())[0]!.state, 'queued') } // still following it
  down = false
  clock += 5000
  assert.equal((await wb.refreshBuilds())[0]!.state, 'success')
  down = true
  const b = await wb.triggerBuild({ job: 'x', issueIds: [a.id] }).catch(() => undefined) // the trigger itself failing is reported at once, as before
  assert.equal(b?.state, 'error')
})

test('Q11 passing tests alone do not complete a card whose agent changed nothing (it may only have asked a question)', async () => {
  const { wb, driver } = setup()
  wb.saveSettings({ autoDoneOnPass: true })
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  wb.saveProject({ ...project, testCmd: 'true' })
  const i = wb.createIssue({ title: '需要澄清的缺陷', projectId: project.id, status: 'todo' })
  const r = (await wb.startIssue(i.id)).run
  driver.emit({ type: 'turn.completed', runId: r.id, status: 'completed', finalText: '需求不清楚，请补充信息' })
  const until = async (f: () => boolean) => { for (let n = 0; n < 200 && !f(); n++) await new Promise((x) => setTimeout(x, 25)) }
  await until(() => wb.listIssues().find((x) => x.id === i.id)!.checks?.at(-1)?.state === 'passed')
  await new Promise((x) => setTimeout(x, 200))
  const card = wb.listIssues().find((x) => x.id === i.id)!
  assert.equal(card.status, 'in_review')
  assert.match(card.note!, /没有检测到代码改动/)
  // the same card once the agent has really changed something and the tests pass again
  writeFileSync(join(project.cwd, 'fix.txt'), 'fixed')
  await wb.runChecks(i.id)
  await until(() => wb.listIssues().find((x) => x.id === i.id)!.status === 'done')
  assert.equal(wb.listIssues().find((x) => x.id === i.id)!.status, 'done')
})

test('Q12 a mistyped update / report address is refused out loud instead of being silently emptied', () => {
  const { wb } = setup()
  assert.throws(() => wb.saveSettings({ updateCheckUrl: 'update.example.com/latest.json' }), /更新地址必须以 http/)
  assert.throws(() => wb.saveSettings({ statsReportUrl: 'stats.example.com' }), /上报地址必须以 http/)
  assert.equal(wb.settings().updateCheckUrl, '')
  assert.equal(wb.saveSettings({ updateCheckUrl: ' https://u.example.com/latest.json ' }).updateCheckUrl, 'https://u.example.com/latest.json')
  assert.equal(wb.saveSettings({ updateCheckUrl: '' }).updateCheckUrl, '') // empty still means "off"
})

test('Q13 the report task picks the project of the cards it lists, not of cards whose key merely starts the same (WB-1 vs WB-12)', async () => {
  const { wb } = setup()
  const [a, b] = wb.listProjects()
  for (let n = 0; n < 9; n++) wb.createIssue({ title: `填充 ${n}`, projectId: a!.id }) // WB-1 … WB-9: project a, not in the report
  const done = (title: string, projectId: string) => { const i = wb.createIssue({ title, projectId }); wb.setStatus(i.id, 'done'); return i }
  const x = done('b 项目甲', b!.id), y = done('a 项目', a!.id), z = done('b 项目乙', b!.id)
  assert.deepEqual([x.key, y.key, z.key], ['WB-10', 'WB-11', 'WB-12'])
  // the report lists WB-10, WB-11, WB-12: two for project b, one for a. (The text "WB-1x" also contains "WB-1", a card of project a.)
  assert.equal((await wb.createReportTask('week')).projectId, b!.id)
})

test('Q14 starting WB-1 after the data file was reset (old worktree directory still there) does not fail on the leftover directory', async () => {
  const { wb, dir, driver } = setup()
  wb.saveSettings({ isolateByDefault: true })
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  const stale = join(dir, 'worktrees', project.id, 'WB-1') // what an earlier data file left behind
  mkdirSync(stale, { recursive: true }); writeFileSync(join(stale, 'old.txt'), 'leftover from before the reset')
  const i = wb.createIssue({ title: '重置后的第一个任务', projectId: project.id, status: 'todo' })
  assert.equal(i.key, 'WB-1')
  await wb.startIssue(i.id)
  const card = wb.listIssues().find((x) => x.id === i.id)!
  assert.equal(card.status, 'in_progress')
  assert.notEqual(card.worktree, stale) // never reuse or delete a directory this card did not create
  assert.equal(driver.started[0]!.cwd, card.worktree)
  assert.ok(existsSync(join(stale, 'old.txt'))) // and the leftover is untouched
})

test('Q14b a new card does not adopt an old branch of the same name left in the repo (its commits would show up as this task\'s diff)', async () => {
  const { wb, driver } = setup()
  wb.saveSettings({ isolateByDefault: true })
  const project = wb.listProjects().find((p) => p.name.endsWith('payment-core'))!
  const git = (...a: string[]) => execFileSync('git', a, { cwd: project.cwd, encoding: 'utf8' })
  git('branch', 'wb/wb-1') // what the previous WB-1 left behind (the title below has no ascii letters, so the name is just the key)
  const i = wb.createIssue({ title: '重置后', projectId: project.id, status: 'todo' })
  await wb.startIssue(i.id)
  const card = wb.listIssues().find((x) => x.id === i.id)!
  assert.equal(card.branch, 'wb/wb-1-2')
  assert.equal(driver.started.length, 1)
  // a retry of the same card keeps its own branch
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'failed', error: 'x' })
  await wb.startIssue(i.id)
  assert.equal(wb.listIssues().find((x) => x.id === i.id)!.branch, 'wb/wb-1-2')
})

test('Q15 a card made from demo data is never written back to a real Zentao bug that happens to share its number', async () => {
  const posts: string[] = []
  const f = (async (u: string, init?: RequestInit) => {
    if (u.endsWith('/tokens')) return Response.json({ token: 't' })
    if (init?.method === 'POST') posts.push(u)
    return Response.json({})
  }) as typeof fetch
  // the card was made while Zentao was still in demo mode (BUG-4821 is a demo to-do) ...
  const { wb, dir } = setup({}, f)
  const { issue } = await wb.startWork({ item: bug })
  wb.setStatus(issue.id, 'done')
  // ... and Zentao has been connected since (same data file, now with credentials)
  const live = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver: new FakeDriver(), fetch: f,
    creds: async (n) => ({ ...zentaoCreds } as Record<string, string>)[n] })
  await assert.rejects(live.writeBackZentao(issue.id, 'x'), /演示数据/)
  assert.deepEqual(posts, []) // nothing reached the real system
})

test('Q8c a new card cannot be created straight into 进行中 either', () => {
  const { wb } = setup()
  assert.throws(() => wb.createIssue({ title: 'x', status: 'in_progress' }), /开工/)
  assert.equal(wb.createIssue({ title: 'x', status: 'blocked' }).status, 'blocked') // the other columns stay open
})

test('Q16 the CSV export does not let a card title run as a spreadsheet formula', async () => {
  const { toCsv } = await import('../src/stats.ts')
  const csv = toCsv([{ title: '=HYPERLINK("http://evil","x")', other: '+1+1', third: '@SUM(A1)', ok: '普通标题', hours: 2, neg: -1, dash: '-cmd|calc' }])
  const line = csv.split('\n')[1]!
  assert.ok(line.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), line) // quoted and defanged
  assert.ok(line.includes("'+1+1") && line.includes("'@SUM(A1)") && line.includes("'-cmd|calc"), line)
  assert.ok(line.includes(',普通标题,2,-1,'), line) // plain text and real numbers are untouched
})

test('Q17 merge requests with the same number in two GitLab projects are two different to-dos', async () => {
  const { parseMergeRequests } = await import('../src/connectors/gitlab.ts')
  const items = parseMergeRequests([
    { iid: 12, title: 'a', web_url: 'https://g/a/-/merge_requests/12', project_id: 1, references: { full: 'team/a!12' } },
    { iid: 12, title: 'b', web_url: 'https://g/b/-/merge_requests/12', project_id: 2, references: { full: 'team/b!12' } },
    { iid: 7, title: 'c', web_url: 'https://g/c', project_id: 3 },
  ])
  assert.deepEqual(items.map((i) => i.ref), ['team/a!12', 'team/b!12', '3!7'])
  assert.equal(new Set(items.map((i) => i.ref)).size, 3) // refs identify the card (one card per source ref), so they must not collide
})

test('F1 only a system that was never configured shows demo rows; a configured one that fails shows none, and the Jenkins job list the same', async () => {
  const down = (async () => new Response('x', { status: 502 })) as typeof fetch
  const { wb } = setup({ WORKBENCH_JENKINS_URL: 'http://j.test', WORKBENCH_JENKINS_USER: 'u', WORKBENCH_JENKINS_TOKEN: 't' }, down)
  const t = await wb.listTodos()
  assert.deepEqual([t.sources.jenkins.mode, t.items.filter((i) => i.source === 'jenkins').length], ['error', 0])
  assert.equal(t.sources.zentao.mode, 'demo') // never configured: demo data, as before
  assert.ok(t.items.some((i) => i.source === 'zentao'))
  assert.equal(wb.listIssues().some((i) => i.sourceRef?.source === 'jenkins'), false)
  const jobs = await wb.jenkinsJobs()
  assert.deepEqual([jobs.mode, jobs.jobs.length], ['error', 0])
})

test('F4 doneAt is written when a card enters 已完成, cleared when it leaves, and kept through later edits', async () => {
  const { wb } = setup()
  const i = wb.createIssue({ title: 'x' })
  assert.equal(wb.listIssues().find((x) => x.id === i.id)!.doneAt, undefined)
  wb.setStatus(i.id, 'done')
  const at = wb.listIssues().find((x) => x.id === i.id)!.doneAt
  assert.ok(at && !Number.isNaN(Date.parse(at)))
  wb.updateIssue(i.id, { title: 'edited later' }) // editing a finished card does not move its finish time
  wb.moveIssue(i.id, 'done') // nor does reordering inside the column
  assert.equal(wb.listIssues().find((x) => x.id === i.id)!.doneAt, at)
  wb.setStatus(i.id, 'in_review')
  assert.equal(wb.listIssues().find((x) => x.id === i.id)!.doneAt, undefined)
})

test('F4 the weekly trend and the 周报 follow doneAt, not the last update', async () => {
  const { computeStats } = await import('../src/stats.ts')
  const now = Date.parse('2026-10-24T10:00:00') // a Saturday; its week starts 2026-10-19
  const card = (id: string, over: object) => ({ id, key: id, title: id, description: '', acceptance: [], status: 'done', agentId: 'fullstack', createdAt: '2026-09-01T00:00:00', updatedAt: '2026-10-23T10:00:00', ...over })
  const d = { issues: [card('a', { doneAt: '2026-10-08T10:00:00' }), card('b', { doneAt: '2026-10-22T10:00:00' }), card('c', {})], runs: [] } as never
  const week = (s: ReturnType<typeof computeStats>, w: string) => s.byWeek.find((x) => x.week === w)!.done
  const s = computeStats(d, now)
  assert.deepEqual([week(s, '2026-10-05'), week(s, '2026-10-19')], [1, 2]) // a: finished the week of 10-05 although edited since; c has no doneAt: falls back to updatedAt
  // the report
  const { wb } = setup()
  const k = wb.createIssue({ title: '上周完成、本周又被编辑' })
  wb.setStatus(k.id, 'done')
  wb.store.update((x) => { x.issues.find((y) => y.id === k.id)!.doneAt = new Date(Date.now() - 20 * 86400_000).toISOString() })
  await assert.rejects(wb.buildReport('week'), /还没有可汇总/)
})

/** Zentao that has joined late: one real bug (BUG-9) assigned to `a`, products 12/5/8/9 otherwise empty. */
const realZentao = (async (u: string) => {
  if (u.endsWith('/tokens')) return Response.json({ token: 't' })
  if (/products\/12\/bugs/.test(u)) return Response.json({ bugs: [{ id: 9, title: '真实缺陷', pri: 2, status: 'active', assignedTo: 'a', steps: '' }] })
  return Response.json({ bugs: [], tasks: [], executions: [] })
}) as typeof fetch

test('F2 the first real pull from a source clears its untouched demo cards; started, edited or finished ones stay, marked 演示', async () => {
  const creds: Record<string, string> = {}
  const { wb, driver } = setup(creds, realZentao)
  const t0 = await wb.listTodos() // nothing configured: everything is demo, and every to-do has a card
  assert.equal(t0.cleanedDemo, undefined)
  const demoZentaoCards = () => wb.listIssues().filter((i) => i.sourceRef?.source === 'zentao')
  assert.ok(demoZentaoCards().length >= 5 && demoZentaoCards().every((i) => i.demo))
  const byRef = (r: string) => wb.listIssues().find((i) => i.sourceRef?.ref === r)!
  await wb.startIssue(byRef('BUG-4821').id) // started
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' })
  wb.updateIssue(byRef('BUG-4809').id, { title: '我改过标题' }) // edited
  wb.setStatus(byRef('BUG-4815').id, 'done') // finished
  const gitlabBefore = wb.listIssues().filter((i) => i.sourceRef?.source === 'gitlab').length
  assert.deepEqual(wb.demoLeftovers(), []) // still in demo mode: these are the cards in use

  Object.assign(creds, zentaoCreds) // Zentao is connected
  const t1 = await wb.listTodos()
  assert.equal(t1.sources.zentao.mode, 'live')
  const left = demoZentaoCards().filter((i) => i.demo).map((i) => i.sourceRef!.ref).sort()
  assert.deepEqual(left, ['BUG-4809', 'BUG-4815', 'BUG-4821']) // only the three that were used
  assert.equal(t1.cleanedDemo, 4) // BUG-4818, REQ-316, TASK-902, DOC-77: the untouched ones
  assert.ok(demoZentaoCards().some((i) => i.sourceRef!.ref === 'BUG-9' && !i.demo)) // the real bug got its card
  assert.equal(wb.listIssues().filter((i) => i.sourceRef?.source === 'gitlab').length, gitlabBefore) // other sources are untouched
  assert.deepEqual([...wb.demoLeftovers()].sort(), left.map((r) => byRef(r).id).sort())
  const t2 = await wb.listTodos()
  assert.equal(t2.cleanedDemo, undefined) // told once
})

test('F2b 清理演示卡片 removes the leftovers of sources that are live, but not one with a running session or the demo of a source still in demo mode', async () => {
  const creds: Record<string, string> = {}
  const { wb, driver } = setup(creds, realZentao)
  await wb.listTodos()
  const card = (r: string) => wb.listIssues().find((i) => i.sourceRef?.ref === r)
  await wb.startIssue(card('BUG-4821')!.id)
  driver.emit({ type: 'turn.completed', runId: wb.listRuns().at(-1)!.id, status: 'completed' }) // finished its run
  wb.updateIssue(card('BUG-4809')!.id, { title: '改过' })
  await wb.startIssue(card('BUG-4818')!.id) // still running
  Object.assign(creds, zentaoCreds)
  await wb.listTodos() // the untouched ones go by themselves
  const leftovers = () => wb.listIssues().filter((i) => i.demo && i.sourceRef?.source === 'zentao').map((i) => i.sourceRef!.ref).sort()
  assert.deepEqual(leftovers(), ['BUG-4809', 'BUG-4818', 'BUG-4821'])
  const gitlab = wb.listIssues().filter((i) => i.sourceRef?.source === 'gitlab').length
  assert.equal(wb.cleanDemoCards(), 2) // 4821 and 4809; 4818 has a session working
  assert.deepEqual(leftovers(), ['BUG-4818'])
  assert.equal(wb.listIssues().filter((i) => i.sourceRef?.source === 'gitlab').length, gitlab) // GitLab is still demo
  assert.equal(wb.cleanDemoCards(), 0)
})

test('F5 stopping a running card interrupts its session, parks the card as 已阻塞 with the reason, and it can be retried', async () => {
  const { wb, driver } = setup()
  const { issue, run } = await wb.startWork({ item: bug })
  const stopped = await wb.stopIssue(issue.id)
  assert.deepEqual([stopped.status, stopped.note], ['blocked', '已手动停止'])
  assert.deepEqual(driver.interrupted, [`sess-${run.id}`])
  assert.deepEqual([wb.listRuns().find((r) => r.id === run.id)!.status, wb.listRuns().find((r) => r.id === run.id)!.error], ['interrupted', '已手动停止'])
  assert.equal(wb.workingCount(), 0)
  // the session reports its own end a moment later: the reason stays "stopped by hand"
  driver.emit({ type: 'turn.completed', runId: run.id, status: 'interrupted' })
  assert.equal(wb.listIssues().find((i) => i.id === issue.id)!.note, '已手动停止')
  await wb.startIssue(issue.id) // 重试
  assert.equal(wb.listIssues().find((i) => i.id === issue.id)!.status, 'in_progress')
})

test('F5b stop only applies to a card that is 进行中 with a session running, and a double click stops once', async () => {
  const { wb, driver } = setup()
  const idle = wb.createIssue({ title: 'x', projectId: wb.listProjects()[0]!.id, status: 'todo' })
  await assert.rejects(wb.stopIssue(idle.id), /没有正在运行的会话/)
  await assert.rejects(wb.stopIssue('iss_nope'), /不存在/)
  const { issue } = await wb.startWork({ item: bug })
  driver.interruptDelayMs = 40
  const r = await Promise.allSettled([wb.stopIssue(issue.id), wb.stopIssue(issue.id)])
  assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected'])
  assert.equal(driver.interrupted.length, 1)
  driver.failInterrupt = new Error('session gone')
  const b = await wb.startIssue(issue.id) // retry, then stop a session the host can no longer reach
  const s = await wb.stopIssue(b.issue.id)
  assert.equal(s.status, 'blocked') // the card is parked anyway
  assert.match(s.note!, /已手动停止.*session gone/)
})

test('F5c auto-run skips a card whose session is still running (or being stopped) and carries on with the next one', async () => {
  const { wb, driver } = setup()
  const project = wb.listProjects()[0]!
  const a = wb.createIssue({ title: 'A', projectId: project.id, status: 'todo' })
  await wb.startIssue(a.id)
  wb.moveIssue(a.id, 'todo') // dragged back while its session is alive: first in line, but it cannot start again
  const b = wb.createIssue({ title: 'B', projectId: project.id, status: 'todo' })
  wb.setAutoRun(true)
  await wb.tick()
  const get = (id: string) => wb.listIssues().find((i) => i.id === id)!
  assert.equal(get(a.id).status, 'todo') // left alone, not parked as blocked
  assert.equal(get(a.id).note, undefined)
  assert.equal(get(b.id).status, 'in_progress')
  assert.equal(driver.started.length, 2)
})
