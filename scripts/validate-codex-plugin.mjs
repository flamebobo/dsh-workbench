// Checks codex-plugin/ against the public Agent Plugins 1.0.0 JSON schemas (scripts/schemas/, unchanged copies of
// https://agent-plugins.org/schemas/1.0.0/{plugin,mcp}.schema.json), the same way better-codex validates its plugin, plus the
// marketplace entry and the files mcp.json starts. This is schema validation, not OpenAI's own validate_plugin helper.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Validator } from '@cfworker/json-schema'

const root = resolve(process.argv[2] || '.')
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
const market = json('.agents/plugins/marketplace.json')
const entry = market.plugins.find((p) => p.name === 'workbench')
assert.ok(entry, 'marketplace.json lists the workbench plugin')
assert.equal(entry.source.source, 'local')
const dir = join(root, entry.source.path)
for (const file of ['plugin', 'mcp']) {
  const schema = JSON.parse(readFileSync(new URL(`./schemas/agent-plugins-1.0.0-${file}.schema.json`, import.meta.url), 'utf8'))
  const result = new Validator(schema, '2020-12', false).validate(JSON.parse(readFileSync(join(dir, `${file}.json`), 'utf8')))
  assert.equal(result.valid, true, `${file}.json: ${JSON.stringify(result.errors)}`)
}
const plugin = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'))
assert.equal(plugin.name, entry.name, 'the marketplace entry and plugin.json name the same plugin')
assert.ok(plugin.extensions?.['com.openai']?.interface?.displayName, 'Codex needs extensions["com.openai"].interface')
const server = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8')).mcpServers.workbench
assert.deepEqual([server.command, ...server.args], ['node', './server.mjs', 'mcp'])
for (const f of ['server.mjs', 'board.html']) assert.ok(existsSync(join(dir, f)), `${f} is built (npm run build:codex)`)
console.log('codex-plugin: plugin.json / mcp.json pass the Agent Plugins 1.0.0 schemas; marketplace entry and built files present.')
