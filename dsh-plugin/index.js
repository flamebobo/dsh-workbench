/** Host half: step-1 smoke test (ping RPC + create a session and wait for turn/end). */
import { randomUUID } from 'node:crypto'

export const inject = [
  'connection', 'agents', 'agentDefaultModel', 'agentPresets',
  'permissionPresets', 'sessionTitle', 'workspaceRegistry',
]

export function apply(ctx) {
  const waiters = new Map() // sessionId -> resolve(turn/end reason)
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    ctx.logger.info(`workbench: turn/end ${session.id} ${JSON.stringify(event.data?.reason ?? event.reason)}`)
    waiters.get(session.id)?.(event.data?.reason ?? event.reason)
  })

  async function selfTest(cwd) {
    const selected = ctx.agentDefaultModel.currentSelection()
    const preset = await ctx.agentPresets.resolve('standard')
    const scope = await ctx.agentPresets.acquireScope(preset.id)
    const workspace = await ctx.workspaceRegistry.create(cwd)
    const sessionId = `workbench-${randomUUID()}`
    let handle
    try {
      handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: workspace.path, agentPreset: preset.id },
        agentOptions: { provider: selected.provider, model: selected.model },
        setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset.id) },
      })
    } finally { await scope[Symbol.asyncDispose]() }
    await workspace.attachSession(sessionId)
    ctx.sessionTitle.rename(handle.agent.session, '工作台自检')
    const done = new Promise((resolve) => waiters.set(sessionId, resolve))
    handle.agent.followup({
      id: randomUUID(), role: 'user',
      content: [{ type: 'text', text: '你好' }],
      source: { kind: 'user' },
    })
    const reason = await Promise.race([done, new Promise((r) => setTimeout(() => r('timeout'), 120_000))])
    waiters.delete(sessionId)
    return { sessionId, reason }
  }

  ctx.effect(() => ctx.connection.rpc.handle('/workbench', async (endpoint, payload) => {
    try {
      if (endpoint === 'ping') return { ok: true, value: { pong: true, at: Date.now() } }
      if (endpoint === 'selftest') return { ok: true, value: await selfTest(String(payload?.cwd ?? process.cwd())) }
      return { ok: false, error: { code: 'workbench/unknown', message: endpoint, details: {} } }
    } catch (e) {
      ctx.logger.warn('workbench rpc failed', e)
      return { ok: false, error: { code: 'workbench/error', message: String(e?.stack ?? e), details: {} } }
    }
  }))
}
