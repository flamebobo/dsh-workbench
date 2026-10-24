import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, Workbench, compareVersions } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

test('version comparison: numeric parts, missing parts, v prefix, pre-releases before their release', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1)
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1) // numeric, not lexical
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.1'), 1)
})

function setup(fetchImpl: typeof fetch, version = '0.2.0', now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-upd-'))
  return new Workbench({ store: new Store(join(dir, 'w.json')), driver: new FakeDriver(), creds: async () => undefined, fetch: fetchImpl, version, now })
}

test('update check: newer / same / garbage / unreachable are all results, never exceptions; only web links become downloads', async () => {
  let reply: () => Response = () => Response.json({ version: '0.3.0', url: 'https://dl.corp/wb-0.3.0.zip', notes: '修复若干问题' })
  const wb = setup((async () => reply()) as never)
  await assert.rejects(wb.checkUpdate(), /还没有填写更新地址/)
  assert.throws(() => wb.saveSettings({ updateCheckUrl: 'file:///etc/passwd' }), /更新地址必须以 http/) // only http(s)
  wb.saveSettings({ updateCheckUrl: 'https://dl.corp/latest.json' })

  let u = await wb.checkUpdate()
  assert.deepEqual([u.newer, u.latest, u.url, u.notes], [true, '0.3.0', 'https://dl.corp/wb-0.3.0.zip', '修复若干问题'])
  reply = () => Response.json({ version: '0.2.0', url: 'javascript:alert(1)' })
  u = await wb.checkUpdate()
  assert.deepEqual([u.newer, u.url], [false, undefined]) // the same version; a non-web link is dropped
  reply = () => Response.json({ nope: 1 })
  assert.match((await wb.checkUpdate()).error!, /没有有效的 version/)
  reply = () => new Response('x', { status: 502 })
  assert.equal((await wb.checkUpdate()).error, 'HTTP 502')
  const down = setup((async () => { throw new Error('ENOTFOUND') }) as never)
  down.saveSettings({ updateCheckUrl: 'https://dl.corp/latest.json' })
  assert.match((await down.checkUpdate()).error!, /ENOTFOUND/)
})

test('the banner follows the running version, and the daily check runs once a day only with an address', async () => {
  let calls = 0
  let t = Date.parse('2026-10-24T08:00:00Z')
  const wb = setup((async () => { calls++; return Response.json({ version: '0.3.0' }) }) as never, '0.2.0', () => t)
  await wb.maybeCheckUpdate() // no address
  assert.equal(calls, 0)
  wb.saveSettings({ updateCheckUrl: 'https://dl.corp/latest.json' })
  await wb.maybeCheckUpdate()
  await wb.maybeCheckUpdate() // asked just now
  assert.equal(calls, 1)
  t += 25 * 3600_000
  await wb.maybeCheckUpdate()
  assert.equal(calls, 2)
  assert.equal(wb.updateInfo()!.newer, true)
  // the plugin got updated and restarted: the remembered answer no longer says "newer"
  const after = new Workbench({ store: wb.store, driver: new FakeDriver(), creds: async () => undefined, version: '0.3.0' })
  assert.equal(after.updateInfo()!.newer, false)
})
