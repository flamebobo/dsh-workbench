import type { Source } from './types.ts'

/** Everything the plugin lets you tune, edited on the 设置 → 插件设置 page and kept in the data file. */
export interface PluginSettings {
  /** How many agents auto-run keeps working at once. */
  autoRunConcurrency: number
  /** How often (seconds) the Host re-checks the auto-run queue. */
  autoRunPollSeconds: number
  /** How often (seconds) 我的待办 re-pulls Zentao / GitLab / Jenkins while open. */
  todoRefreshSeconds: number
  /** Hours pre-filled when reporting time to Sparkin. */
  defaultHours: number
  maxUploadMB: number
  /** Max files an `@` search shows. */
  fileSearchLimit: number
  /** DSH permission preset new sessions start with. */
  permissionPreset: 'workspace-write' | 'danger-full-access'
  /** Agent picked by default when starting a to-do from each source. */
  defaultAgents: Record<Source, string>
  /** Run each task on its own git branch + worktree (projects that are git repos). */
  isolateByDefault: boolean
  branchPrefix: string
  /** Run the project's test command automatically when an agent finishes. */
  autoTestOnReview: boolean
  testTimeoutSeconds: number
  /** A card waiting in 待审核 moves to 已完成 by itself once its tests pass (needs a test command; otherwise you accept it). */
  autoDoneOnPass: boolean
  /** Finished Zentao bugs: ask with a comment draft first, or resolve them in Zentao straight away. */
  zentaoWriteBack: 'confirm' | 'auto'
  /** The first-run guide has been completed or skipped. */
  onboarded: boolean
  /** Extra directories of skills (`<dir>/<name>/SKILL.md`) offered to DSH and to projects, e.g. the company convention pack. */
  skillRoots: string[]
  /** Desktop notification when a card needs you (待审核 / 已阻塞) or a Zentao write-back completes. */
  desktopNotify: boolean
  /** Anonymous usage counts are sent to `statsReportUrl` about once a day. Off until the user turns it on and sets an address. */
  statsReportEnabled: boolean
  statsReportUrl: string
  /** Address that says which plugin version is newest (see core/src/update.ts for the shape). Empty = never check. */
  updateCheckUrl: string
}

export const DEFAULT_SETTINGS: PluginSettings = {
  autoRunConcurrency: 1, autoRunPollSeconds: 5, todoRefreshSeconds: 60, defaultHours: 1, maxUploadMB: 25, fileSearchLimit: 30,
  permissionPreset: 'workspace-write',
  defaultAgents: { zentao: 'fullstack', gitlab: 'reviewer', jenkins: 'build-fixer', sparkin: 'fullstack', manual: 'fullstack' },
  isolateByDefault: true, branchPrefix: 'wb/', autoTestOnReview: true, testTimeoutSeconds: 600,
  autoDoneOnPass: true, zentaoWriteBack: 'confirm', onboarded: false, skillRoots: [], desktopNotify: true,
  statsReportEnabled: false, statsReportUrl: '', updateCheckUrl: '',
}

const num = (v: unknown, lo: number, hi: number, fallback: number, step = 1) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n / step) * step)) : fallback
}

/** Clamp and complete whatever was saved; unknown or broken values fall back to the defaults. */
export function normalizeSettings(input: Partial<PluginSettings> | undefined): PluginSettings {
  const d = DEFAULT_SETTINGS
  const i = input ?? {}
  const prefix = typeof i.branchPrefix === 'string' ? i.branchPrefix.trim() : d.branchPrefix
  return {
    autoRunConcurrency: num(i.autoRunConcurrency, 1, 5, d.autoRunConcurrency),
    autoRunPollSeconds: num(i.autoRunPollSeconds, 2, 60, d.autoRunPollSeconds),
    todoRefreshSeconds: num(i.todoRefreshSeconds, 15, 3600, d.todoRefreshSeconds),
    defaultHours: num(i.defaultHours, 0.5, 24, d.defaultHours, 0.5),
    maxUploadMB: num(i.maxUploadMB, 1, 200, d.maxUploadMB),
    fileSearchLimit: num(i.fileSearchLimit, 10, 100, d.fileSearchLimit),
    permissionPreset: i.permissionPreset === 'danger-full-access' ? 'danger-full-access' : 'workspace-write',
    defaultAgents: { ...d.defaultAgents, ...Object.fromEntries(Object.entries(i.defaultAgents ?? {}).filter(([, v]) => typeof v === 'string' && v)) } as PluginSettings['defaultAgents'],
    isolateByDefault: typeof i.isolateByDefault === 'boolean' ? i.isolateByDefault : d.isolateByDefault,
    // a valid git ref prefix: letters, digits, `/`, `-`, `_`, `.`; never starting with `-` or containing `..`
    branchPrefix: /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(prefix) && !prefix.includes('..') ? prefix : d.branchPrefix,
    autoTestOnReview: typeof i.autoTestOnReview === 'boolean' ? i.autoTestOnReview : d.autoTestOnReview,
    testTimeoutSeconds: num(i.testTimeoutSeconds, 10, 3600, d.testTimeoutSeconds),
    autoDoneOnPass: typeof i.autoDoneOnPass === 'boolean' ? i.autoDoneOnPass : d.autoDoneOnPass,
    zentaoWriteBack: i.zentaoWriteBack === 'auto' ? 'auto' : 'confirm',
    onboarded: i.onboarded === true,
    skillRoots: Array.isArray(i.skillRoots) ? [...new Set(i.skillRoots.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20) : d.skillRoots,
    desktopNotify: typeof i.desktopNotify === 'boolean' ? i.desktopNotify : d.desktopNotify,
    statsReportEnabled: i.statsReportEnabled === true,
    updateCheckUrl: typeof i.updateCheckUrl === 'string' && /^https?:\/\/\S+$/.test(i.updateCheckUrl.trim()) ? i.updateCheckUrl.trim() : '',
    statsReportUrl: typeof i.statsReportUrl === 'string' && /^https?:\/\/\S+$/.test(i.statsReportUrl.trim()) ? i.statsReportUrl.trim() : '',
  }
}
