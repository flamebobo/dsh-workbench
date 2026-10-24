import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { listDirs } from '../src/dirs.ts'

test('listDirs: subdirectories only, git repos flagged, dot-directories on request, parent and places', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wb-dirs-'))
  mkdirSync(join(root, 'b-repo/.git'), { recursive: true })
  mkdirSync(join(root, 'a-plain'))
  mkdirSync(join(root, '.hidden'))
  writeFileSync(join(root, 'file.txt'), 'x')
  symlinkSync(join(root, 'a-plain'), join(root, 'link-to-dir'))
  const l = await listDirs(root, { hints: [join(root, 'b-repo'), join(root, 'gone')] })
  assert.deepEqual(l.entries.map((e) => [e.name, e.isGit]), [['a-plain', false], ['b-repo', true], ['link-to-dir', false]])
  assert.equal(l.path, root)
  assert.equal(l.parent, dirname(root))
  assert.deepEqual(l.places.map((p) => p.label), ['主目录', 'b-repo']) // a hint that no longer exists is dropped
  assert.deepEqual((await listDirs(root, { hidden: true })).entries.map((e) => e.name), ['.hidden', 'a-plain', 'b-repo', 'link-to-dir'])
})

test('listDirs: a missing path falls back to its nearest existing parent, nothing given = home, the root has no parent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wb-dirs-'))
  assert.equal((await listDirs(join(root, 'no/such/dir'))).path, root)
  assert.equal((await listDirs(undefined)).path, homedir())
  assert.equal((await listDirs('/')).parent, undefined)
})
