import { describe, expect, it } from 'vitest'
import { parseArgs, stringFlag } from './args.mjs'

describe('parseArgs', () => {
  it('collects positional args', () => {
    expect(parseArgs(['a', 'b'])).toEqual({ positional: ['a', 'b'], flags: {} })
  })

  it('parses --flag=value', () => {
    expect(parseArgs(['--name=ci-bot'])).toEqual({ positional: [], flags: { name: 'ci-bot' } })
  })

  it('parses --flag value (space-separated)', () => {
    expect(parseArgs(['--name', 'ci-bot'])).toEqual({ positional: [], flags: { name: 'ci-bot' } })
  })

  it('treats a trailing flag with no value as boolean true', () => {
    expect(parseArgs(['--all-sessions'])).toEqual({
      positional: [],
      flags: { 'all-sessions': true },
    })
  })

  it('treats a flag immediately followed by another flag as boolean true', () => {
    expect(parseArgs(['--all-sessions', '--agent', 'claude-code'])).toEqual({
      positional: [],
      flags: { 'all-sessions': true, agent: 'claude-code' },
    })
  })

  it('mixes positional args and flags in any order', () => {
    expect(parseArgs(['id-1', '--archived', 'true', 'id-2'])).toEqual({
      positional: ['id-1', 'id-2'],
      flags: { archived: 'true' },
    })
  })
})

describe('stringFlag', () => {
  it('returns the string value', () => {
    expect(stringFlag({ name: 'ci-bot' }, 'name')).toBe('ci-bot')
  })

  it('returns undefined for a bare boolean flag', () => {
    expect(stringFlag({ name: true }, 'name')).toBeUndefined()
  })

  it('returns undefined when unset', () => {
    expect(stringFlag({}, 'name')).toBeUndefined()
  })
})
