import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_BASE_URL, HARNESS_PACKAGES } from './src/packages.js'
import { bindSkillhubAgents } from './src/runtime.js'

/** Cordis plugin name. The patch row name is the package name. */
export const name = 'skillhub-agents'

/**
 * Service this row waits for. Keep this an array: an object is read as
 * service names and the profile will not boot.
 */
export const inject = ['agentPresets']

/** Schemastery config. apiKey stays empty until the profile patch sets it. */
export const Config = Schema.object({
  baseUrl: Schema.string().default(DEFAULT_BASE_URL).description('SkillHub 根地址，不含 /api/v1'),
  apiKey: Schema.string().default('').description('SkillHub API Key，以 sg_ 开头。读取 Agent 用只读 Key 即可'),
  refreshIntervalMs: Schema.number().default(0).description('重新拉取间隔（毫秒）。0 表示只在启动时拉取'),
  personaPackage: Schema.string().default(HARNESS_PACKAGES.persona).description('人设插件包名。ChemBuddy 改名时覆盖'),
  skillFilesystemPackage: Schema.string().default(HARNESS_PACKAGES.skillFilesystem).description('技能目录插件包名。ChemBuddy 改名时覆盖'),
})

/**
 * Register each owned SkillHub Agent as a local preset.
 * Returns a disposer. Cordis also runs it from dispose / effect.
 */
export function apply(ctx, config) {
  return bindSkillhubAgents(ctx, config).dispose
}
