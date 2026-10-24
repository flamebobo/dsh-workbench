// Local stand-in for Zentao + GitLab + Jenkins + update/stats endpoints, for QA only: every write lands in memory and in GET /__log.
// node scripts/qa/mock.mjs [port]   (default 4100). Control: POST /__mode {zentaoFail, product3Forbidden, gitlabFail, jenkinsFail, delayMs}
import http from 'node:http'

const port = Number(process.argv[2] ?? 4100)
const log = []
const mode = { zentaoFail: false, product3Forbidden: false, gitlabFail: false, jenkinsFail: false, delayMs: 0 }
const builds = []
const record = (kind, detail) => log.push({ at: new Date().toISOString(), kind, ...detail })

const bugs = (pid) => pid === 1
  ? [
      { id: 501, title: 'Mock 登录页偶发 500', pri: 1, status: 'active', assignedTo: 'qa', steps: '<p>点击登录，偶发 500</p>', deadline: '2026-10-25' },
      { id: 502, title: 'Mock 已关闭的缺陷', pri: 2, status: 'closed', assignedTo: 'qa', steps: '' },
      { id: 503, title: 'Mock 没有优先级的缺陷', status: 'active', assignedTo: 'qa', steps: '<p>pri 字段缺失</p>' },
    ]
  : pid === 2 ? [{ id: 601, title: 'Mock 产品二的缺陷', pri: 3, status: 'active', assignedTo: { account: 'qa' }, steps: '<p>x</p>' }] : []
const tasks = (eid) => eid === 11 ? [{ id: 701, name: 'Mock 迭代任务：接口联调', pri: 2, status: 'doing', assignedTo: 'qa', desc: '<p>联调</p>', deadline: '2026-10-30' }] : []

const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c }); req.on('end', () => ok(s)) })
const json = (res, code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)) }

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const p = url.pathname
  const raw = await body(req)
  if (mode.delayMs && !p.startsWith('/__')) await new Promise((r) => setTimeout(r, mode.delayMs))
  try {
    if (p === '/__log') return json(res, 200, log)
    if (p === '/__mode') { Object.assign(mode, raw ? JSON.parse(raw) : {}); return json(res, 200, mode) }
    if (p === '/__reset') { log.length = 0; builds.length = 0; return json(res, 200, {}) }
    // ---- Zentao v1 ----
    if (p.startsWith('/api.php/v1')) {
      if (mode.zentaoFail) return json(res, 500, { error: 'mock down' })
      if (p === '/api.php/v1/tokens') { const b = JSON.parse(raw); return b.password === 'qa-pass' ? json(res, 201, { token: 'zt-mock' }) : json(res, 400, { error: 'bad password' }) }
      if (req.headers.token !== 'zt-mock') return json(res, 401, { error: 'no token' })
      if (p === '/api.php/v1/products') return json(res, 200, { products: [{ id: 1, name: 'Mock 产品一', status: 'normal' }, { id: 2, name: 'Mock 产品二', status: 'normal' }, { id: 3, name: 'Mock 受限产品', status: 'normal' }] })
      if (p === '/api.php/v1/executions') return json(res, 200, { executions: [{ id: 11, name: 'Mock 迭代 11', status: 'doing' }] })
      let m
      if ((m = /^\/api\.php\/v1\/products\/(\d+)\/bugs$/.exec(p))) return Number(m[1]) === 3 && mode.product3Forbidden ? json(res, 403, { error: 'forbidden' }) : json(res, 200, { bugs: bugs(Number(m[1])) })
      if ((m = /^\/api\.php\/v1\/executions\/(\d+)\/tasks$/.exec(p))) return json(res, 200, { tasks: tasks(Number(m[1])) })
      if ((m = /^\/api\.php\/v1\/bugs\/(\d+)\/resolve$/.exec(p))) { record('zentao.resolve', { bug: Number(m[1]), body: JSON.parse(raw) }); return json(res, 200, { id: Number(m[1]), status: 'resolved' }) }
      return json(res, 404, { error: 'nope' })
    }
    // ---- GitLab ----
    if (p.startsWith('/api/v4')) {
      if (mode.gitlabFail) return json(res, 502, { message: 'mock bad gateway' })
      if (req.headers['private-token'] !== 'glpat-mock') return json(res, 401, { message: '401 Unauthorized' })
      if (p === '/api/v4/user') return json(res, 200, { username: 'qa', name: 'QA 测试员' })
      if (p === '/api/v4/merge_requests') return json(res, 200, [{ iid: 9001, title: 'Mock 评审：缓存键', description: '<p>请评审</p>', web_url: 'http://127.0.0.1:4100/mr/9001', project_id: 101, references: { full: 'mock/teleone-order!9001' }, author: { name: '同事甲' }, source_branch: 'feat/x', target_branch: 'main' }])
      let m
      if ((m = /^\/api\/v4\/projects\/(\d+)\/merge_requests$/.exec(p))) {
        if (req.method === 'POST') { const b = JSON.parse(raw); record('gitlab.mr.create', { project: Number(m[1]), body: b }); return json(res, 201, { iid: 100 + log.length, web_url: `http://127.0.0.1:4100/mr/${100 + log.length}` }) }
        return json(res, 200, [])
      }
      if ((m = /^\/api\/v4\/projects\/(.+)$/.exec(p))) return json(res, 200, { id: 101 })
      return json(res, 404, { message: 'nope' })
    }
    // ---- update + stats report ----
    if (p === '/latest.json') return json(res, 200, { version: '9.9.9', url: 'http://127.0.0.1:4100/download', notes: 'Mock 新版本' })
    if (p === '/stats') { record('stats.report', { body: raw.slice(0, 400) }); return json(res, 200, {}) }
    // ---- Jenkins ----
    if (mode.jenkinsFail) return json(res, 503, { error: 'mock down' })
    const auth = req.headers.authorization ?? ''
    if (auth !== `Basic ${Buffer.from('qa:jk-mock').toString('base64')}`) return json(res, 401, { error: 'unauth' })
    if (p === '/api/json') return json(res, 200, { jobs: [{ name: 'order-service-test', color: 'blue' }, { name: 'web-staging', color: 'red', lastBuild: { number: 12, result: 'FAILURE', timestamp: Date.now() - 3600_000, url: 'http://127.0.0.1:4100/job/web-staging/12/' } }] })
    if (p === '/crumb-issuer/api/json') return json(res, 404, {})
    let m
    if ((m = /^\/job\/([^/]+)\/(build|buildWithParameters)$/.exec(p))) {
      builds.push({ job: m[1], at: Date.now(), params: Object.fromEntries(url.searchParams) })
      record('jenkins.build', { job: m[1], params: Object.fromEntries(url.searchParams) })
      return json(res, 201, {}, { location: `http://127.0.0.1:${port}/queue/item/${builds.length}/` })
    }
    if ((m = /^\/queue\/item\/(\d+)\/api\/json$/.exec(p))) { const b = builds[Number(m[1]) - 1]; return json(res, 200, Date.now() - b.at < 2000 ? {} : { executable: { number: 40 + Number(m[1]), url: `http://127.0.0.1:${port}/build/${m[1]}/` } }) }
    if ((m = /^\/build\/(\d+)\/api\/json$/.exec(p))) { const b = builds[Number(m[1]) - 1]; const age = Date.now() - b.at; return json(res, 200, age < 7000 ? { building: true, number: 40 + Number(m[1]) } : { building: false, result: 'SUCCESS', number: 40 + Number(m[1]) }) }
    return json(res, 404, { error: 'nope' })
  } catch (e) { json(res, 500, { error: String(e) }) }
}).listen(port, '127.0.0.1', () => console.log(`qa mock on http://127.0.0.1:${port}`))
