import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Store, Workbench, createDispatch } from '../../core/src/index.ts'
import { FakeDriver } from '../../core/test/fake.ts'
import type { RpcReply } from '../endpoints.ts'
import { BOARD_URI, createMcpServer, type Backend } from '../mcp.ts'
import { mcpTransport } from '../../ui/mcp-transport.ts'

const json = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text)

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-mcp-'))
  const driver = new FakeDriver()
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver, creds: async () => undefined })
  wb.seedDemoProjects(join(dir, 'repos'))
  wb.saveSettings({ isolateByDefault: false })
  const dispatch = createDispatch(wb, { driver })
  const calls: string[] = []
  const backend: Backend = {
    rpc: async (endpoint, payload): Promise<RpcReply> => {
      calls.push(endpoint)
      try { return { ok: true, value: await dispatch(endpoint, payload) } } catch (e) { return { ok: false, error: (e as Error).message, code: (e as { code?: string }).code } }
    },
    events: async () => ({ seq: 7 }),
  }
  const server = createMcpServer({ backend, boardHtml: () => '<!doctype html><title>t</title>', version: 't' })
  const client = new Client({ name: 'test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return { wb, driver, client, calls }
}

test('mcp: board is a global entry with the page resource; runtime_* are for the page only; the model gets three read-only tools', async () => {
  const { client } = await setup()
  const { tools } = await client.listTools()
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
  assert.deepEqual(Object.keys(byName).sort(), ['board', 'issue_get', 'issues_list', 'runtime_command', 'runtime_events', 'runtime_read', 'todos_list'])
  const meta = byName.board!._meta as Record<string, any>
  assert.equal(meta.ui.resourceUri, BOARD_URI)
  assert.deepEqual(meta['openai/ui'], { entrypoints: [{ type: 'global' }] })
  for (const n of ['runtime_read', 'runtime_command', 'runtime_events']) assert.deepEqual((byName[n]!._meta as any).ui.visibility, ['app'])
  for (const n of ['board', 'runtime_read', 'runtime_events', 'todos_list', 'issues_list', 'issue_get']) assert.equal(byName[n]!.annotations?.readOnlyHint, true, n)
  assert.equal(byName.runtime_command!.annotations?.readOnlyHint, false)
  const res = await client.readResource({ uri: BOARD_URI })
  assert.equal(res.contents[0]!.mimeType, 'text/html;profile=mcp-app')
  assert.match(String((res.contents[0] as { text: string }).text), /^<!doctype html>/)
})

test('mcp: runtime_read only forwards read endpoints; runtime_command forwards actions and passes endpoint errors through', async () => {
  const { client, calls, wb } = await setup()
  const read = await client.callTool({ name: 'runtime_read', arguments: { endpoint: 'state' } })
  assert.equal((read.structuredContent as RpcReply).ok, true)
  const refused = await client.callTool({ name: 'runtime_read', arguments: { endpoint: 'issue.create', payload: { title: 'x' } } })
  assert.equal((refused.structuredContent as RpcReply).ok, false)
  assert.deepEqual(calls, ['state']) // the refused call never reached the backend
  const made = await client.callTool({ name: 'runtime_command', arguments: { endpoint: 'issue.create', payload: { title: '从 Codex 页面建的' } } })
  assert.equal((made.structuredContent as RpcReply).ok, true)
  assert.equal(wb.listIssues()[0]!.title, '从 Codex 页面建的')
  const bad = await client.callTool({ name: 'runtime_command', arguments: { endpoint: 'issue.create', payload: { title: ' ' } } })
  assert.deepEqual(bad.structuredContent, { ok: false, error: '标题不能为空', code: 'invalid' })
  const ev = await client.callTool({ name: 'runtime_events', arguments: { after: 3 } })
  assert.deepEqual(ev.structuredContent, { seq: 7 })
})

test('mcp: the model tools list to-dos and cards and read one card with its runs', async () => {
  const { client, wb, driver } = await setup()
  const todos = json(await client.callTool({ name: 'todos_list', arguments: {} }))
  assert.ok(todos.items.length > 0)
  assert.equal(todos.sources.zentao.mode, 'demo')
  const card = wb.createIssue({ title: '对账脚本幂等', projectId: wb.listProjects()[0]!.id })
  const { run } = await wb.startIssue(card.id)
  driver.emit({ type: 'turn.completed', runId: run.id, status: 'completed', finalText: '已加幂等键' })
  const list = json(await client.callTool({ name: 'issues_list', arguments: { status: 'in_review' } }))
  assert.deepEqual(list.map((i: { key: string; status: string }) => [i.key, i.status]), [[card.key, '待审核']])
  const one = json(await client.callTool({ name: 'issue_get', arguments: { idOrKey: card.key.toLowerCase() } }))
  assert.equal(one.title, '对账脚本幂等')
  assert.equal(one.runs.at(-1).finalText, '已加幂等键')
  const missing = await client.callTool({ name: 'issue_get', arguments: { idOrKey: 'WB-999' } })
  assert.equal(missing.isError, true)
})

test('page transport: reads go to runtime_read, actions and uploads to runtime_command, tool failures become { ok: false }', async () => {
  const sent: { name: string; arguments?: Record<string, unknown> }[] = []
  const app = {
    callServerTool: async (p: { name: string; arguments?: Record<string, unknown> }) => {
      sent.push(p)
      return p.name === 'runtime_command' && p.arguments?.endpoint === 'issue.stop'
        ? { isError: true, content: [{ type: 'text' as const, text: '本地服务没有启动起来' }] }
        : { content: [], structuredContent: { ok: true, value: 1 } }
    },
  }
  const t = mcpTransport(app as never)
  assert.deepEqual(await t.rpc('state', {}), { ok: true, value: 1 })
  await t.rpc('issue.start', { id: 'i1' })
  assert.deepEqual(await t.rpc('issue.stop', { id: 'i1' }), { ok: false, error: '本地服务没有启动起来' })
  await t.upload(new Blob(['hello'], { type: 'text/plain' }) as File)
  assert.deepEqual(sent.map((s) => [s.name, s.arguments?.endpoint]), [['runtime_read', 'state'], ['runtime_command', 'issue.start'], ['runtime_command', 'issue.stop'], ['runtime_command', 'upload']])
  assert.equal((sent[3]!.arguments!.payload as { base64: string }).base64, Buffer.from('hello').toString('base64'))
})
