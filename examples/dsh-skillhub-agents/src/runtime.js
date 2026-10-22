import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apiKeyProblem, normalizeConfig } from './config.js'
import { createClient } from './client.js'
import { loadPresets } from './load.js'

export function defaultDataRoot() {
  return join(tmpdir(), 'dsh-skillhub-agents')
}

/** Wire dispose onto the Cordis context and return the disposer apply() uses. */
export function bindSkillhubAgents(ctx, config, options) {
  const handle = startSkillhubAgents(ctx, config, options)
  const dispose = () => {
    void handle.dispose()
  }
  if (typeof ctx?.on === 'function') ctx.on('dispose', dispose)
  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose)
  return { handle, dispose }
}

/**
 * Pull SkillHub agents and register them on ctx.agentPresets.
 * refreshIntervalMs 0 fetches once. dispose unregisters and deletes the temp tree.
 */
export function startSkillhubAgents(ctx, config, options = {}) {
  const normalized = normalizeConfig(config)
  const logger = createLogger(ctx)
  const dataRoot = options.dataRoot ?? defaultDataRoot()
  const state = {
    stopped: false,
    current: new Map(),
    timers: [],
    idle: Promise.resolve(),
  }
  const keyProblem = apiKeyProblem(normalized.apiKey)
  const client = keyProblem
    ? null
    : createClient({
      baseUrl: normalized.baseUrl,
      apiKey: normalized.apiKey,
      fetch: options.fetch,
    })

  async function pull() {
    if (state.stopped) return
    if (!client) {
      logger.warn(`SkillHub Agent：${keyProblem}，未请求 SkillHub`)
      return
    }
    try {
      const { presets, failures } = await loadPresets(client, normalized, dataRoot)
      if (state.stopped) return
      for (const failure of failures) {
        const skill = failure.skillId ? ` skill ${failure.skillId}` : ''
        logger.warn(`SkillHub Agent ${failure.id || '(unknown)'}${skill}：${failure.message}`)
      }
      await swap(presets)
      if (!state.stopped) logger.info(`SkillHub Agent：已注册 ${presets.length} 个 preset`)
    } catch (error) {
      logger.error(`SkillHub Agent 拉取失败，保留已注册的 preset：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function schedule(job) {
    const run = state.idle.then(job, job)
    state.idle = run.then(() => {}, () => {})
    return run
  }

  const ready = schedule(pull)
  const setTimer = options.setInterval ?? setInterval
  const clearTimer = options.clearInterval ?? clearInterval
  if (normalized.refreshIntervalMs > 0) {
    const timer = setTimer(() => {
      void schedule(pull)
    }, normalized.refreshIntervalMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
    state.timers.push(timer)
  }

  let disposing
  function dispose() {
    state.stopped = true
    for (const timer of state.timers) clearTimer(timer)
    state.timers = []
    if (!disposing) {
      disposing = state.idle.then(async () => {
        await releaseMap(state.current)
        state.current = new Map()
        await rm(dataRoot, { recursive: true, force: true })
      })
    }
    return disposing
  }

  async function swap(presets) {
    const created = new Map()
    for (const preset of presets) {
      if (state.stopped) {
        await releaseMap(created)
        return
      }
      const previous = state.current.get(preset.id)
      if (previous) {
        state.current.delete(preset.id)
        await previous()
      }
      if (state.stopped) {
        await releaseMap(created)
        return
      }
      try {
        const unregister = await ctx.agentPresets.register(preset)
        if (typeof unregister !== 'function') throw new TypeError('agentPresets.register did not return unregister')
        created.set(preset.id, unregister)
      } catch (error) {
        logger.error(`SkillHub Agent ${preset.id} 注册失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (state.stopped) {
      await releaseMap(created)
      return
    }
    await releaseMap(state.current)
    state.current = created
  }

  return {
    ready,
    refresh: () => schedule(pull),
    dispose,
    get registrations() {
      return state.current.size
    },
  }
}

async function releaseMap(map) {
  const fns = [...map.values()]
  map.clear()
  for (const unregister of fns) {
    await unregister()
  }
}

function createLogger(ctx) {
  const logger = ctx?.logger
  const write = (level, message) => {
    const method = logger && typeof logger[level] === 'function' ? logger[level].bind(logger) : null
    if (method) method(message)
    else if (level === 'error') console.error(message)
    else if (level === 'warn') console.warn(message)
  }
  return {
    info(message) { write('info', message) },
    warn(message) { write('warn', message) },
    error(message) { write('error', message) },
  }
}
