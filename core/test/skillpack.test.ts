import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, Workbench, discoverSkills, parseSkillFile, readSkillBody } from '../src/index.ts'
import { FakeDriver } from './fake.ts'

const skill = (name: string, description: string, body = '正文') => `---\nname: ${name}\ndescription: "${description}"\n---\n${body}\n`

function pack() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-pack-'))
  const root = join(dir, 'pack')
  mkdirSync(join(root, 'style'), { recursive: true })
  writeFileSync(join(root, 'style', 'SKILL.md'), skill('company-style', '公司规范', '# 规则\n用小驼峰'))
  writeFileSync(join(root, 'flat-skill.md'), skill('flat-skill', '平铺文件'))
  mkdirSync(join(root, 'broken'))
  writeFileSync(join(root, 'broken', 'SKILL.md'), '没有 frontmatter')
  mkdirSync(join(root, 'badname'))
  writeFileSync(join(root, 'badname', 'SKILL.md'), skill('Bad_Name', 'x'))
  return { dir, root }
}

test('frontmatter parsing and discovery: directories and flat files, invalid ones skipped, earlier roots win', () => {
  assert.deepEqual(parseSkillFile('---\nname: a\ndescription: "b: c"\n---\nbody\n'), { meta: { name: 'a', description: 'b: c' }, body: 'body\n' })
  assert.equal(parseSkillFile('no front matter'), undefined)
  const { dir, root } = pack()
  const other = join(dir, 'other')
  mkdirSync(join(other, 'dup'), { recursive: true })
  writeFileSync(join(other, 'dup', 'SKILL.md'), skill('company-style', '会被前一个目录盖掉'))
  const found = discoverSkills([root, other, join(dir, 'missing')])
  assert.deepEqual(found.map((s) => s.name), ['flat-skill', 'company-style']) // broken / badly named / duplicate / missing: skipped
  assert.equal(found.find((s) => s.name === 'company-style')!.description, '公司规范')
  assert.equal(readSkillBody(found.find((s) => s.name === 'company-style')!), '# 规则\n用小驼峰\n')
})

test('a project\'s skills join the agent\'s at 开工: profile and first message, each named once; roots show in the report', async () => {
  const { dir, root } = pack()
  const driver = new FakeDriver()
  const wb = new Workbench({ store: new Store(join(dir, 'w.json')), driver, creds: async () => undefined })
  wb.seedDemoProjects(join(dir, 'repos'))
  wb.saveSettings({ isolateByDefault: false, skillRoots: [root, ` ${root} `, ''] })
  assert.deepEqual(wb.settings().skillRoots, [root]) // trimmed, de-duplicated, blanks dropped
  const report = wb.packSkillReport()
  assert.deepEqual([report.roots[0]!.exists, report.roots[0]!.count, report.skills.map((s) => s.name)], [true, 2, ['flat-skill', 'company-style']])

  const project = wb.listProjects()[0]!
  wb.saveProject({ ...project, skills: ['company-style', 'find-skills', 'Bad Name', 'company-style'] })
  assert.deepEqual(wb.listProjects()[0]!.skills, ['company-style', 'find-skills']) // invalid names dropped, de-duplicated
  wb.saveAgent({ ...wb.agent('fullstack'), skills: ['find-skills', 'office-docx'] })
  const i = wb.createIssue({ title: 't', projectId: project.id, status: 'todo' })
  await wb.startIssue(i.id)
  const req = driver.started[0]!
  assert.deepEqual(req.profile.skills, ['find-skills', 'office-docx', 'company-style'])
  assert.match(req.prompt, /请按这些技能的说明工作：\/find-skills \/office-docx \/company-style/)
})
