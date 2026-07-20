import { describe, expect, it } from 'vitest'
import type { Session } from '../core/types.mjs'
import { matchesListFilter, resumeIndex, sortSessions } from './memory-session-query.mjs'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's',
    parentSessionId: null,
    agent: 'a',
    version: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    data: {},
    ...overrides,
  }
}

const EARLY = '2026-01-01T00:00:00.000Z'
const LATE = '2026-01-02T00:00:00.000Z'

describe('sortSessions', () => {
  it('orders an already-ascending pair with distinct createdAt values', () => {
    const early = session({ id: 'a', createdAt: EARLY })
    const late = session({ id: 'b', createdAt: LATE })
    const sessions = [early, late]
    sortSessions(sessions)
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('swaps a descending pair with distinct createdAt values', () => {
    const early = session({ id: 'a', createdAt: EARLY })
    const late = session({ id: 'b', createdAt: LATE })
    const sessions = [late, early]
    sortSessions(sessions)
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('tiebreaks equal createdAt by ascending id when already ascending', () => {
    const a = session({ id: 'a', createdAt: EARLY })
    const b = session({ id: 'b', createdAt: EARLY })
    const sessions = [a, b]
    sortSessions(sessions)
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('tiebreaks equal createdAt by ascending id when descending', () => {
    const a = session({ id: 'a', createdAt: EARLY })
    const b = session({ id: 'b', createdAt: EARLY })
    const sessions = [b, a]
    sortSessions(sessions)
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('leaves equal createdAt and equal id sessions untouched (the exact-tie branch)', () => {
    const first = session({ id: 'a', createdAt: EARLY })
    const second = session({ id: 'a', createdAt: EARLY })
    const sessions = [first, second]
    sortSessions(sessions)
    expect(sessions).toEqual([first, second])
  })
})

describe('resumeIndex', () => {
  it('finds the first session with a strictly later createdAt than the key', () => {
    const later = session({ id: 'z', createdAt: LATE })
    expect(resumeIndex([later], { createdAt: EARLY, sessionId: 'anything' })).toBe(0)
  })

  it('skips a session with an earlier createdAt than the key and keeps searching', () => {
    const earlier = session({ id: 'a', createdAt: EARLY })
    const later = session({ id: 'z', createdAt: LATE })
    expect(resumeIndex([earlier, later], { createdAt: EARLY, sessionId: earlier.id })).toBe(1)
  })

  it('on an exact createdAt tie, finds the first session with a strictly greater id', () => {
    const same = session({ id: 'b', createdAt: EARLY })
    expect(resumeIndex([same], { createdAt: EARLY, sessionId: 'a' })).toBe(0)
  })

  it('returns -1 when the key is at or past every session in the array', () => {
    const only = session({ id: 'a', createdAt: EARLY })
    expect(resumeIndex([only], { createdAt: EARLY, sessionId: 'a' })).toBe(-1)
  })
})

describe('matchesListFilter', () => {
  it('matches an empty query unconditionally', () => {
    expect(matchesListFilter(session(), {})).toBe(true)
  })

  it('filters on archived state', () => {
    expect(matchesListFilter(session({ archivedAt: null }), { archived: false })).toBe(true)
    expect(matchesListFilter(session({ archivedAt: null }), { archived: true })).toBe(false)
    expect(matchesListFilter(session({ archivedAt: 'now' }), { archived: true })).toBe(true)
    expect(matchesListFilter(session({ archivedAt: 'now' }), { archived: false })).toBe(false)
  })

  it('filters on agent', () => {
    expect(matchesListFilter(session({ agent: 'a' }), { agent: 'a' })).toBe(true)
    expect(matchesListFilter(session({ agent: 'a' }), { agent: 'b' })).toBe(false)
  })

  it('filters on version', () => {
    expect(matchesListFilter(session({ version: '1' }), { version: '1' })).toBe(true)
    expect(matchesListFilter(session({ version: '1' }), { version: '2' })).toBe(false)
  })

  it('filters on parentSessionId, including null', () => {
    expect(
      matchesListFilter(session({ parentSessionId: 'root' }), { parentSessionId: 'root' }),
    ).toBe(true)
    expect(
      matchesListFilter(session({ parentSessionId: 'root' }), { parentSessionId: 'other' }),
    ).toBe(false)
    expect(matchesListFilter(session({ parentSessionId: null }), { parentSessionId: null })).toBe(
      true,
    )
  })

  it('filters on data, requiring every listed key to deep-equal', () => {
    const withData = session({ data: { branch: 'main', nested: { ok: true } } })
    expect(matchesListFilter(withData, { data: { branch: 'main' } })).toBe(true)
    expect(matchesListFilter(withData, { data: { branch: 'main', nested: { ok: true } } })).toBe(
      true,
    )
    expect(matchesListFilter(withData, { data: { branch: 'dev' } })).toBe(false)
    expect(matchesListFilter(withData, { data: { missing: true } })).toBe(false)
  })
})
