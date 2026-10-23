import type { AgentDriver, DriverEvent } from '../src/driver.ts'

export class FakeDriver implements AgentDriver {
  id = 'dsh' as const
  started: Parameters<AgentDriver['start']>[0][] = []
  failStart?: Error
  private cbs = new Set<(e: DriverEvent) => void>()
  async listModels() { return [{ id: 'm', name: 'm' }] }
  async start(req: Parameters<AgentDriver['start']>[0]) {
    if (this.failStart) throw this.failStart
    this.started.push(req)
    return { sessionId: `sess-${req.runId}` }
  }
  async send() {}
  async interrupt() {}
  onEvent(cb: (e: DriverEvent) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb) }
  emit(e: DriverEvent) { this.cbs.forEach((cb) => cb(e)) }
}
