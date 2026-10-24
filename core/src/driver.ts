/** Host-agnostic agent driver. DSH implements it in host/, Codex later. core never imports a host package. */
export interface AgentDriver {
  id: 'dsh' | 'codex'
  listModels(): Promise<{ id: string; name: string; efforts?: { id: string; name: string; description?: string }[]; defaultEffort?: string }[]>
  /** Skills a task can be told to use explicitly. */
  listSkills(cwds?: string[]): Promise<{ name: string; description: string; source: string }[]>
  start(req: {
    runId: string
    cwd: string
    title: string
    prompt: string
    /** Run `/<command> <prompt>` through the host's command channel instead of a plain message. */
    command?: string
    /** Files to attach to the first message (host reads the bytes from `path`). */
    attachments?: { name: string; mediaType: string; path: string }[]
    profile: { presetId: string; model?: string; effort?: string; skills?: string[]; instructions: string }
  }): Promise<{ sessionId: string }>
  send(sessionId: string, text: string, mode: 'queue' | 'steer'): Promise<void>
  interrupt(sessionId: string): Promise<void>
  onEvent(cb: (e: DriverEvent) => void): () => void
}

export type DriverEvent =
  | { type: 'turn.started'; runId: string; sessionId: string }
  | { type: 'message'; runId: string; text: string }
  /** The agent stopped to wait for a human (plan approval, a question); the turn is still open. */
  | { type: 'awaiting.user'; runId: string; reason: string }
  | {
      type: 'turn.completed'
      runId: string
      status: 'completed' | 'interrupted' | 'failed'
      finalText?: string
      error?: string
    }
