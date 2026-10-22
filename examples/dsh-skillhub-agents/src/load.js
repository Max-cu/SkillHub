import { buildPreset } from './presets.js'
import { isSafeSegment, isSkillVersion, pruneAgentDirs, writeAgentSkills } from './skills.js'

/**
 * Fetch owned agents and materialize preset definitions.
 * A failed agent or skill is skipped. A failed list throws so the caller can
 * keep the previous registrations.
 */
export async function loadPresets(client, config, dataRoot) {
  const listed = await client.listAgents()
  const presets = []
  const failures = []
  const kept = []
  for (const item of listed) {
    const id = item && typeof item.id === 'string' ? item.id : ''
    if (!isSafeSegment(id)) {
      failures.push({ id, message: 'ignored agent id' })
      continue
    }
    let agent
    try {
      agent = await client.getAgent(id)
    } catch (error) {
      failures.push({ id, message: errorMessage(error) })
      continue
    }
    if (!agent || agent.id !== id) {
      failures.push({ id, message: 'agent detail id did not match the list' })
      continue
    }
    const skills = []
    const refs = Array.isArray(agent.config?.skills) ? agent.config.skills : []
    for (const ref of refs) {
      if (!ref || typeof ref.skillId !== 'string' || !isSafeSegment(ref.skillId)) {
        failures.push({ id, message: 'ignored skill reference' })
        continue
      }
      let version
      if (typeof ref.version === 'string' && ref.version) {
        if (!isSkillVersion(ref.version)) {
          failures.push({ id, skillId: ref.skillId, message: 'ignored skill version' })
          continue
        }
        version = ref.version
      }
      try {
        const markdown = await client.getSkillMarkdown(ref.skillId, version)
        skills.push({ skillId: ref.skillId, version, markdown })
      } catch (error) {
        failures.push({ id, skillId: ref.skillId, message: errorMessage(error) })
      }
    }
    let skillDir = null
    try {
      skillDir = await writeAgentSkills(dataRoot, id, skills)
    } catch (error) {
      failures.push({ id, message: errorMessage(error) })
    }
    kept.push(id)
    presets.push(buildPreset(agent, skillDir, config))
  }
  await pruneAgentDirs(dataRoot, kept)
  return { presets, failures }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
