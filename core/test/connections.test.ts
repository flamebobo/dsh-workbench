import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, Workbench } from '../src/index.ts'
import { jobPath } from '../src/connectors/jenkins.ts'
import { FakeDriver } from './fake.ts'

type Call = { url: string; method: string; headers: Record<string, string> }

function setup(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-conn-'))
  const secrets: Record<string, string> = {}
  let clock = Date.parse('2026-10-24T10:00:00Z')
  const wb = new Workbench({
    store: new Store(join(dir, 'workbench.json')), driver: new FakeDriver(),
    creds: async (n) => secrets[n],
    setCred: async (n, v) => { if (v === undefined) delete secrets[n]; else secrets[n] = v },
    fetch: fetchImpl as typeof fetch, now: () => clock,
  })
  wb.seedDemoProjects(join(dir, 'repos'))
  return { wb, secrets, tick: (ms: number) => { clock += ms } }
}

test('settings: save, never echo secrets, keep a secret when left empty, clear', async () => {
  const { wb, secrets } = setup()
  let all = await wb.connections()
  assert.deepEqual(all.map((c) => [c.id, c.configured]), [['zentao', false], ['gitlab', false], ['jenkins', false]])

  all = await wb.saveConnection('gitlab', { WORKBENCH_GITLAB_URL: ' https://gitlab.example.com/// ', WORKBENCH_GITLAB_TOKEN: 'glpat-secret' })
  assert.equal(secrets.WORKBENCH_GITLAB_URL, 'https://gitlab.example.com') // trimmed, no trailing slash
  const gl = all.find((c) => c.id === 'gitlab')!
  assert.equal(gl.configured, true)
  const token = gl.fields.find((f) => f.key === 'WORKBENCH_GITLAB_TOKEN')!
  assert.deepEqual([token.set, token.value], [true, undefined]) // the page learns "set", never the value
  assert.ok(!JSON.stringify(all).includes('glpat-secret'))
  assert.equal(gl.fields.find((f) => f.key === 'WORKBENCH_GITLAB_URL')!.value, 'https://gitlab.example.com')

  await wb.saveConnection('gitlab', { WORKBENCH_GITLAB_URL: 'https://gl2.example.com', WORKBENCH_GITLAB_TOKEN: '' })
  assert.equal(secrets.WORKBENCH_GITLAB_TOKEN, 'glpat-secret') // empty secret = unchanged
  await assert.rejects(() => wb.saveConnection('gitlab', { WORKBENCH_GITLAB_URL: 'ftp://x' }), /http:\/\//)

  await wb.saveConnection('zentao', { WORKBENCH_ZENTAO_URL: 'https://z', WORKBENCH_ZENTAO_ACCOUNT: 'me', WORKBENCH_ZENTAO_PASSWORD: 'pw', WORKBENCH_ZENTAO_EXECUTION_IDS: '1,2' })
  await wb.saveConnection('zentao', { WORKBENCH_ZENTAO_EXECUTION_IDS: '' }) // optional non-secret: empty removes it
  assert.equal(secrets.WORKBENCH_ZENTAO_EXECUTION_IDS, undefined)
  all = await wb.clearConnection('zentao')
  assert.equal(all.find((c) => c.id === 'zentao')!.configured, false)
  assert.equal(secrets.WORKBENCH_ZENTAO_PASSWORD, undefined)
})

test('settings: connection test reports success and the reason for failure', async () => {
  const f = (async (url: string) => {
    if (url.endsWith('/api/v4/user')) return Response.json({ username: 'zhang', name: '张三' })
    if (url.endsWith('/tokens')) return new Response('bad', { status: 400 })
    return Response.json({ jobs: [{ name: 'a' }, { name: 'b' }] })
  }) as never
  const { wb } = setup(f)
  assert.match((await wb.testConnection('gitlab')).message, /请先填写/)
  await wb.saveConnection('gitlab', { WORKBENCH_GITLAB_URL: 'https://g', WORKBENCH_GITLAB_TOKEN: 't' })
  assert.deepEqual(await wb.testConnection('gitlab'), { ok: true, message: '连接成功：张三（@zhang）' })
  await wb.saveConnection('zentao', { WORKBENCH_ZENTAO_URL: 'https://z', WORKBENCH_ZENTAO_ACCOUNT: 'me', WORKBENCH_ZENTAO_PASSWORD: 'bad' })
  const z = await wb.testConnection('zentao')
  assert.equal(z.ok, false)
  assert.match(z.message, /HTTP 400/)
  await wb.saveConnection('jenkins', { WORKBENCH_JENKINS_URL: 'https://j', WORKBENCH_JENKINS_USER: 'u', WORKBENCH_JENKINS_TOKEN: 't' })
  assert.equal((await wb.testConnection('jenkins')).message, '连接成功：可见 2 个 Job')
})

test('jenkins: folder jobs map to /job/a/job/b', () => {
  assert.equal(jobPath('team/order service'), 'job/team/job/order%20service')
})

test('jenkins build: crumb, parameters, queue -> running -> success, recorded on the cards', async () => {
  const calls: Call[] = []
  let polls = 0
  const f = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url, method: init?.method ?? 'GET', headers })
    if (url.endsWith('/crumb-issuer/api/json')) return Response.json({ crumbRequestField: 'Jenkins-Crumb', crumb: 'CR' })
    if (init?.method === 'POST') return new Response(null, { status: 201, headers: { location: 'https://j/queue/item/7' } })
    if (url === 'https://j/queue/item/7/api/json') return Response.json(polls++ < 1 ? { why: 'waiting' } : { executable: { number: 88, url: 'https://j/job/order-service-test/88/' } })
    if (url.startsWith('https://j/job/order-service-test/88/api/json')) return Response.json(polls++ < 3 ? { building: true, result: null, number: 88 } : { building: false, result: 'FAILURE', number: 88 })
    return new Response('?', { status: 500 })
  }) as never
  const { wb, tick } = setup(f)
  await wb.saveConnection('jenkins', { WORKBENCH_JENKINS_URL: 'https://j/', WORKBENCH_JENKINS_USER: 'u', WORKBENCH_JENKINS_TOKEN: 't' })
  const a = wb.createIssue({ title: 'a' }), b = wb.createIssue({ title: 'b' })

  const build = await wb.triggerBuild({ job: 'order-service-test', params: { ENV: 'test', ' ': 'x' }, issueIds: [a.id, b.id, 'iss_missing'] })
  assert.deepEqual(build.issueIds, [a.id, b.id])
  assert.equal(build.queueUrl, 'https://j/queue/item/7/')
  const post = calls.find((c) => c.method === 'POST')!
  assert.equal(post.url, 'https://j/job/order-service-test/buildWithParameters?ENV=test')
  assert.equal(post.headers['Jenkins-Crumb'], 'CR')
  assert.match(post.headers.authorization!, /^Basic /)

  const states: string[] = []
  for (let i = 0; i < 6; i++) { tick(5000); states.push((await wb.refreshBuilds())[0]!.state) }
  assert.deepEqual([...new Set(states)], ['queued', 'running', 'failure'])
  const done = wb.listBuilds()[0]!
  assert.deepEqual([done.number, done.buildUrl], [88, 'https://j/job/order-service-test/88/'])
  const n = calls.length
  tick(5000); await wb.refreshBuilds()
  assert.equal(calls.length, n) // finished builds are not polled again
})

test('jenkins build: unknown job and empty selection are reported, not swallowed', async () => {
  const f = (async (_u: string, init?: RequestInit) => init?.method === 'POST' ? new Response('nope', { status: 404 }) : new Response('x', { status: 404 })) as never
  const { wb } = setup(f)
  await wb.saveConnection('jenkins', { WORKBENCH_JENKINS_URL: 'https://j', WORKBENCH_JENKINS_USER: 'u', WORKBENCH_JENKINS_TOKEN: 't' })
  const a = wb.createIssue({ title: 'a' })
  const b = await wb.triggerBuild({ job: 'ghost', issueIds: [a.id] })
  assert.equal(b.state, 'error')
  assert.match(b.error!, /找不到 Job「ghost」/)
  await assert.rejects(() => wb.triggerBuild({ job: 'x', issueIds: [] }), /至少选择一张卡片/)
  await assert.rejects(() => wb.triggerBuild({ job: ' ', issueIds: [a.id] }), /选择要构建的 Job/)
})

test('jenkins build without credentials is simulated (demo) and advances with time', async () => {
  const { wb, tick } = setup()
  const j = await wb.jenkinsJobs()
  assert.equal(j.mode, 'demo')
  assert.ok(j.jobs.includes('order-service-test'))
  const a = wb.createIssue({ title: 'a' })
  const b = await wb.triggerBuild({ job: 'order-service-test', issueIds: [a.id] })
  assert.deepEqual([b.demo, b.state], [true, 'queued'])
  tick(6000); assert.equal((await wb.refreshBuilds())[0]!.state, 'running')
  tick(12000); const done = (await wb.refreshBuilds())[0]!
  assert.equal(done.state, 'success')
  assert.ok(done.number)
})
