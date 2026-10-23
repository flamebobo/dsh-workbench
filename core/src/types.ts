export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'] as const
export type Status = (typeof STATUSES)[number]

export type Source = 'zentao' | 'gitlab' | 'jenkins' | 'manual'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

/** One row of 我的待办, as produced by a connector (or the demo fixtures). */
export interface WorkItem {
  /** Source number shown in the table, e.g. BUG-4821, !11287, teleone-order #2145. Unique per source. */
  ref: string
  source: Source
  title: string
  priority: Priority
  /** Project name as the source knows it; matched against Project.name / ids. */
  project: string
  /** Source-side ids used to resolve a Project (all optional). */
  gitlabProjectId?: number
  zentaoProductId?: number
  jenkinsJob?: string
  /** Display status from the source system (已激活, 待评审, 失败…). */
  statusText: string
  due?: string
  description: string
  acceptance: string[]
  related: { label: string; detail?: string }[]
  url?: string
}

export interface Project {
  id: string
  name: string
  /** Absolute working directory; used as the DSH session cwd. */
  cwd: string
  gitlabProjectId?: number
  zentaoProductId?: number
  jenkinsJob?: string
}

export interface AgentProfile {
  id: string
  name: string
  description: string
  instructions: string
  model?: string
  builtin?: boolean
}

/** A file the user attached to a task. Bytes live in <data dir>/uploads/<id>; only this metadata is in the JSON. */
export interface Attachment {
  id: string
  name: string
  mediaType: string
  size: number
}

/** DSH composer commands that make sense as the first message of a task. */
export type CommandName = 'plan' | 'goal'

export interface Issue {
  id: string
  /** Short key shown on cards, WB-1, WB-2 … */
  key: string
  title: string
  description: string
  acceptance: string[]
  status: Status
  priority?: Priority
  /** Run the first message through this command (`/plan <prompt>` ...) instead of sending it as plain text. */
  command?: CommandName
  attachments?: Attachment[]
  agentId: string
  projectId?: string
  /** Set when the card was created from a work item; at most one card per (source, ref). */
  sourceRef?: { source: Source; ref: string }
  sessionId?: string
  /** Last error / block reason from the latest run. */
  note?: string
  createdAt: string
  updatedAt: string
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'interrupted'
export interface Run {
  id: string
  issueId: string
  agentId: string
  sessionId?: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  error?: string
  finalText?: string
}

export interface Data {
  version: 1
  seq: number
  /** Counter for card keys WB-1, WB-2 … (seq is shared with ids). */
  issueSeq?: number
  projects: Project[]
  issues: Issue[]
  agents: AgentProfile[]
  runs: Run[]
}
