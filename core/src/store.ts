import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Data } from './types.ts'

export const defaultDataPath = () => join(homedir(), '.workbench', 'workbench.json')

const empty = (): Data => ({ version: 1, seq: 0, projects: [], issues: [], agents: [], runs: [] })

/**
 * Whole-file JSON store: read once, mutate in memory, atomic write (tmp + rename) after every change.
 * ponytail: single process, whole-file rewrite; move to SQLite when data or concurrent writers grow.
 */
export class Store {
  data: Data
  readonly path: string
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
    this.data = draft
    return result
  }

  private write(d: Data) {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(d, null, 2))
    renameSync(tmp, this.path)
  }
}
