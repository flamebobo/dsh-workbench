import type { UpdateInfo } from './types.ts'

/** -1 / 0 / 1 for `a` vs `b`; numeric parts compared in order, a pre-release (`-rc.1`) sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => { const [core = '', pre] = v.trim().replace(/^v/, '').split('-', 2); return { n: core.split('.').map((x) => Number.parseInt(x, 10) || 0), pre } }
  const x = parse(a), y = parse(b)
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) {
    const d = (x.n[i] ?? 0) - (y.n[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  if (x.pre === y.pre) return 0
  return !x.pre ? 1 : !y.pre ? -1 : x.pre < y.pre ? -1 : 1
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Ask the update address (`GET` -> `{ "version": "0.3.0", "url": "https://…/workbench-plugin-0.3.0.zip", "notes": "…" }`) what is
 * newest. Never throws: a failure is the result, so the page can say so instead of the Host logging and the banner staying stale.
 */
export async function checkForUpdate(fetchImpl: Fetch, url: string, current: string, now: Date): Promise<UpdateInfo> {
  const checkedAt = now.toISOString()
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
    if (!res.ok) return { current, newer: false, checkedAt, error: `HTTP ${res.status}` }
    const j = (await res.json()) as { version?: unknown; url?: unknown; notes?: unknown }
    if (typeof j.version !== 'string' || !/^v?\d+(\.\d+)*(-[\w.]+)?$/.test(j.version)) return { current, newer: false, checkedAt, error: '更新地址返回的内容里没有有效的 version' }
    const link = typeof j.url === 'string' && /^https?:\/\//.test(j.url) ? j.url : undefined // only a web link is ever shown as a download
    return { current, latest: j.version.replace(/^v/, ''), newer: compareVersions(j.version, current) > 0, url: link, notes: typeof j.notes === 'string' ? j.notes.slice(0, 1000) : undefined, checkedAt }
  } catch (e) { return { current, newer: false, checkedAt, error: String((e as Error).message ?? e) } }
}
