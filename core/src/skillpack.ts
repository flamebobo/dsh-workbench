import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expandHome } from './onboarding.ts'

export interface PackSkill { name: string; description: string; whenToUse?: string; /** SKILL.md (or the flat .md file) */ path: string; /** directory holding the skill's other files */ directory: string; root: string }

export const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** `---\nkey: value\n---\nbody`. Values may be quoted; nothing fancier (no nesting) is needed for name / description. */
export function parseSkillFile(text: string): { meta: Record<string, string>; body: string } | undefined {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return undefined
  const meta: Record<string, string> = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line)
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
  return { meta, body: m[2]! }
}

/**
 * Skills under each root: `<root>/<name>/SKILL.md` or `<root>/<name>.md`, the layout DSH itself scans. A file without a valid
 * kebab-case `name` and a `description`, or a name seen earlier in the list, is skipped (earlier roots win).
 */
export function discoverSkills(roots: string[]): PackSkill[] {
  const out: PackSkill[] = []
  const seen = new Set<string>()
  for (const raw of roots) {
    const root = resolve(expandHome(raw.trim()))
    let entries: string[]
    try { entries = readdirSync(root).sort() } catch { continue }
    for (const e of entries) {
      const full = join(root, e)
      let file: string | undefined, directory = root
      try {
        if (statSync(full).isDirectory()) { file = join(full, 'SKILL.md'); directory = full } else if (e.endsWith('.md')) file = full
      } catch { continue }
      if (!file || !existsSync(file)) continue
      const parsed = parseSkillFile(readFileSync(file, 'utf8'))
      const { name, description } = parsed?.meta ?? {}
      if (!name || !description || !SKILL_NAME.test(name) || seen.has(name)) continue
      seen.add(name)
      out.push({ name, description, whenToUse: parsed!.meta.whenToUse, path: file, directory, root })
    }
  }
  return out
}

/** The body of one skill, read fresh each time so edits need no reload. */
export const readSkillBody = (s: Pick<PackSkill, 'path'>) => parseSkillFile(readFileSync(s.path, 'utf8'))?.body ?? ''
