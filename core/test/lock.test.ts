import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import { acquireLock, LockError } from '../src/lock.ts'

const lockModule = new URL('../src/lock.ts', import.meta.url).href

/** Another process that takes the lock on `dir` and keeps running until killed. */
async function holder(dir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { acquireLock } from ${JSON.stringify(lockModule)}; acquireLock(${JSON.stringify(dir)}); console.log('held'); setInterval(() => {}, 1000)`],
  { stdio: ['ignore', 'pipe', 'inherit'] })
  const [line] = await once(child.stdout!, 'data')
  assert.equal(String(line).trim(), 'held')
  return child
}

test('lock: a live owner in another process keeps the data dir; once it dies the lock is taken over', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-lock-'))
  const child = await holder(dir)
  try {
    assert.throws(() => acquireLock(dir), (e: unknown) => e instanceof LockError && e.owner?.pid === child.pid && /正被另一个进程使用/.test(e.message))
  } finally {
    child.kill('SIGKILL'); await once(child, 'exit')
  }
  const release = acquireLock(dir) // the owner is gone: its leftover lock file does not block
  assert.equal(JSON.parse(readFileSync(join(dir, 'workbench.lock'), 'utf8')).pid, process.pid)
  release()
  assert.equal(existsSync(join(dir, 'workbench.lock')), false)
})

test('lock: a pid that is alive but started at another time (reused pid) does not hold the lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-lock-'))
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  try {
    writeFileSync(join(dir, 'workbench.lock'), JSON.stringify({ pid: other.pid, startedAt: '2001-01-01T00:00:00.000Z', nonce: 'x' }))
    if (process.platform !== 'win32') acquireLock(dir)()
    // with the real start time it is a live owner
    const started = new Date(Date.now() - 1000).toISOString()
    writeFileSync(join(dir, 'workbench.lock'), JSON.stringify({ pid: other.pid, startedAt: started, nonce: 'x' }))
    assert.throws(() => acquireLock(dir), LockError)
  } finally { other.kill('SIGKILL') }
})

test('lock: a corrupt lock file is stale; the same process loading again takes over; release only removes its own lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-lock-'))
  writeFileSync(join(dir, 'workbench.lock'), '')
  const first = acquireLock(dir)
  const second = acquireLock(dir) // e.g. the DSH plugin reloaded before the old instance was disposed
  first() // the old instance's release must not remove the new instance's lock
  assert.equal(existsSync(join(dir, 'workbench.lock')), true)
  second()
  assert.equal(existsSync(join(dir, 'workbench.lock')), false)
})
