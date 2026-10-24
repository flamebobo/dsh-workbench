import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Store, Workbench } from '../../core/src/index.ts'
import { CodexDriver } from '../codex-driver.ts'

const fake = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url))
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)) } }

function setup(mode = 'complete') {
  const dir = mkdtempSync(join(tmpdir(), 'wb-codex-'))
  const logFile = join(dir, 'rpc.log')
  const driver = new CodexDriver({ command: { bin: process.execPath, args: [fake, mode, logFile] }, version: 't' })
  const wb = new Workbench({ store: new Store(join(dir, 'workbench.json')), driver, creds: async () => undefined })
  wb.seedDemoProjects(join(dir, 'repos'))
  wb.saveSettings({ isolateByDefault: false, autoTestOnReview: false })
  const sent = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  const card = (title = '修复支付回调重复入账') => wb.createIssue({ title, projectId: wb.listProjects()[0]!.id })
  const issue = (id: string) => wb.listIssues().find((i) => i.id === id)!
  return { wb, driver, sent, card, issue }
}

test('codex driver: 开工 starts a thread with the agent profile, and the finished turn moves the card to 待审核', async () => {
  const { wb, sent, card, issue } = setup()
  const agent = wb.saveAgent({ id: 'fullstack', name: '全栈工程师', description: 'd', instructions: '先写测试再改代码', model: 'gpt-a', effort: 'high', skills: ['company-style', 'a-team:five-whys', 'unknown-skill', 'Bad Name'] })
  const c = card()
  const { run } = await wb.startIssue(c.id, agent.id)
  await until(() => issue(c.id).status === 'in_review')
  const thread = sent().find((m) => m.method === 'thread/start')!.params
  assert.equal(thread.cwd, wb.listProjects()[0]!.cwd)
  assert.equal(thread.sandbox, 'workspace-write')
  assert.equal(thread.approvalPolicy, 'never')
  assert.equal(thread.model, 'gpt-a')
  assert.match(thread.developerInstructions, /你的角色是「全栈工程师」/)
  assert.match(thread.developerInstructions, /先写测试再改代码/)
  const turn = sent().find((m) => m.method === 'turn/start')!.params
  assert.equal(turn.effort, 'high')
  assert.match(turn.input[0].text, /修复支付回调重复入账/)
  assert.deepEqual(agent.skills, ['company-style', 'a-team:five-whys', 'unknown-skill']) // a plugin's namespaced skill is kept, a malformed name is not
  // only the skills Codex knows become skill inputs
  assert.deepEqual(turn.input.filter((i: { type: string }) => i.type === 'skill'), [
    { type: 'skill', name: 'company-style', path: '/skills/company-style/SKILL.md' },
    { type: 'skill', name: 'a-team:five-whys', path: '/plugins/a-team/skills/five-whys/SKILL.md' },
  ])
  const r = wb.listRuns().find((x) => x.id === run.id)!
  assert.equal(r.status, 'completed')
  assert.equal(r.finalText, '改好了，测试通过。')
  assert.match(issue(c.id).sessionId!, /^thr-/)
})

test('codex driver: a failed turn blocks the card with Codex\'s reason', async () => {
  const { wb, card, issue } = setup('fail')
  const c = card()
  await wb.startIssue(c.id)
  await until(() => issue(c.id).status === 'blocked')
  assert.equal(issue(c.id).note, '额度用完了')
})

test('codex driver: 停止 sends turn/interrupt for the open turn and the card stays 已阻塞 with the stop reason', async () => {
  const { wb, sent, card, issue } = setup('hang')
  const c = card()
  await wb.startIssue(c.id)
  await until(() => sent().some((m) => m.method === 'turn/start'))
  await new Promise((r) => setTimeout(r, 100)) // turn/started arrives
  await wb.stopIssue(c.id)
  const interrupt = sent().find((m) => m.method === 'turn/interrupt')
  assert.deepEqual(interrupt?.params, { threadId: issue(c.id).sessionId, turnId: 'turn-1' })
  assert.equal(issue(c.id).status, 'blocked')
  assert.equal(issue(c.id).note, '已手动停止')
})

test('codex driver: an approval request is declined instead of waiting for nobody', async () => {
  const { wb, sent, card, issue } = setup('approval')
  const c = card()
  await wb.startIssue(c.id)
  await until(() => issue(c.id).status === 'in_review')
  assert.deepEqual(sent().find((m) => m.id === 'approval-1' && !m.method)?.result, { decision: 'decline' })
})

test('codex driver: the app-server dying mid-turn blocks the card instead of leaving it spinning', async () => {
  const { wb, card, issue } = setup('crash')
  const c = card()
  await wb.startIssue(c.id)
  await until(() => issue(c.id).status === 'blocked')
  assert.match(issue(c.id).note!, /Codex 进程意外退出（退出码 3/)
})

test('codex driver: models come from model/list (all pages, hidden ones left out); skills from skills/list', async () => {
  const { driver } = setup()
  const models = await driver.listModels()
  assert.deepEqual(models.map((m) => [m.id, m.name, m.defaultEffort, m.efforts?.map((e) => e.id)]), [['gpt-a', 'GPT A', 'medium', ['medium', 'high']], ['gpt-b', 'GPT B', 'low', ['low']]])
  assert.deepEqual(await driver.listSkills(['/x']), [{ name: 'a-team:five-whys', description: '插件里的技能', source: 'user' }, { name: 'company-style', description: '公司规范', source: 'repo' }])
})
