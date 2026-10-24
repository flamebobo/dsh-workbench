import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The projects Codex itself knows: the `[projects."<path>"]` tables of its config.toml (Codex adds one when a folder is trusted
 * or opened). Read-only. Left out: anything inside the workbench's own data dir (demo repos, task worktrees) and folders that are not
 * git repositories (Codex also records its scratch chat folders there; the workbench only runs tasks in repositories).
 */
export function codexProjects(o: { codexHome?: string; exclude?: string } = {}): string[] {
  const file = join(o.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml')
  let text: string
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const out: string[] = []
  for (const m of text.matchAll(/^\[projects\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\]\s*$/gm)) {
    const path = m[1] !== undefined ? m[1].replace(/\\(["\\])/g, '$1') : m[2]!
    if (o.exclude && (path === o.exclude || path.startsWith(o.exclude + '/'))) continue
    if (existsSync(join(path, '.git')) && !out.includes(path)) out.push(path)
  }
  return out
}
