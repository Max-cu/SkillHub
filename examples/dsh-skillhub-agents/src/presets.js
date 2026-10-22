import { PRESET_PREFIX } from './packages.js'
import { isSafeSegment } from './skills.js'

/**
 * Build one agentPresets.register definition.
 * `skillDir` is omitted when no skill markdown was written.
 */
export function buildPreset(agent, skillDir, packages) {
  if (!agent || typeof agent.id !== 'string' || !isSafeSegment(agent.id)) {
    throw new TypeError('agent id is not a safe preset id')
  }
  const plugins = [
    {
      id: 'persona',
      name: packages.personaPackage,
      config: {
        prefix: typeof agent.config?.persona === 'string' ? agent.config.persona : '',
      },
    },
  ]
  if (skillDir) {
    plugins.push({
      id: 'skill-filesystem',
      name: packages.skillFilesystemPackage,
      config: {
        providerName: 'skillhub',
        customSkillDirs: [skillDir],
      },
    })
  }
  return {
    id: PRESET_PREFIX + agent.id,
    name: typeof agent.name === 'string' ? agent.name : agent.id,
    description: typeof agent.description === 'string' ? agent.description : '',
    plugins,
  }
}
