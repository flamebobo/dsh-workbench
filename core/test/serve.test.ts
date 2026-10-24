import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, Workbench, createDispatch } from '../src/index.ts'
import { callServe, readServeInfo, serve, serveInfoPath } from '../src/serve.ts'
import { FakeDriver } from './fake.ts'

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-serve-'))
  const driver = new FakeDriver()
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver, creds: async () => undefined })
  const s = await serve({ dir, dispatch: createDispatch(wb, { driver }), version: 't', revision: () => wb.store.data })
  return { dir, wb, s }
}

test('serve: 127.0.0.1 only, a fresh token every start, nothing answered without it', async () => {
  const a = await start()
  const b = await start()
  try {
    assert.notEqual(a.s.info.token, b.s.info.token)
    assert.equal(a.s.info.token.length, 48)
    const info = readServeInfo(a.dir)!
    assert.deepEqual(info, a.s.info)
    if (process.platform !== 'win32') assert.equal(statSync(serveInfoPath(a.dir)).mode & 0o777, 0o600)
    for (const headers of [{} as Record<string, string>, { authorization: 'Bearer nope' }, { authorization: `Bearer ${b.s.info.token}` }]) {
      const res = await fetch(`http://127.0.0.1:${info.port}/rpc`, { method: 'POST', headers, body: JSON.stringify({ endpoint: 'state' }) })
      assert.equal(res.status, 401)
    }
    // not reachable on another interface's address
    await assert.rejects(fetch(`http://[::1]:${info.port}/health`))
    assert.deepEqual(await callServe(info, '/health'), { ok: true, pid: process.pid, version: 't' })
  } finally { await a.s.close(); await b.s.close() }
  assert.equal(existsSync(serveInfoPath(a.dir)), false)
})

test('serve: rpc runs the shared endpoints and reports errors the way the DSH route does; events wake on changes', async () => {
  const { wb, s } = await start()
  try {
    const st = await callServe<{ ok: boolean; value: { issues: unknown[] } }>(s.info, '/rpc', { endpoint: 'state' })
    assert.equal(st.ok, true)
    assert.deepEqual(st.value.issues, [])
    assert.deepEqual(await callServe(s.info, '/rpc', { endpoint: 'nope' }), { ok: false, error: 'unknown endpoint nope', code: 'invalid' })
    const { seq } = await callServe<{ seq: number }>(s.info, '/events?after=-1')
    const waited = callServe<{ seq: number }>(s.info, `/events?after=${seq}&wait=5000`)
    const t0 = Date.now()
    const created = await callServe<{ ok: boolean; value: { id: string } }>(s.info, '/rpc', { endpoint: 'issue.create', payload: { title: '通过本地服务建的卡片' } })
    assert.equal(created.ok, true)
    assert.ok((await waited).seq > seq)
    assert.ok(Date.now() - t0 < 3000)
    assert.equal(wb.listIssues()[0].title, '通过本地服务建的卡片')
    // uploads arrive base64-encoded
    const up = await callServe<{ ok: boolean; value: { id: string; size: number } }>(s.info, '/rpc', { endpoint: 'upload', payload: { name: 'a.txt', mediaType: 'text/plain', base64: Buffer.from('hello').toString('base64') } })
    assert.equal(up.ok, true)
    assert.equal(up.value.size, 5)
  } finally { await s.close() }
})
