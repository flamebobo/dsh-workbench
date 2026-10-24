import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, Workbench, createDispatch } from '../../core/src/index.ts'
import { FakeDriver } from '../../core/test/fake.ts'
import { openThreadCommand } from '../open-thread.ts'

test('open thread: codex://threads/<id> per platform; anything that is not a thread id is refused', () => {
  const id = '01a16e15-7037-7c82-ac4b-0ee4b2bb5c08'
  assert.deepEqual(openThreadCommand(id, 'darwin'), ['open', `codex://threads/${id}`])
  assert.deepEqual(openThreadCommand(id, 'win32'), ['cmd', '/c', 'start', '', `codex://threads/${id}`])
  assert.deepEqual(openThreadCommand(id, 'linux'), ['xdg-open', `codex://threads/${id}`])
  for (const bad of ['', 'x', '../../etc', `${id}&calc`, 'a b c d e f g h']) assert.throws(() => openThreadCommand(bad, 'darwin'), /线程 ID/, bad)
})

test('session.open reaches the host hook with the id (and is a no-op where the host has none)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-open-'))
  const driver = new FakeDriver()
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver, creds: async () => undefined })
  const opened: string[] = []
  assert.equal(await createDispatch(wb, { driver, openSession: (id) => { opened.push(id) } })('session.open', { id: 'abc' }), null)
  assert.deepEqual(opened, ['abc'])
  assert.equal(await createDispatch(wb, { driver })('session.open', { id: 'abc' }), null)
})
