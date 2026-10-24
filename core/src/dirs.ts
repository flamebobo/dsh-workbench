import { existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expandHome } from './onboarding.ts'

export interface DirListing {
  path: string
  /** Absent at the filesystem root. */
  parent?: string
  home: string
  /** Subdirectories (dot-directories only with `hidden`), git repositories flagged. */
  entries: { name: string; path: string; isGit: boolean }[]
  /** Quick jumps: the home directory and whatever the host knows as the user's projects (existing directories only). */
  places: { label: string; path: string }[]
}

/**
 * One directory level for the page's folder picker (a sandboxed page cannot open a native dialog). Starts at `path` when it is
 * a directory, else its nearest existing parent, else the home directory. Unreadable directories list as empty.
 */
export async function listDirs(path: string | undefined, o: { hidden?: boolean; hints?: string[] } = {}): Promise<DirListing> {
  const home = homedir()
  let dir = resolve(expandHome(path?.trim() || home))
  while (!(existsSync(dir) && statSync(dir).isDirectory())) {
    const up = dirname(dir)
    if (up === dir) { dir = home; break }
    dir = up
  }
  let names: string[] = []
  try { names = (await readdir(dir, { withFileTypes: true })).filter((e) => (e.isDirectory() || (e.isSymbolicLink() && isDir(join(dir, e.name)))) && (o.hidden || !e.name.startsWith('.'))).map((e) => e.name) } catch { /* unreadable */ }
  names.sort((a, b) => a.localeCompare(b))
  const up = dirname(dir)
  const places = [{ label: '主目录', path: home }, ...(o.hints ?? []).filter(isDir).slice(0, MAX_PLACES).map((p) => ({ label: p.split(/[\\/]/).filter(Boolean).at(-1) ?? p, path: p }))]
  return {
    path: dir, parent: up === dir ? undefined : up, home, places,
    entries: names.map((name) => ({ name, path: join(dir, name), isGit: existsSync(join(dir, name, '.git')) })),
  }
}

const MAX_PLACES = 12

function isDir(p: string) { try { return statSync(p).isDirectory() } catch { return false } }
