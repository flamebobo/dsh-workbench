import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { callServe, serveInfoPath } from '../../core/src/serve.ts'
import { codexDataDir, ensureServe, stopServe } from '../runtime.ts'

const main = fileURLToPath(new URL('../main.ts', import.meta.url))
const entry = [process.execPath, main]

test('codex data dir: ~/.workbench-codex by default (never DSH\'s ~/.workbench), WORKBENCH_CODEX_HOME moves it', () => {
  assert.equal(codexDataDir({}), join(homedir(), '.workbench-codex'))
  assert.equal(codexDataDir({ WORKBENCH_HOME: '/x' }), join(homedir(), '.workbench-codex')) // the DSH variable does not apply
  assert.equal(codexDataDir({ WORKBENCH_CODEX_HOME: '/tmp/wb' }), '/tmp/wb')
})

test('ensureServe: starts the service when none runs, reuses it, a second serve is refused by the lock, stop ends it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-rt-'))
  const a = await ensureServe({ dir, version: 'dev', entry })
  try {
    assert.notEqual(a.pid, process.pid)
    const b = await ensureServe({ dir, version: 'dev', entry })
    assert.equal(b.pid, a.pid)
    assert.equal(b.token, a.token)
    const st = await callServe<{ ok: boolean; value: { projects: unknown[] } }>(a, '/rpc', { endpoint: 'state' })
    assert.equal(st.ok, true)
    assert.ok(st.value.projects.length > 0) // demo projects seeded in the Codex data dir
    // a second resident service on the same data dir exits with the lock's explanation
    const second = await promisify(execFile)(process.execPath, [main, 'serve'], { env: { ...process.env, WORKBENCH_CODEX_HOME: dir } }).then(() => undefined, (e) => e)
    assert.equal(second?.code, 1)
    assert.match(second.stderr, new RegExp(`正被另一个进程使用（PID ${a.pid}`))
    // an older (here: different) version is replaced on the next open
    const c = await ensureServe({ dir, version: 'newer', entry })
    assert.notEqual(c.pid, a.pid)
  } finally {
    assert.equal(await stopServe(dir), true)
  }
  assert.equal(existsSync(serveInfoPath(dir)), false)
  assert.equal(existsSync(join(dir, 'workbench.lock')), false)
  assert.equal(await stopServe(dir), false)
})
