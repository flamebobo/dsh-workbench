import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Run git; resolves with stdout, rejects with git's own message. Never prompts (a hung push would hang the Host). */
export function git(cwd: string, args: string[], o: { timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd, timeout: o.timeoutMs ?? 60_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout)
      const msg = String(stderr || stdout || err.message).trim().split('\n').slice(-6).join('\n')
      reject(new Error(msg || String(err.message)))
    })
  })
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  if (!existsSync(cwd)) return false
  try { return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true' } catch { return false }
}

export const headSha = async (cwd: string) => (await git(cwd, ['rev-parse', 'HEAD'])).trim()
export async function branchExists(cwd: string, branch: string) {
  try { await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); return true } catch { return false }
}

/** The branch tasks branch off: origin's default branch when known, else the branch that is checked out. */
export async function defaultBase(cwd: string): Promise<string> {
  try { return (await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim().replace(/^origin\//, '') } catch { /* no remote HEAD */ }
  return (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

export async function remoteUrl(cwd: string): Promise<string | undefined> {
  try { return (await git(cwd, ['remote', 'get-url', 'origin'])).trim() || undefined } catch { return undefined }
}

/** `wb/wb-12-fix-callback`: ascii letters and digits of the title only, so the ref is always valid. */
export const branchName = (prefix: string, key: string, title: string) => {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '')
  return `${prefix}${key.toLowerCase()}${slug ? `-${slug}` : ''}`
}

export async function addWorktree(repo: string, branch: string, path: string, base: string) {
  if (await branchExists(repo, branch)) await git(repo, ['worktree', 'add', path, branch])
  else await git(repo, ['worktree', 'add', '-b', branch, path, base])
}

/** Removes the checkout only when it is clean; a worktree holding uncommitted work is left alone. */
export async function removeWorktree(repo: string, path: string) {
  try { await git(repo, ['worktree', 'remove', path]) } catch { /* dirty or already gone: keep it */ }
}

export interface FileChange { path: string; status: 'A' | 'M' | 'D' | 'R' | '?'; additions: number; deletions: number; patch: string }
const MAX_PATCH = 200_000

/** Everything that differs from `base` in the working tree: committed, staged, unstaged and new files. */
export async function changes(cwd: string, base: string): Promise<{ files: FileChange[]; truncated: boolean }> {
  await git(cwd, ['add', '-N', '.']).catch(() => {}) // make untracked files show up in the diff
  const [names, nums, patch] = await Promise.all([
    git(cwd, ['diff', '--name-status', base]), git(cwd, ['diff', '--numstat', base]), git(cwd, ['diff', '--no-color', base]),
  ])
  const stat = new Map(nums.trim().split('\n').filter(Boolean).map((l) => { const [a, d, ...p] = l.split('\t'); return [p.join('\t'), [Number(a) || 0, Number(d) || 0]] as const }))
  const patches = new Map<string, string>()
  let truncated = false
  let used = 0
  for (const chunk of patch.split(/^diff --git /m).slice(1)) {
    const path = /^a\/(.+?) b\/(.+)$/m.exec(chunk.split('\n')[0]!)?.[2] ?? ''
    const text = `diff --git ${chunk}`
    if (used + text.length > MAX_PATCH) { truncated = true; patches.set(path, '（改动太大，已省略；请在终端用 git diff 查看）'); continue }
    used += text.length; patches.set(path, text)
  }
  const files = names.trim().split('\n').filter(Boolean).map((l) => {
    const [st, ...p] = l.split('\t'); const path = p.at(-1)!
    const [additions, deletions] = stat.get(path) ?? [0, 0]
    return { path, status: (st![0] as FileChange['status']) ?? '?', additions, deletions, patch: patches.get(path) ?? '' }
  })
  return { files, truncated }
}

/** Commit everything in the worktree (a no-op when clean). Falls back to a neutral identity when git has none configured. */
export async function commitAll(cwd: string, message: string): Promise<boolean> {
  await git(cwd, ['add', '-A'])
  try { await git(cwd, ['diff', '--cached', '--quiet']); return false } catch { /* there is something staged */ }
  const hasId = await git(cwd, ['config', 'user.email']).then((s) => !!s.trim()).catch(() => false)
  await git(cwd, [...(hasId ? [] : ['-c', 'user.name=研发工作台', '-c', 'user.email=workbench@localhost']), 'commit', '-m', message])
  return true
}

export async function commitsAhead(cwd: string, base: string) { return Number((await git(cwd, ['rev-list', '--count', `${base}..HEAD`])).trim()) || 0 }
export const push = (cwd: string, branch: string) => git(cwd, ['push', '-u', 'origin', branch], { timeoutMs: 180_000 })

/** Run a shell command (the project's test command) and collect the tail of its output. */
export function runShell(cmd: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string; timedOut: boolean; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(cmd, { cwd, shell: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } })
    let out = ''
    const add = (b: Buffer) => { out = (out + b.toString()).slice(-20_000) }
    child.stdout.on('data', add); child.stderr.on('data', add)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, output: `${out}\n${e.message}`.trim(), timedOut, ms: Date.now() - t0 }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output: out.trim(), timedOut, ms: Date.now() - t0 }) })
  })
}
