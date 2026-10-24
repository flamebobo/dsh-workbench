export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked'] as const
export type Status = (typeof STATUSES)[number]

export type Source = 'zentao' | 'gitlab' | 'jenkins' | 'sparkin' | 'manual'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

/** One row of 我的待办, as produced by a connector (or the demo fixtures). */
export interface WorkItem {
  /** Source number shown in the table, e.g. BUG-4821, team/order!11287, teleone-order #2145. Unique per source. */
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
  /** Sparkin project / task this item is booked on (Sparkin items only). */
  sparkinProjectId?: string
  sparkinTaskId?: string
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
  /** Shell command that verifies work in this project (e.g. `npm test`); run on demand and after an agent finishes. */
  testCmd?: string
  /** Branch tasks start from and merge requests target; empty = origin's default branch. */
  baseBranch?: string
  /** Run each task on its own branch + worktree. Unset = follow the plugin setting. */
  isolate?: boolean
  /** Skills loaded for every task in this project (company conventions); added to the agent's own skills at 开工. */
  skills?: string[]
}

export interface AgentProfile {
  id: string
  name: string
  description: string
  instructions: string
  model?: string
  /** Reasoning effort id of the chosen model (e.g. high); empty = the model's default. */
  effort?: string
  /** Skills explicitly loaded for every task this agent runs (`/skill-name` in the first message). */
  skills?: string[]
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

/** One run of a project's test command against a task's work. */
export interface Check {
  id: string
  cmd: string
  state: 'running' | 'passed' | 'failed'
  code?: number | null
  output: string
  at: string
  ms?: number
}

/** A Zentao bug resolved from the workbench: the comment that was posted and the status it was moved to. */
export interface ZentaoWriteBack { at: string; comment: string; status: 'resolved'; demo?: boolean }

export interface MergeRequest { url: string; iid: number; createdAt: string }

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
  /** Deadline, YYYY-MM-DD; '' = cleared on purpose (a card from a source system otherwise shows the source's date). */
  due?: string
  /** Related info lines shown in the to-do detail; undefined = the source system's own. */
  related?: { label: string; detail?: string }[]
  /** Sparkin task a card from the Sparkin to-do list is booked on; pre-selects the time-sheet task. */
  sparkinTaskId?: string
  writeBack?: ZentaoWriteBack
  /** Task isolation: the branch and git worktree the agent worked in (absent = the project directory itself). */
  branch?: string
  worktree?: string
  baseBranch?: string
  baseSha?: string
  checks?: Check[]
  mr?: MergeRequest
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

/** What the update address said at `checkedAt`. */
export interface UpdateInfo { current: string; latest?: string; newer: boolean; url?: string; notes?: string; checkedAt: string; error?: string }

export interface Data {
  /** Shape of this file; see `migrations` in store.ts. */
  version: number
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
  settings?: Partial<import('./settings.ts').PluginSettings>
  /** Random id for anonymous statistics (never derived from the user or machine). */
  clientId?: string
  /** Latest result of the update check (kept so the banner survives a restart). */
  update?: UpdateInfo
  /** Source items whose card the user deleted on purpose: the board sync must not bring them back. */
  unsynced?: { source: Source; ref: string }[]
  statsReport?: { at: string; ok: boolean; error?: string }
  hiddenTodos?: { source: Source; ref: string; at: string }[]
}
