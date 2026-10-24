import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Data } from './types.ts'

/** `WORKBENCH_HOME` relocates the data dir (tests, a second DSH profile running side by side). */
export const dataDir = () => process.env.WORKBENCH_HOME || join(homedir(), '.workbench')
export const defaultDataPath = () => join(dataDir(), 'workbench.json')

/**
 * Data file versions. Bump `DATA_VERSION` and add the step that upgrades from the previous one to `migrations`; an old file is
 * copied to `<file>.v<old>.bak` first, then upgraded in order. A file from a NEWER plugin is refused instead of being rewritten
 * in a shape this version does not understand.
 */
export const DATA_VERSION = 3
const migrations: Record<number, (d: Data) => void> = {
  // 1 -> 2: the arrays and fields that later releases read without checking are always present
  1: (d) => {
    d.builds ??= []; d.hiddenTodos ??= []; d.issueSeq ??= d.issues.length
    for (const i of d.issues) { i.acceptance ??= []; i.attachments ??= [] }
  },
  // 2 -> 3: 完成时间. Nothing recorded when old cards were finished, so their last update stands in for it. That is an
  // approximation: a finished card edited afterwards (or given an MR) is dated by that later change, which is the very
  // inaccuracy doneAt exists to end for cards finished from now on.
  2: (d) => {
    for (const i of d.issues) if (i.status === 'done') i.doneAt ??= i.updatedAt
  },
}

export class DataVersionError extends Error {}

const empty = (): Data => ({ version: DATA_VERSION, seq: 0, projects: [], issues: [], agents: [], runs: [] })

/**
 * Whole-file JSON store: read once, mutate in memory, atomic write (tmp + rename) after every change.
 * ponytail: single process, whole-file rewrite; move to SQLite when data or concurrent writers grow.
 */
export class Store {
  data: Data
  readonly path: string
  /** Called after every persisted change with the data before and after; the workbench derives notifications from it. */
  onChange?: (before: Data, after: Data) => void
  constructor(path: string = defaultDataPath()) {
    this.path = path
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      this.data = { ...empty(), ...raw, version: Number(raw.version) || 1 } // a file without a version is the oldest shape
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      this.data = empty()
      return
    }
    this.upgrade()
  }

  private upgrade() {
    const from = Number(this.data.version) || 1
    if (from > DATA_VERSION) throw new DataVersionError(`数据文件 ${this.path} 来自更新的版本（数据版本 ${from}，当前插件只认识到 ${DATA_VERSION}）。请先把插件更新到最新版，数据没有被改动。`)
    if (from === DATA_VERSION) return
    copyFileSync(this.path, `${this.path}.v${from}.bak`)
    const draft = structuredClone(this.data)
    for (let v = from; v < DATA_VERSION; v++) migrations[v]?.(draft)
    draft.version = DATA_VERSION
    this.write(draft)
    this.data = draft
  }

  /** Apply a mutation and persist it. The mutator may throw to abort; nothing is written then. */
  update<T>(fn: (d: Data) => T): T {
    const draft: Data = structuredClone(this.data)
    const result = fn(draft)
    this.write(draft)
    const before = this.data
    this.data = draft
    try { this.onChange?.(before, draft) } catch { /* a listener must never undo or fail a saved change */ }
    return result
  }

  private write(d: Data) {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(d, null, 2))
    renameSync(tmp, this.path)
  }
}
