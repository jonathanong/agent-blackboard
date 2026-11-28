import { describe, expect, it } from 'vitest'
import {
  computeEntryExpiry,
  DEFAULT_TTL_DAYS,
  resolveEntryTtlDays,
  resolveRetentionPolicy,
  resolveTtlDays,
  resolveTtlOverrides,
} from './retention.mjs'

describe('retention policy', () => {
  it('resolves global TTL days with validation', () => {
    expect(resolveTtlDays()).toBe(DEFAULT_TTL_DAYS)
    expect(resolveTtlDays(undefined, '')).toBe(DEFAULT_TTL_DAYS)
    expect(resolveTtlDays(undefined, '30')).toBe(30)
    expect(resolveTtlDays(14, '30')).toBe(14)
    expect(() => resolveTtlDays(0)).toThrow(/Invalid ttlDays/)
    expect(() => resolveTtlDays(1.5)).toThrow(/Invalid ttlDays/)
    expect(() => resolveTtlDays(undefined, 'nope')).toThrow(/Invalid AGENT_BLACKBOARD_TTL_DAYS/)
    expect(() => resolveTtlDays(undefined, '-5')).toThrow(/Invalid AGENT_BLACKBOARD_TTL_DAYS/)
  })

  it('parses and validates per-repository TTL overrides', () => {
    expect(resolveTtlOverrides().size).toBe(0)
    expect(resolveTtlOverrides(undefined, '  ').size).toBe(0)
    expect(resolveTtlOverrides(undefined, '{"Org/App": 7, "org/tooling": 180}')).toEqual(
      new Map([
        ['org/app', 7],
        ['org/tooling', 180],
      ]),
    )
    // Identical case-folded keys with identical values are accepted
    expect(resolveTtlOverrides({ 'Org/App': 7, 'org/app': 7 })).toEqual(new Map([['org/app', 7]]))

    expect(() => resolveTtlOverrides(undefined, '{bad')).toThrow(/must be a JSON object/)
    expect(() => resolveTtlOverrides(undefined, '[]')).toThrow(/must be a JSON object/)
    expect(() => resolveTtlOverrides(undefined, 'null')).toThrow(/must be a JSON object/)
    expect(() => resolveTtlOverrides({ '   ': 7 })).toThrow(/repository key must be non-empty/)
    expect(() => resolveTtlOverrides({ 'org/app': 0 })).toThrow(/positive integer/)
    expect(() => resolveTtlOverrides({ 'Org/App': 7, 'org/app': 14 })).toThrow(
      /conflicting overrides/,
    )
  })

  it('resolves effective entry TTL across repository, repositories, multi-repo, and defaults', () => {
    const policy = resolveRetentionPolicy({
      ttlDays: 90,
      ttlOverrides: { 'org/short': 7, 'org/mid': 30, 'org/long': 180 },
    })

    expect(resolveEntryTtlDays(policy, {})).toBe(90)
    expect(resolveEntryTtlDays(policy, { repository: '   ' })).toBe(90)
    expect(resolveEntryTtlDays(policy, { repository: 'org/unknown' })).toBe(90)
    expect(resolveEntryTtlDays(policy, { repository: 'Org/Short' })).toBe(7)
    expect(resolveEntryTtlDays(policy, { repositories: [42, '  ', 'org/long'] })).toBe(180)
    // Shortest override wins when multiple repositories match
    expect(
      resolveEntryTtlDays(policy, {
        repository: 'org/long',
        repositories: ['org/mid', 'org/short'],
      }),
    ).toBe(7)

    const noOverrides = resolveRetentionPolicy({ ttlDays: 45 })
    expect(resolveEntryTtlDays(noOverrides, { repository: 'org/short' })).toBe(45)

    const expiry = computeEntryExpiry(Date.parse('2026-01-01T00:00:00.500Z'), 7)
    expect(expiry).toEqual({
      ttl: Math.floor(Date.parse('2026-01-01T00:00:00.500Z') / 1000) + 7 * 86400,
      expiresAt: '2026-01-08T00:00:00.000Z',
    })
  })
})
