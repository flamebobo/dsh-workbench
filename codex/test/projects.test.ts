import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { codexProjects } from '../projects.ts'

test('codexProjects: the [projects."…"] tables of config.toml that still exist, that are git repositories, minus the workbench\'s own data dir', () => {
  const home = mkdtempSync(join(tmpdir(), 'wb-codexhome-'))
  const a = join(home, 'proj-a'), own = join(home, 'wbdata'), demo = join(own, 'demo-repos/x'), chat = join(home, 'chat-scratch')
  for (const d of [join(a, '.git'), join(demo, '.git'), chat]) mkdirSync(d, { recursive: true })
  writeFileSync(join(home, 'config.toml'), [
    'model = "x"', '', `[projects."${a}"]`, 'trust_level = "trusted"', '', `[projects."${demo}"]`, 'trust_level = "trusted"', '', `[projects."${chat}"]`, 'trust_level = "trusted"', '',
    `[projects."${join(home, 'deleted')}"]`, 'trust_level = "trusted"', '', '[plugins."a@b"]', 'enabled = true', '',
  ].join('\n'))
  assert.deepEqual(codexProjects({ codexHome: home, exclude: own }), [a])
  assert.deepEqual(codexProjects({ codexHome: join(home, 'nope') }), []) // no config: nothing, no error
})
