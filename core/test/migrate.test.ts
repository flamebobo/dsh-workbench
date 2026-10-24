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

test('F4 v2 -> v3: finished cards get doneAt from their last update (an approximation), others none; the file is backed up as .v2.bak', () => {
  const path = tmp()
  const issue = (id: string, status: string, updatedAt: string) => ({ id, key: id, title: id, description: '', acceptance: [], status, createdAt: '2026-10-01T00:00:00.000Z', updatedAt })
  writeFileSync(path, JSON.stringify({ version: 2, seq: 3, issueSeq: 3, projects: [], agents: [], runs: [], builds: [], hiddenTodos: [],
    issues: [issue('a', 'done', '2026-10-20T08:00:00.000Z'), issue('b', 'in_review', '2026-10-21T08:00:00.000Z'), { ...issue('c', 'done', '2026-10-22T08:00:00.000Z'), doneAt: '2026-10-19T00:00:00.000Z' }] }))
  const s = new Store(path)
  assert.equal(s.data.version, 3)
  const by = Object.fromEntries(s.data.issues.map((i) => [i.id, i.doneAt]))
  assert.deepEqual(by, { a: '2026-10-20T08:00:00.000Z', b: undefined, c: '2026-10-19T00:00:00.000Z' }) // an existing doneAt is never overwritten
  assert.equal(JSON.parse(readFileSync(`${path}.v2.bak`, 'utf8')).version, 2)
})

test('F3 autoDoneOnPass: off for a fresh install; an existing file keeps what it had (including "never touched" = the old default, on)', async () => {
  const { Workbench } = await import('../src/index.ts')
  const { FakeDriver } = await import('./fake.ts')
  const open = (data: object) => { const path = tmp(); writeFileSync(path, JSON.stringify({ ...v1, version: 2, ...data })); return new Workbench({ store: new Store(path), driver: new FakeDriver(), creds: async () => undefined }).settings().autoDoneOnPass }
  assert.equal(new Workbench({ store: new Store(tmp()), driver: new FakeDriver(), creds: async () => undefined }).settings().autoDoneOnPass, false) // fresh
  assert.equal(open({}), true) // v2 file whose owner never saved settings: the old default (on) carries over
  assert.equal(open({ settings: { branchPrefix: 'x/' } }), true) // saved other settings, never this one
  assert.equal(open({ settings: { autoDoneOnPass: false } }), false) // an explicit choice is never changed
  assert.equal(open({ settings: { autoDoneOnPass: true } }), true)
})

test('F2 v2 -> v3: cards made from the built-in demo to-dos are marked demo; real ones and manual ones are not', async () => {
  const { demoZentao } = await import('../fixtures/demo.ts')
  const path = tmp()
  const card = (id: string, title: string, sourceRef?: object, description = '') => ({ id, key: id, title, description, acceptance: [], status: 'backlog', createdAt: 'x', updatedAt: 'x', sourceRef })
  const bug = demoZentao[0]!
  writeFileSync(path, JSON.stringify({ version: 2, seq: 3, issueSeq: 3, projects: [], agents: [], runs: [], issues: [
    card('demo', bug.title, { source: 'zentao', ref: bug.ref }),
    card('edited', '我改了标题', { source: 'zentao', ref: bug.ref }, bug.description), // title edited, background still the demo's
    card('real', '线上真实缺陷', { source: 'zentao', ref: bug.ref }, '真实背景'), // same number, real content
    card('manual', bug.title),
  ] }))
  const by = Object.fromEntries(new Store(path).data.issues.map((i) => [i.id, i.demo]))
  assert.deepEqual(by, { demo: true, edited: true, real: undefined, manual: undefined })
})
