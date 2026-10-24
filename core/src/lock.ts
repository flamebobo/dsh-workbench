import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface LockOwner { pid: number; startedAt: string; nonce: string }

export class LockError extends Error {
  readonly owner?: LockOwner
  constructor(message: string, owner?: LockOwner) { super(message); this.owner = owner }
}

const START_TOLERANCE_MS = 10_000 // `ps` reports start times to the second; a reused pid starts far later than the owner did

/** When the process with this pid started, or undefined where that can't be told (Windows, ps missing). */
function processStart(pid: number): number | undefined {
  if (process.platform === 'win32') return undefined
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim()
    const t = Date.parse(out)
    return Number.isNaN(t) ? undefined : t
  } catch { return undefined }
}

/** The recorded owner is still the process that wrote the lock: the pid exists and (where it can be checked) started when it said. */
function alive(o: LockOwner): boolean {
  try { process.kill(o.pid, 0) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPERM') return false }
  const started = processStart(o.pid)
  // ponytail: on Windows only the pid is checked, so a reused pid keeps the lock until that process exits
  return started === undefined || Math.abs(started - Date.parse(o.startedAt)) < START_TOLERANCE_MS
}

function parse(raw: string): LockOwner | undefined {
  try {
    const o = JSON.parse(raw)
    return Number.isInteger(o?.pid) && typeof o.startedAt === 'string' ? o : undefined
  } catch { return undefined }
}

/**
 * Single-writer lock on a data directory: `<dir>/workbench.lock` records the owner's pid and start time. A live owner keeps it
 * (LockError); a dead one, a pid that now belongs to a different process, or this same process loading again is taken over.
 * Returns the release function; releasing only removes the lock this call wrote.
 * ponytail: the takeover of a stale lock re-reads it before deleting, but two processes taking over the same stale lock in the
 * same instant could both win; an OS-level file lock would close that if it ever matters.
 */
export function acquireLock(dir: string): () => void {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'workbench.lock')
  const mine = JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(), nonce: randomUUID() } satisfies LockOwner)
  const release = () => { try { if (readFileSync(path, 'utf8') === mine) unlinkSync(path) } catch { /* already gone */ } }
  for (let attempt = 0; attempt < 5; attempt++) {
    try { writeFileSync(path, mine, { flag: 'wx', mode: 0o600 }); return release } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    let raw: string
    try { raw = readFileSync(path, 'utf8') } catch { continue } // released meanwhile: try again
    const owner = parse(raw)
    if (owner && owner.pid !== process.pid && alive(owner)) {
      throw new LockError(`数据目录 ${dir} 正被另一个进程使用（PID ${owner.pid}，${owner.startedAt} 启动）。同一个数据目录只能由一个工作台进程写入：请先关闭那个进程，或用 WORKBENCH_HOME 换一个数据目录。`, owner)
    }
    try { if (readFileSync(path, 'utf8') === raw) unlinkSync(path) } catch { /* someone else took it over first */ }
  }
  throw new LockError(`没能获取数据目录 ${dir} 的锁，请稍后重试`)
}
