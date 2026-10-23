import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'out', 'coverage', '__pycache__', 'vendor'])
const MAX_FILES = 20000
const MAX_DEPTH = 10

/** Relative paths of the files under `root` (no dot-dirs, no build/dependency dirs, symlinks not followed). */
export function listFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), r, depth + 1) } else if (e.isFile()) out.push(r)
    }
  }
  walk(root, '', 0)
  return out
}

/** -1 = no match. A name hit beats a path hit beats a scattered subsequence ("pcb" -> pay-callback.js). */
function score(path: string, q: string): number {
  const p = path.toLowerCase()
  const base = p.slice(p.lastIndexOf('/') + 1)
  if (base.startsWith(q)) return 1200 - p.length
  if (base.includes(q)) return 1000 - base.indexOf(q) * 5 - p.length
  if (p.includes(q)) return 800 - p.indexOf(q) - p.length
  let i = 0, last = -2, s = 0
  for (let k = 0; k < p.length && i < q.length; k++) {
    if (p[k] !== q[i]) continue
    s += (k === last + 1 ? 8 : 1) + (k === 0 || '/._-'.includes(p[k - 1]!) ? 5 : 0)
    last = k; i++
  }
  return i === q.length ? Math.min(700, s * 4) - p.length * 0.1 : -1
}

export function fuzzy(files: string[], query: string, limit = 30): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '')
  if (!q) return [...files].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length).slice(0, limit)
  return files.map((f) => [f, score(f, q)] as const).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([f]) => f)
}

/** `@path` mentions in free text that point at a real file inside `root` (anything else, including `..` escapes, is ignored). */
export function mentionedFiles(root: string, text: string): string[] {
  const base = resolve(root)
  const found = new Set<string>()
  for (const m of text.matchAll(/(?:^|\s)@([^\s@，。、；：！？（）【】《》“”‘’,;:!?()<>"'`]+)/gu)) {
    const rel = m[1]!.replace(/\.+$/, '')
    const abs = resolve(base, rel)
    if (abs.startsWith(base + sep) && existsSync(abs) && statSync(abs).isFile()) found.add(abs.slice(base.length + 1).split(sep).join('/'))
  }
  return [...found]
}
