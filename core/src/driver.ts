/** Host-agnostic agent driver. DSH implements it in host/, Codex later. core never imports a host package. */
export interface AgentDriver {
  id: 'dsh' | 'codex'
  listModels(): Promise<{ id: string; name: string }[]>
  start(req: {
    runId: string
    cwd: string
    title: string
    prompt: string
    profile: { presetId: string; model?: string; instructions: string }
  }): Promise<{ sessionId: string }>
  send(sessionId: string, text: string, mode: 'queue' | 'steer'): Promise<void>
  interrupt(sessionId: string): Promise<void>
  onEvent(cb: (e: DriverEvent) => void): () => void
}

export type DriverEvent =
  | { type: 'turn.started'; runId: string; sessionId: string }
  | { type: 'message'; runId: string; text: string }
  | {
      type: 'turn.completed'
      runId: string
      status: 'completed' | 'interrupted' | 'failed'
      finalText?: string
      error?: string
    }
