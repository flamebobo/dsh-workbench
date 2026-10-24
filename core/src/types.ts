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
  sparkinProjectId?: string
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

/** Hours booked on a Sparkin task for a finished card. */
export interface Timesheet {
  hours: number
  /** Work date, YYYY-MM-DD. */
  date: string
  sparkinTaskId: string
  sparkinTaskName: string
  entryId: string
  reportedAt: string
  demo?: boolean
}

export interface Issue {
  id: string
  /** Short key shown on cards, WB-1, WB-2 … */
  key: string
  title: string
  description: string
  acceptance: string[]
  status: Status
  /** Position in its column (1..n, top first). Auto-run takes the 待办 column from the top. */
  order?: number
  priority?: Priority
  /** Run the first message through this command (`/plan <prompt>` ...) instead of sending it as plain text. */
  command?: CommandName
  attachments?: Attachment[]
  /** Task chain: the card to do after this one (its summary is passed on when that card starts). */
  nextId?: string
  /** Hidden from the board by default; the card and its history are kept. */
  archivedAt?: string
  timesheet?: Timesheet
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

export type BuildState = 'queued' | 'running' | 'success' | 'failure' | 'unstable' | 'aborted' | 'error'

/** One Jenkins build triggered from the workbench to verify a batch of cards. */
export interface Build {
  id: string
  job: string
  params?: Record<string, string>
  issueIds: string[]
  state: BuildState
  /** True when Jenkins is not configured: the build is simulated so the flow can be demonstrated. */
  demo?: boolean
  queueUrl?: string
  buildUrl?: string
  number?: number
  error?: string
  createdAt: string
  updatedAt: string
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
  builds?: Build[]
  /** To-do rows from Zentao / GitLab / Jenkins the user archived (the source still lists them). */
  /** Auto-run: cards in 待办 are started one after another, top to bottom, with no click. */
  autoRun?: boolean
  hiddenTodos?: { source: Source; ref: string; at: string }[]
}
