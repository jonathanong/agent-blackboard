const SENTRY_DSN = /^https:\/\/[^\s@]+@[^\s/]+\/\d+$/
const GIT_SHA = /^[0-9a-f]{40}$/

export function parseSentryDeployOptions(argv, env, git) {
  let mode = 'off'
  let environment

  for (const arg of argv) {
    if (arg.startsWith('--sentry=')) mode = arg.slice('--sentry='.length)
    else if (arg.startsWith('--sentry-environment='))
      environment = arg.slice('--sentry-environment='.length)
    else throw new Error(`Unknown deploy argument: ${arg}`)
  }

  if (mode !== 'off' && mode !== 'required') {
    throw new Error('--sentry must be off or required')
  }
  if (mode === 'off') {
    if (environment) throw new Error('--sentry-environment requires --sentry=required')
    return { enabled: false, dsn: '', environment: 'staging', release: '' }
  }

  if (environment !== 'staging' && environment !== 'production') {
    throw new Error('--sentry-environment must be staging or production')
  }
  const dsn = env.AGENT_BLACKBOARD_SENTRY_DSN ?? ''
  if (!SENTRY_DSN.test(dsn)) {
    throw new Error('AGENT_BLACKBOARD_SENTRY_DSN must be a public HTTPS Sentry DSN')
  }
  if (git(['status', '--porcelain']).trim()) {
    throw new Error(
      '--sentry=required needs a clean Git worktree so the release identifies the artifact',
    )
  }
  const release = git(['rev-parse', 'HEAD']).trim()
  if (!GIT_SHA.test(release)) throw new Error('Sentry release must be a 40-character Git commit')

  return { enabled: true, dsn, environment, release }
}

export function validateRetentionDeployOptions(env) {
  const rawDays = env.AGENT_BLACKBOARD_TTL_DAYS
  if (rawDays !== undefined && rawDays.trim() !== '') {
    const days = Number(rawDays)
    if (!Number.isSafeInteger(days) || days < 1) {
      throw new Error(
        'Invalid AGENT_BLACKBOARD_TTL_DAYS: expected a positive integer number of days',
      )
    }
  }
  const rawOverrides = env.AGENT_BLACKBOARD_TTL_OVERRIDES
  if (rawOverrides === undefined || rawOverrides.trim() === '') return
  let parsed
  try {
    parsed = JSON.parse(rawOverrides)
  } catch {
    throw new Error('Invalid AGENT_BLACKBOARD_TTL_OVERRIDES: must be a JSON object')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid AGENT_BLACKBOARD_TTL_OVERRIDES: must be a JSON object')
  }
  const seen = new Map()
  for (const [key, value] of Object.entries(parsed)) {
    const repo = key.trim().toLowerCase()
    if (!repo) {
      throw new Error('Invalid AGENT_BLACKBOARD_TTL_OVERRIDES: repository key must be non-empty')
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(
        `Invalid AGENT_BLACKBOARD_TTL_OVERRIDES["${key}"]: expected a positive integer number of days`,
      )
    }
    const existing = seen.get(repo)
    if (existing !== undefined && existing !== value) {
      throw new Error(
        `Invalid AGENT_BLACKBOARD_TTL_OVERRIDES: conflicting overrides for repository "${repo}"`,
      )
    }
    seen.set(repo, value)
  }
}
