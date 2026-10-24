import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, Workbench, guessTestCmd, parseRemote } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'ignore' })
function repo(root: string, name: string, remote?: string, files: Record<string, string> = {}) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q')
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c)
  if (remote) git(dir, 'remote', 'add', 'origin', remote)
  return dir
}

test('remote urls of every common shape are parsed; test command is guessed from the manifest', () => {
  assert.deepEqual(parseRemote('git@gitlab.corp.com:pay/payment-core.git'), { host: 'gitlab.corp.com', path: 'pay/payment-core' })
  assert.deepEqual(parseRemote('https://gitlab.corp.com/pay/sub/api.git'), { host: 'gitlab.corp.com', path: 'pay/sub/api' })
  assert.deepEqual(parseRemote('ssh://git@gitlab.corp.com:2222/pay/api.git'), { host: 'gitlab.corp.com', path: 'pay/api' })
  assert.equal(parseRemote('not a url'), undefined)
  const d = mkdtempSync(join(tmpdir(), 'wb-guess-'))
  assert.equal(guessTestCmd(d), undefined)
  writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }))
  assert.equal(guessTestCmd(d), undefined) // npm's placeholder is not a test command
  writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
  assert.equal(guessTestCmd(d), 'npm test')
})

test('scan finds repos (not inside repos or node_modules), matches GitLab ids from the remote, and import skips known projects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-onb-'))
  const root = join(dir, 'code')
  const a = repo(root, 'payment-core', 'git@gitlab.corp.com:pay/payment-core.git', { 'package.json': JSON.stringify({ scripts: { test: 'jest' } }) })
  const b = repo(root, 'tools/cli', 'https://github.com/x/cli.git') // other host: never queried
  repo(root, 'payment-core/vendored') // inside a repo: not listed
  mkdirSync(join(root, 'node_modules', 'x', '.git'), { recursive: true })
  const calls: string[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(String(url))
    assert.equal((init!.headers as Record<string, string>)['PRIVATE-TOKEN'], 'tok')
    return String(url).endsWith(encodeURIComponent('pay/payment-core')) ? Response.json({ id: 4242 }) : new Response('no', { status: 404 })
  }) as typeof fetch
  const creds: Record<string, string> = { WORKBENCH_GITLAB_URL: 'https://gitlab.corp.com/', WORKBENCH_GITLAB_TOKEN: 'tok' }
  const wb = new Workbench({ store: new Store(join(dir, 'w.json')), driver: new FakeDriver(), creds: async (n) => creds[n], fetch: f })

  const r = await wb.scanRepos([root, join(dir, 'nope')])
  assert.deepEqual(r.repos.map((x) => x.path).sort(), [b, a].sort())
  const pay = r.repos.find((x) => x.path === a)!
  assert.deepEqual([pay.gitlabPath, pay.gitlabProjectId, pay.testCmd, pay.known], ['pay/payment-core', 4242, 'npm test', false])
  assert.equal(r.repos.find((x) => x.path === b)!.gitlabProjectId, undefined)
  assert.equal(calls.length, 1)
  assert.equal(r.gitlab, 'matched')

  const made = wb.importRepos([{ path: a, name: 'payment-core', gitlabProjectId: 4242, testCmd: 'npm test' }, { path: b }])
  assert.deepEqual(made.map((p) => [p.name, p.gitlabProjectId]), [['payment-core', 4242], ['cli', undefined]])
  assert.equal(wb.importRepos([{ path: a }]).length, 0) // already a project
  assert.equal((await wb.scanRepos([root])).repos.find((x) => x.path === a)!.known, true)
})

test('scan without GitLab credentials still lists repos; a GitLab failure never fails the scan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-onb2-'))
  repo(dir, 'a', 'git@gitlab.corp.com:g/a.git')
  const noCreds = new Workbench({ store: new Store(join(dir, 'w1.json')), driver: new FakeDriver(), creds: async () => undefined })
  const r1 = await noCreds.scanRepos([dir])
  assert.deepEqual([r1.repos.length, r1.gitlab], [1, 'not_configured'])
  const creds: Record<string, string> = { WORKBENCH_GITLAB_URL: 'https://gitlab.corp.com', WORKBENCH_GITLAB_TOKEN: 't' }
  const down = new Workbench({ store: new Store(join(dir, 'w2.json')), driver: new FakeDriver(), creds: async (n) => creds[n], fetch: (async () => { throw new Error('ECONNREFUSED') }) as never })
  const r2 = await down.scanRepos([dir])
  assert.deepEqual([r2.repos.length, r2.gitlab, r2.repos[0]!.gitlabProjectId], [1, 'error', undefined])
  assert.match(r2.error!, /ECONNREFUSED/)
})
