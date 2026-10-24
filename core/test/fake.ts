import type { AgentDriver, DriverEvent } from '../src/driver.ts'

export class FakeDriver implements AgentDriver {
  id = 'dsh' as const
  started: Parameters<AgentDriver['start']>[0][] = []
  failStart?: Error
  private cbs = new Set<(e: DriverEvent) => void>()
  async listModels() { return [{ id: 'm', name: 'm', efforts: [{ id: 'high', name: 'High' }] }] }
  async listSkills() { return [{ name: 'find-skills', description: 'd', source: 'bundled' }] }
  async start(req: Parameters<AgentDriver['start']>[0]) {
    if (this.failStart) throw this.failStart
    this.started.push(req)
    return { sessionId: `sess-${req.runId}` }
  }
  async send() {}
  interrupted: string[] = []
  /** Set to hold interrupt() open (a slow host), to test overlapping clicks. */
  interruptDelayMs = 0
  failInterrupt?: Error
  async interrupt(sessionId: string) {
    if (this.interruptDelayMs) await new Promise((r) => setTimeout(r, this.interruptDelayMs))
    if (this.failInterrupt) throw this.failInterrupt
    this.interrupted.push(sessionId)
  }
  onEvent(cb: (e: DriverEvent) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb) }
  emit(e: DriverEvent) { this.cbs.forEach((cb) => cb(e)) }
}
