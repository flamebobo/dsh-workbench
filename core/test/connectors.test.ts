import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchGitlab, } from '../src/connectors/gitlab.ts'
import { fetchJenkins, parseFailedBuilds } from '../src/connectors/jenkins.ts'
import { fetchZentao, parseBugs, parseTasks } from '../src/connectors/zentao.ts'
import type { ConnectorContext } from '../src/connectors/http.ts'

const creds = (m: Record<string, string>) => async (n: string) => m[n]

test('zentao: parses bugs/tasks, filters by assignee and open status, tolerates both assignedTo shapes', () => {
  const bugs = parseBugs({ bugs: [
    { id: 1, title: 'a', pri: 1, status: 'active', assignedTo: { account: 'me', realname: '我' }, deadline: '2026-10-23', steps: '<p>步骤&nbsp;一</p>' },
    { id: 2, title: 'b', pri: 3, status: 'active', assignedTo: 'other' },
    { id: 3, title: 'c', pri: 2, status: 'resolved', assignedTo: 'me' },
    { id: 4, title: 'd', pri: 4, status: 'active', assignedTo: 'me', deadline: '0000-00-00' },
  ] }, 'me', 12, 'https://z.test')
  assert.deepEqual(bugs.map((b) => [b.ref, b.priority, b.statusText, b.due]), [['BUG-1', 'P0', '已激活', '2026-10-23'], ['BUG-4', 'P3', '已激活', undefined]])
  assert.equal(bugs[0]!.description, '步骤 一')
  assert.equal(bugs[0]!.zentaoProductId, 12)
  const tasks = parseTasks({ tasks: [{ id: 9, name: 't', pri: 2, status: 'doing', assignedTo: 'me' }, { id: 10, name: 'x', pri: 2, status: 'done', assignedTo: 'me' }] }, 'me', 3, 'https://z.test')
  assert.deepEqual(tasks.map((t) => [t.ref, t.statusText]), [['TASK-9', '进行中']])
})

test('zentao: token handshake then Token header, product bugs requested per configured product', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return String(url).endsWith('/tokens') ? Response.json({ token: 'TKN' }) : Response.json({ bugs: [{ id: 7, title: 'x', pri: 1, status: 'active', assignedTo: 'me' }] })
  }) as unknown as ConnectorContext['fetch']
  const c: ConnectorContext = {
    creds: creds({ WORKBENCH_ZENTAO_URL: 'https://z.test/', WORKBENCH_ZENTAO_ACCOUNT: 'me', WORKBENCH_ZENTAO_PASSWORD: 'pw' }),
    fetch: fetchImpl, zentaoProductIds: [5, 6],
  }
  const items = await fetchZentao(c)
  assert.equal(items!.length, 2)
  assert.equal(calls[0]!.url, 'https://z.test/api.php/v1/tokens')
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { account: 'me', password: 'pw' })
  assert.ok(calls.slice(1).every((x) => (x.init!.headers as Record<string, string>).Token === 'TKN'))
  const paths = calls.slice(1).map((x) => new URL(x.url).pathname)
  assert.ok(paths.includes('/api.php/v1/executions')) // no execution ids configured -> discovery asks Zentao
  assert.deepEqual(paths.filter((p) => p.includes('/bugs')), ['/api.php/v1/products/5/bugs', '/api.php/v1/products/6/bugs'])
  assert.equal(await fetchZentao({ ...c, creds: creds({}) }), undefined)
})

test('gitlab: user lookup then reviewer MR query with PRIVATE-TOKEN; project parsed from references', async () => {
  const calls: string[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url))
    assert.equal((init!.headers as Record<string, string>)['PRIVATE-TOKEN'], 'glpat')
    return String(url).endsWith('/user') ? Response.json({ username: 'me' }) : Response.json([
      { iid: 11287, title: '订单拆分重构', web_url: 'https://g/x', project_id: 101, references: { full: 'teleone/teleone-order!11287' }, author: { name: '张伟' }, source_branch: 'a', target_branch: 'master' },
    ])
  }) as unknown as ConnectorContext['fetch']
  const items = await fetchGitlab({ creds: creds({ WORKBENCH_GITLAB_URL: 'https://g.test', WORKBENCH_GITLAB_TOKEN: 'glpat' }), fetch: fetchImpl, zentaoProductIds: [] })
  assert.match(calls[1]!, /merge_requests\?scope=all&state=opened&reviewer_username=me/)
  assert.deepEqual([items![0]!.ref, items![0]!.project, items![0]!.gitlabProjectId], ['teleone/teleone-order!11287', 'teleone/teleone-order', 101])
})

test('jenkins: only red jobs with a last build become to-dos; Basic auth', async () => {
  const json = { jobs: [
    { name: 'order-service', color: 'red', url: 'https://j/job/order-service/', lastBuild: { number: 2145, result: 'FAILURE', timestamp: 1792000000000, url: 'https://j/job/order-service/2145/' } },
    { name: 'ok', color: 'blue', lastBuild: { number: 1, result: 'SUCCESS' } },
    { name: 'running', color: 'red_anime', lastBuild: { number: 5 } },
    { name: 'never', color: 'notbuilt', lastBuild: null },
  ] }
  assert.deepEqual(parseFailedBuilds(json).map((i) => i.ref), ['order-service #2145', 'running #5'])
  let auth = ''
  const fetchImpl = (async (_u: string, init?: RequestInit) => { auth = (init!.headers as Record<string, string>).authorization!; return Response.json(json) }) as unknown as ConnectorContext['fetch']
  await fetchJenkins({ creds: creds({ WORKBENCH_JENKINS_URL: 'https://j', WORKBENCH_JENKINS_USER: 'u', WORKBENCH_JENKINS_TOKEN: 't' }), fetch: fetchImpl, zentaoProductIds: [] })
  assert.equal(auth, `Basic ${Buffer.from('u:t').toString('base64')}`)
})

test('zentao: with no ids configured, products and open executions are discovered', async () => {
  const urls: string[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    urls.push(new URL(url).pathname)
    const path = new URL(url).pathname
    if (path.endsWith('/tokens')) return Response.json({ token: 'T' })
    if (path.endsWith('/v1/products')) return Response.json({ products: [{ id: 5 }, { id: 6, status: 'closed' }] })
    if (path.endsWith('/v1/executions')) return Response.json({ executions: [{ id: 21, status: 'doing' }, { id: 22, status: 'done' }, { id: 23, status: 'wait' }] })
    if (path.endsWith('/products/5/bugs')) return Response.json({ bugs: [{ id: 1, title: 'b', pri: 1, status: 'active', assignedTo: 'me' }] })
    if (path.endsWith('/executions/21/tasks')) return Response.json({ tasks: [{ id: 9, name: 't', pri: 2, status: 'doing', assignedTo: 'me' }] })
    if (path.endsWith('/executions/23/tasks')) return Response.json({ tasks: [] })
    return new Response('?', { status: 500 })
  }) as unknown as ConnectorContext['fetch']
  const c: ConnectorContext = { creds: creds({ WORKBENCH_ZENTAO_URL: 'https://z', WORKBENCH_ZENTAO_ACCOUNT: 'me', WORKBENCH_ZENTAO_PASSWORD: 'pw' }), fetch: fetchImpl, zentaoProductIds: [] }
  const items = await fetchZentao(c)
  assert.deepEqual(items!.map((i) => i.ref).sort(), ['BUG-1', 'TASK-9'])
  assert.ok(urls.includes('/api.php/v1/executions/23/tasks') && !urls.includes('/api.php/v1/executions/22/tasks')) // finished executions are skipped
  // an explicit configuration is never second-guessed by discovery
  urls.length = 0
  await fetchZentao({ ...c, zentaoProductIds: [5], creds: creds({ WORKBENCH_ZENTAO_URL: 'https://z', WORKBENCH_ZENTAO_ACCOUNT: 'me', WORKBENCH_ZENTAO_PASSWORD: 'pw', WORKBENCH_ZENTAO_EXECUTION_IDS: '21' }) })
  assert.ok(!urls.includes('/api.php/v1/products') && !urls.includes('/api.php/v1/executions'))
  // discovery being unavailable (older Zentao) just means fewer sources, not a failure
  const none = await fetchZentao({ ...c, fetch: (async (u: string) => (String(u).endsWith('/tokens') ? Response.json({ token: 'T' }) : new Response('?', { status: 404 }))) as never })
  assert.deepEqual(none, [])
})
