// A stand-in for `codex app-server` in tests: JSON-RPC over stdio, no model calls.
// argv[3]: file every received message is appended to (one JSON per line), so tests can check what the driver sent.
// argv[2]: complete (default) | hang (turn stays open until turn/interrupt) | fail | approval (asks for an approval first) | crash
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const mode = process.argv[2] ?? 'complete'
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
const log = (m) => { if (process.argv[3]) appendFileSync(process.argv[3], JSON.stringify(m) + '\n') }
let threadId
const turnId = 'turn-1'
const turn = (status, error = null) => ({ id: turnId, items: [], status, error })

function runTurn() {
  send({ method: 'turn/started', params: { threadId, turn: turn('inProgress') } })
  if (mode === 'hang') return
  if (mode === 'crash') { setTimeout(() => process.exit(3), 20); return }
  send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: 'i1', text: '改好了，测试通过。' } } })
  if (mode === 'fail') send({ method: 'turn/completed', params: { threadId, turn: turn('failed', { message: '额度用完了' }) } })
  else send({ method: 'turn/completed', params: { threadId, turn: turn('completed') } })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  log(m)
  if (m.method === undefined) { // the driver answering our request
    if (m.id === 'approval-1') runTurn()
    return
  }
  switch (m.method) {
    case 'initialize': return send({ id: m.id, result: { userAgent: 'fake', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos' } })
    case 'initialized': return
    case 'model/list': return send({ id: m.id, result: m.params?.cursor
      ? { data: [{ id: 'gpt-b', model: 'gpt-b', displayName: 'GPT B', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '快' }], defaultReasoningEffort: 'low' }, { id: 'secret', model: 'secret', displayName: 'S', hidden: true, supportedReasoningEfforts: [] }], nextCursor: null }
      : { data: [{ id: 'gpt-a', model: 'gpt-a', displayName: 'GPT A', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '均衡' }, { reasoningEffort: 'high', description: '深' }], defaultReasoningEffort: 'medium' }], nextCursor: 'p2' } })
    case 'skills/list': return send({ id: m.id, result: { data: [{ cwd: m.params.cwds?.[0] ?? '', errors: [], skills: [
      { name: 'company-style', description: '公司规范', path: '/skills/company-style/SKILL.md', scope: 'repo', enabled: true },
      { name: 'off', description: '停用的', path: '/skills/off/SKILL.md', scope: 'user', enabled: false },
    ] }] } })
    case 'thread/start':
      threadId = 'thr-' + process.pid
      return send({ id: m.id, result: { thread: { id: threadId }, model: m.params.model ?? 'gpt-a', cwd: m.params.cwd } })
    case 'turn/start':
      send({ id: m.id, result: { turn: turn('inProgress') } })
      if (mode === 'approval') return send({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'c1', command: 'rm -rf /' } })
      return runTurn()
    case 'turn/interrupt':
      send({ id: m.id, result: {} })
      return send({ method: 'turn/completed', params: { threadId, turn: turn('interrupted') } })
    default: return send({ id: m.id, error: { code: -32601, message: `fake: no ${m.method}` } })
  }
})
