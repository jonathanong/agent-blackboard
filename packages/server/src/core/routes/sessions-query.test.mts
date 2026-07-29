import { describe, expect, it } from 'vitest'
import type { QueryMap } from '../types.mjs'
import { parseListSessionsQuery } from './sessions-query.mjs'

describe('parseListSessionsQuery', () => {
  it('defaults archived to false when the param is absent', () => {
    const result = parseListSessionsQuery({})
    expect(result).toEqual({ ok: true, query: { archived: false } })
  })

  it('accepts explicit archived=true and archived=false', () => {
    expect(parseListSessionsQuery({ archived: 'true' })).toEqual({
      ok: true,
      query: { archived: true },
    })
    expect(parseListSessionsQuery({ archived: 'false' })).toEqual({
      ok: true,
      query: { archived: false },
    })
  })

  it('rejects an archived value that is neither true nor false', () => {
    expect(parseListSessionsQuery({ archived: 'all' })).toEqual({
      ok: false,
      error: 'archived must be true or false',
    })
  })

  it('passes through agent and version filters', () => {
    const result = parseListSessionsQuery({ agent: 'claude-code', version: '1.0.13' })
    expect(result).toEqual({
      ok: true,
      query: { archived: false, agent: 'claude-code', version: '1.0.13' },
    })
  })

  it('maps a present parentSessionId to its value, and an empty one to null', () => {
    expect(parseListSessionsQuery({ parentSessionId: 'root' })).toEqual({
      ok: true,
      query: { archived: false, parentSessionId: 'root' },
    })
    expect(parseListSessionsQuery({ parentSessionId: '' })).toEqual({
      ok: true,
      query: { archived: false, parentSessionId: null },
    })
  })

  it('omits parentSessionId from the result entirely when the param is absent', () => {
    const result = parseListSessionsQuery({})
    expect(result.ok).toBe(true)
    expect(result.ok && Object.hasOwn(result.query, 'parentSessionId')).toBe(false)
  })

  it('maps an explicit undefined parentSessionId value to null, same as an empty string', () => {
    const query: QueryMap = { parentSessionId: undefined }
    expect(parseListSessionsQuery(query)).toEqual({
      ok: true,
      query: { archived: false, parentSessionId: null },
    })
  })

  it('parses a JSON object data filter', () => {
    const result = parseListSessionsQuery({ data: '{"branch":"main"}' })
    expect(result).toEqual({
      ok: true,
      query: { archived: false, data: { branch: 'main' } },
    })
  })

  it('parses positive integer and fractional inactivity filters', () => {
    expect(parseListSessionsQuery({ inactiveForHours: '8' })).toEqual({
      ok: true,
      query: { archived: false, inactiveForHours: 8 },
    })
    expect(parseListSessionsQuery({ inactiveForHours: '0.5' })).toEqual({
      ok: true,
      query: { archived: false, inactiveForHours: 0.5 },
    })
  })

  it.each(['0', '-1', 'Infinity', 'abc'])('rejects invalid inactivity %s', (value) => {
    expect(parseListSessionsQuery({ inactiveForHours: value })).toEqual({
      ok: false,
      error: 'inactiveForHours must be a positive number',
    })
  })

  it('rejects unparseable JSON in the data filter', () => {
    expect(parseListSessionsQuery({ data: 'not json' })).toEqual({
      ok: false,
      error: 'data must be a JSON object',
    })
  })

  it('rejects a data filter that parses to a JSON array', () => {
    expect(parseListSessionsQuery({ data: '[1,2]' })).toEqual({
      ok: false,
      error: 'data must be a JSON object',
    })
  })

  it('rejects a data filter that parses to a JSON primitive', () => {
    expect(parseListSessionsQuery({ data: '5' })).toEqual({
      ok: false,
      error: 'data must be a JSON object',
    })
  })

  it('parses a valid limit', () => {
    expect(parseListSessionsQuery({ limit: '10' })).toEqual({
      ok: true,
      query: { archived: false, limit: 10 },
    })
  })

  it.each(['0', '-1', '1.5', 'abc', '201'])('rejects an out-of-range limit %s', (limit) => {
    expect(parseListSessionsQuery({ limit })).toEqual({
      ok: false,
      error: 'limit must be an integer between 1 and 200',
    })
  })

  it('accepts the maximum boundary limit of 200', () => {
    expect(parseListSessionsQuery({ limit: '200' })).toEqual({
      ok: true,
      query: { archived: false, limit: 200 },
    })
  })

  it('passes through an opaque cursor value untouched', () => {
    expect(parseListSessionsQuery({ cursor: 'opaque-cursor-value' })).toEqual({
      ok: true,
      query: { archived: false, cursor: 'opaque-cursor-value' },
    })
  })
})
