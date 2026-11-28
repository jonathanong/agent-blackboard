export const DEFAULT_TTL_DAYS = 90

export type TtlOverrides = Record<string, number>

export interface RetentionPolicy {
  ttlDays: number
  ttlOverrides: ReadonlyMap<string, number>
}

export interface EntryExpiry {
  /** Unix epoch seconds stored in DynamoDB's `ttl` attribute. */
  ttl: number
  /** ISO-8601 timestamp matching `ttl`. */
  expiresAt: string
}

function assertPositiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}: expected a positive integer number of days`)
  }
  return value
}

/** Validates and resolves the global default TTL in days. */
export function resolveTtlDays(
  explicit?: number,
  envValue?: string,
  fallback = DEFAULT_TTL_DAYS,
): number {
  if (explicit !== undefined) return assertPositiveInt(explicit, 'ttlDays')
  if (envValue !== undefined && envValue.trim() !== '') {
    return assertPositiveInt(Number(envValue), 'AGENT_BLACKBOARD_TTL_DAYS')
  }
  return fallback
}

function parseOverridesObject(
  input: Record<string, unknown>,
  label: string,
): ReadonlyMap<string, number> {
  const overrides = new Map<string, number>()
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim().toLowerCase()
    if (!key) throw new Error(`Invalid ${label}: repository key must be non-empty`)
    const days = assertPositiveInt(rawValue, `${label}["${rawKey}"]`)
    const existing = overrides.get(key)
    if (existing !== undefined && existing !== days) {
      throw new Error(`Invalid ${label}: conflicting overrides for repository "${key}"`)
    }
    overrides.set(key, days)
  }
  return overrides
}

/** Parses per-repository TTL overrides from a JS object or JSON env string. */
export function resolveTtlOverrides(
  explicit?: TtlOverrides,
  envValue?: string,
): ReadonlyMap<string, number> {
  if (explicit !== undefined) return parseOverridesObject(explicit, 'ttlOverrides')
  if (envValue === undefined || envValue.trim() === '') return new Map()
  let parsed: unknown
  try {
    parsed = JSON.parse(envValue)
  } catch {
    throw new Error('Invalid AGENT_BLACKBOARD_TTL_OVERRIDES: must be a JSON object')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid AGENT_BLACKBOARD_TTL_OVERRIDES: must be a JSON object')
  }
  return parseOverridesObject(parsed as Record<string, unknown>, 'AGENT_BLACKBOARD_TTL_OVERRIDES')
}

export function resolveRetentionPolicy(options: {
  ttlDays?: number | undefined
  ttlOverrides?: TtlOverrides | undefined
  env?: { AGENT_BLACKBOARD_TTL_DAYS?: string; AGENT_BLACKBOARD_TTL_OVERRIDES?: string }
}): RetentionPolicy {
  return {
    ttlDays: resolveTtlDays(options.ttlDays, options.env?.AGENT_BLACKBOARD_TTL_DAYS),
    ttlOverrides: resolveTtlOverrides(
      options.ttlOverrides,
      options.env?.AGENT_BLACKBOARD_TTL_OVERRIDES,
    ),
  }
}

function sessionRepositories(data: Record<string, unknown>): string[] {
  const repos: string[] = []
  if (typeof data.repository === 'string') {
    const trimmed = data.repository.trim().toLowerCase()
    if (trimmed) repos.push(trimmed)
  }
  if (Array.isArray(data.repositories)) {
    for (const item of data.repositories) {
      if (typeof item === 'string') {
        const trimmed = item.trim().toLowerCase()
        if (trimmed) repos.push(trimmed)
      }
    }
  }
  return repos
}

/**
 * Resolves the effective TTL in days for an entry written to a session.
 * Matches `data.repository` and `data.repositories` case-insensitively; when
 * multiple repositories match overrides, the shortest (most restrictive) wins.
 */
export function resolveEntryTtlDays(
  policy: RetentionPolicy,
  sessionData: Record<string, unknown>,
): number {
  if (policy.ttlOverrides.size === 0) return policy.ttlDays
  let shortest: number | undefined
  for (const repo of sessionRepositories(sessionData)) {
    const override = policy.ttlOverrides.get(repo)
    if (override !== undefined && (shortest === undefined || override < shortest)) {
      shortest = override
    }
  }
  return shortest ?? policy.ttlDays
}

export function computeEntryExpiry(timestampMs: number, ttlDays: number): EntryExpiry {
  const ttl = Math.floor(timestampMs / 1000) + ttlDays * 86400
  return { ttl, expiresAt: new Date(ttl * 1000).toISOString() }
}
