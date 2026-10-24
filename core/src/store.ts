import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Data } from './types.ts'

/** `WORKBENCH_HOME` relocates the data dir (tests, a second DSH profile running side by side). */
export const dataDir = () => process.env.WORKBENCH_HOME || join(homedir(), '.workbench')
export const defaultDataPath = () => join(dataDir(), 'workbench.json')

const empty = (): Data => ({ version: 1, seq: 0, projects: [], issues: [], agents: [], runs: [] })

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
      this.data = { ...empty(), ...JSON.parse(readFileSync(path, 'utf8')) }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      this.data = empty()
    }
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
