import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/
const SKILL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/

export function isSafeSegment(value) {
  return typeof value === 'string' && SAFE_SEGMENT.test(value)
}

export function isSkillVersion(version) {
  return typeof version === 'string' && SKILL_VERSION.test(version)
}

/** Kebab-case name skill-filesystem accepts in SKILL.md frontmatter. */
export function skillDirectoryName(skillId, version) {
  if (!isSafeSegment(skillId)) return ''
  if (version === undefined || version === '') return skillId
  if (typeof version !== 'string' || !SKILL_VERSION.test(version)) return ''
  const folder = `${skillId}-${version}`
  return isSafeSegment(folder) ? folder : ''
}

/**
 * Keep SkillHub markdown when it already has frontmatter.
 * Otherwise add the name and description the harness scanner requires.
 */
export function prepareSkillMarkdown(markdown, skillId) {
  if (typeof markdown !== 'string' || markdown.length === 0) return ''
  if (FRONTMATTER.test(markdown.trimStart())) return markdown
  const name = kebabName(skillId)
  return `---\nname: ${name}\ndescription: SkillHub skill\n---\n\n${markdown.endsWith('\n') ? markdown : `${markdown}\n`}`
}

/**
 * Write `<root>/<agentId>/<skillId>[-version]/SKILL.md`.
 * Returns the agent directory, or null when nothing was written.
 */
export async function writeAgentSkills(root, agentId, skills) {
  if (!isSafeSegment(agentId)) throw new TypeError('unsafe agent id')
  const agentDir = resolve(root, agentId)
  await rm(agentDir, { recursive: true, force: true })
  let wrote = false
  for (const skill of skills) {
    const folder = skillDirectoryName(skill.skillId, skill.version)
    const body = prepareSkillMarkdown(skill.markdown, skill.skillId)
    if (!folder || !body) continue
    const dir = join(agentDir, folder)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), body, 'utf8')
    wrote = true
  }
  if (!wrote) {
    await rm(agentDir, { recursive: true, force: true })
    return null
  }
  return agentDir
}

/** Remove agent directories that are no longer in the fetched set. */
export async function pruneAgentDirs(root, keepIds) {
  const keep = new Set([...keepIds].filter(isSafeSegment))
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }
  await Promise.all(entries.map(async entry => {
    if (!entry.isDirectory() || keep.has(entry.name)) return
    await rm(join(root, entry.name), { recursive: true, force: true })
  }))
}

function kebabName(skillId) {
  const name = String(skillId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return SKILL_NAME.test(name) ? name : 'skillhub-skill'
}
