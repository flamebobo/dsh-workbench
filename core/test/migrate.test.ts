import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DATA_VERSION, DataVersionError, Store } from '../src/index.ts'

const tmp = () => join(mkdtempSync(join(tmpdir(), 'wb-mig-')), 'workbench.json')
const v1 = { version: 1, seq: 5, projects: [], agents: [], runs: [], issues: [{ id: 'iss_1', key: 'WB-1', title: 't', description: '', status: 'todo', createdAt: 'x', updatedAt: 'x' }] }

test('an old data file is backed up, upgraded in place and keeps its content', () => {
  const path = tmp()
  writeFileSync(path, JSON.stringify(v1))
  const s = new Store(path)
  assert.equal(s.data.version, DATA_VERSION)
  assert.deepEqual([s.data.issues[0]!.acceptance, s.data.builds, s.data.hiddenTodos, s.data.issueSeq], [[], [], [], 1])
  assert.equal(s.data.issues[0]!.key, 'WB-1')
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, DATA_VERSION) // written back
  assert.equal(JSON.parse(readFileSync(`${path}.v1.bak`, 'utf8')).version, 1) // the original is kept
  new Store(path) // opening again changes nothing and makes no second backup
  assert.equal(JSON.parse(readFileSync(`${path}.v1.bak`, 'utf8')).seq, 5)
})

test('a file without a version counts as the oldest shape; a current or missing file is left alone', () => {
  const path = tmp()
  const { version, ...noVersion } = v1
  assert.ok(version)
  writeFileSync(path, JSON.stringify(noVersion))
  assert.equal(new Store(path).data.version, DATA_VERSION)
  assert.ok(existsSync(`${path}.v1.bak`))
  const fresh = tmp()
  assert.equal(new Store(fresh).data.version, DATA_VERSION)
  assert.equal(existsSync(fresh), false) // nothing is written until something changes
  assert.equal(existsSync(`${fresh}.v1.bak`), false)
})

test('a file from a newer plugin is refused and never rewritten', () => {
  const path = tmp()
  const newer = JSON.stringify({ ...v1, version: DATA_VERSION + 1, future: true })
  writeFileSync(path, newer)
  assert.throws(() => new Store(path), (e: Error) => e instanceof DataVersionError && /更新到最新版/.test(e.message))
  assert.equal(readFileSync(path, 'utf8'), newer)
})
