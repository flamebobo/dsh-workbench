import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { remoteUrl } from './git.ts'

export interface RepoCandidate {
  path: string
  name: string
  remote?: string
  /** `group/project` parsed from the remote, when it points at the configured GitLab host. */
  gitlabPath?: string
  gitlabProjectId?: number
  testCmd?: string
  /** Already a project in the workbench. */
  known: boolean
}

const SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'vendor', 'Library', 'Applications', 'AppData'])

/** Directories people usually keep code in; only the ones that exist are offered. */
export const suggestRoots = (home = homedir()) =>
  ['code', 'work', 'projects', 'dev', 'src', 'git', 'workspace', 'IdeaProjects', 'WebstormProjects', 'Documents', 'Documents/code'].map((d) => join(home, d)).filter(existsSync)

export const expandHome = (p: string, home = homedir()) => (p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p)

/** `git@host:group/proj.git`, `ssh://git@host:2222/group/proj.git`, `https://host/group/proj.git` -> { host, path }. */
export function parseRemote(url: string): { host: string; path: string } | undefined {
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+?)(?:\.git)?\/?$/.exec(url)
  if (scp) return { host: scp[1]!, path: scp[2]! }
  try {
    const u = new URL(url)
    return { host: u.hostname, path: u.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '') }
  } catch { return undefined }
}

/** The command that most likely verifies a project, judged from its manifest. Undefined when unsure. */
export function guessTestCmd(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: { test?: string } }
    const t = pkg.scripts?.test
    if (t && !/no test specified/.test(t)) return 'npm test'
  } catch { /* no package.json */ }
  if (existsSync(join(dir, 'go.mod'))) return 'go test ./...'
  if (existsSync(join(dir, 'Cargo.toml'))) return 'cargo test'
  return undefined
}

/** Git repositories under `roots`, at most `depth` levels down; a repo is never searched inside. */
export async function findRepos(roots: string[], depth = 2, max = 80): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, level: number): Promise<void> => {
    if (found.length >= max) return
    if (existsSync(join(dir, '.git'))) { found.push(dir); return }
    if (level >= depth) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) await walk(join(dir, e.name), level + 1)
    }
  }
  for (const r of roots) await walk(resolve(expandHome(r.trim())), 0)
  return [...new Set(found)]
}

export async function describeRepo(dir: string, known: Set<string>): Promise<RepoCandidate> {
  const remote = await remoteUrl(dir)
  return { path: dir, name: basename(dir), remote, testCmd: guessTestCmd(dir), known: known.has(dir) }
}
