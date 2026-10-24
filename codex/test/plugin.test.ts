import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../..', import.meta.url))

test('codex plugin: plugin.json / mcp.json pass the Agent Plugins 1.0.0 schemas and the marketplace points at them', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/validate-codex-plugin.mjs'], { cwd: root })
  assert.match(stdout, /pass the Agent Plugins 1\.0\.0 schemas/)
})
