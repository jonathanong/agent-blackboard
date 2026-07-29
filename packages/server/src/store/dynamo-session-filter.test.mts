import { describe, expect, it } from 'vitest'
import { buildSessionFilter } from './dynamo-session-filter.mjs'

describe('buildSessionFilter', () => {
  const NOW = new Date('2026-01-01T10:00:00.000Z')
  it('returns an empty filter for an empty query', () => {
    expect(buildSessionFilter({})).toEqual({})
  })

  it('filters archived sessions with attribute_exists', () => {
    expect(buildSessionFilter({ archived: true })).toEqual({
      FilterExpression: 'attribute_exists(#archivedAt)',
      ExpressionAttributeNames: { '#archivedAt': 'archivedAt' },
      ExpressionAttributeValues: {},
    })
  })

  it('filters non-archived sessions with attribute_not_exists', () => {
    expect(buildSessionFilter({ archived: false })).toEqual({
      FilterExpression: 'attribute_not_exists(#archivedAt)',
      ExpressionAttributeNames: { '#archivedAt': 'archivedAt' },
      ExpressionAttributeValues: {},
    })
  })

  it('filters by agent alone', () => {
    expect(buildSessionFilter({ agent: 'agent-a' })).toEqual({
      FilterExpression: '#agent = :agent',
      ExpressionAttributeNames: { '#agent': 'agent' },
      ExpressionAttributeValues: { ':agent': 'agent-a' },
    })
  })

  it('filters by version alone', () => {
    expect(buildSessionFilter({ version: '2.0.0' })).toEqual({
      FilterExpression: '#version = :version',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: { ':version': '2.0.0' },
    })
  })

  it('filters by a string parentSessionId', () => {
    expect(buildSessionFilter({ parentSessionId: 'root' })).toEqual({
      FilterExpression: '#parentSessionId = :parentSessionId',
      ExpressionAttributeNames: { '#parentSessionId': 'parentSessionId' },
      ExpressionAttributeValues: { ':parentSessionId': 'root' },
    })
  })

  it('filters by a null parentSessionId', () => {
    expect(buildSessionFilter({ parentSessionId: null })).toEqual({
      FilterExpression: '#parentSessionId = :parentSessionId',
      ExpressionAttributeNames: { '#parentSessionId': 'parentSessionId' },
      ExpressionAttributeValues: { ':parentSessionId': null },
    })
  })

  it('filters by a single data key', () => {
    expect(buildSessionFilter({ data: { branch: 'main' } })).toEqual({
      FilterExpression: '#data.#dataKey0 = :dataValue0',
      ExpressionAttributeNames: { '#data': 'data', '#dataKey0': 'branch' },
      ExpressionAttributeValues: { ':dataValue0': 'main' },
    })
  })

  it('filters by multiple data keys, each with its own token pair', () => {
    expect(buildSessionFilter({ data: { branch: 'main', pr: 42 } })).toEqual({
      FilterExpression: '#data.#dataKey0 = :dataValue0 AND #data.#dataKey1 = :dataValue1',
      ExpressionAttributeNames: { '#data': 'data', '#dataKey0': 'branch', '#dataKey1': 'pr' },
      ExpressionAttributeValues: { ':dataValue0': 'main', ':dataValue1': 42 },
    })
  })

  it('treats an empty data object as no filter, contributing no #data alias', () => {
    expect(buildSessionFilter({ archived: true, data: {} })).toEqual({
      FilterExpression: 'attribute_exists(#archivedAt)',
      ExpressionAttributeNames: { '#archivedAt': 'archivedAt' },
      ExpressionAttributeValues: {},
    })
  })

  it('filters sessions with entries strictly older than the inactivity cutoff', () => {
    expect(buildSessionFilter({ inactiveForHours: 8 }, NOW)).toEqual({
      FilterExpression: 'attribute_exists(#lastEntryAt) AND #lastEntryAt < :lastEntryCutoff',
      ExpressionAttributeNames: { '#lastEntryAt': 'lastEntryAt' },
      ExpressionAttributeValues: { ':lastEntryCutoff': '2026-01-01T02:00:00.000Z' },
    })
  })

  it('combines every filter kind, joined with AND, in declared order', () => {
    expect(
      buildSessionFilter(
        {
          archived: false,
          agent: 'agent-a',
          version: '1.0.0',
          parentSessionId: null,
          data: { branch: 'main' },
          inactiveForHours: 8,
        },
        NOW,
      ),
    ).toEqual({
      FilterExpression:
        'attribute_not_exists(#archivedAt) AND #agent = :agent AND #version = :version AND ' +
        '#parentSessionId = :parentSessionId AND #data.#dataKey0 = :dataValue0 AND ' +
        'attribute_exists(#lastEntryAt) AND #lastEntryAt < :lastEntryCutoff',
      ExpressionAttributeNames: {
        '#archivedAt': 'archivedAt',
        '#agent': 'agent',
        '#version': 'version',
        '#parentSessionId': 'parentSessionId',
        '#data': 'data',
        '#dataKey0': 'branch',
        '#lastEntryAt': 'lastEntryAt',
      },
      ExpressionAttributeValues: {
        ':agent': 'agent-a',
        ':version': '1.0.0',
        ':parentSessionId': null,
        ':dataValue0': 'main',
        ':lastEntryCutoff': '2026-01-01T02:00:00.000Z',
      },
    })
  })
})
