import { readSkillBody, type PackSkill, type Workbench } from '../core/src/index.ts'

type Ctx = any // eslint-disable-line @typescript-eslint/no-explicit-any

const INVOCATION = { modelInvocable: true, userInvocable: true }
// DSH's own custom skill directories rank 300 and user ones 400+: ours sit between them, after anything in the project itself
const RANK = 350

const candidate = (s: PackSkill) => ({
  name: s.name, description: s.description, ...(s.whenToUse ? { whenToUse: s.whenToUse } : {}), invocation: INVOCATION,
  provider: 'workbench', source: 'custom', rank: RANK,
  locator: { path: s.path, directory: s.directory }, resourceBase: { kind: 'directory', path: s.directory }, path: s.path,
})

/**
 * Offer the skills in the configured skill roots to DSH through its skill registry, so `/name` works in every session and the
 * agents can load them like any other skill. Returns a function that tells the registry to look again (call it when the roots change).
 */
export function registerSkillProvider(ctx: Ctx, wb: Workbench): () => void {
  let invalidate = () => {}
  try {
    const skills = ctx.get('skills')
    if (!skills?.registerProvider) { ctx.logger.warn('workbench: skill registry unavailable, skill packs are not offered to DSH'); return invalidate }
    const dispose = skills.registerProvider((control: { invalidate: () => void }) => {
      invalidate = () => control.invalidate()
      return {
        name: 'workbench',
        list: async () => wb.packSkills().map(candidate),
        get: async (c: { name: string }) => {
          const s = wb.packSkills().find((x) => x.name === c.name)
          return s ? { ...candidate(s), content: readSkillBody(s) } : undefined
        },
      }
    })
    ctx.effect(() => dispose)
  } catch (e) { ctx.logger.warn('workbench: could not register the skill provider', e) }
  return () => invalidate()
}
