import { describe, expect, it, vi } from 'vitest'
import { migrateEntryMetadata } from './migrate-entry-metadata.mjs'

function client(handler) {
  return { send: vi.fn((command) => Promise.resolve(handler(command))) }
}

function conditional() {
  return Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' })
}

describe('migrateEntryMetadata', () => {
  it('paginates, removes session ttl, ages entries, and backfills lastEntryAt', async () => {
    const commands = []
    let scans = 0
    const doc = client((command) => {
      commands.push(command)
      if (command.constructor.name === 'GetCommand') return {}
      if (command.constructor.name === 'ScanCommand') {
        scans += 1
        if (scans === 1) {
          return {
            Items: [
              { PK: 'SESSIONS#c', SK: 'SESSION#s', ttl: 1 },
              { PK: 'CRED', SK: 'ignored' },
              {
                PK: 'ENTRIES#c#s',
                SK: 'ENTRY#old',
                sessionId: 's',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            LastEvaluatedKey: { PK: 'next', SK: 'next' },
          }
        }
        return {
          Items: [
            {
              PK: 'ENTRIES#c#s',
              SK: 'ENTRY#new',
              sessionId: 's',
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        }
      }
      return {}
    })

    await expect(
      migrateEntryMetadata({
        doc,
        tableName: 'T',
        ttlDays: 30,
        now: () => new Date('2026-02-01T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ migrated: true, sessions: 1, entries: 2 })

    expect(scans).toBe(2)
    const updates = commands.filter((command) => command.constructor.name === 'UpdateCommand')
    expect(updates).toHaveLength(5)
    expect(updates[0].input.UpdateExpression).toBe('REMOVE #ttl')
    expect(updates[1].input.ExpressionAttributeValues[':ttl']).toBe(1769817600)
    expect(updates[2].input.Key).toEqual({ PK: 'SESSIONS#c', SK: 'SESSION#s' })
    const marker = commands.find((command) => command.constructor.name === 'PutCommand')
    expect(marker.input.Item).toEqual({
      PK: 'MIGRATION',
      SK: 'ENTRY_TTL_AND_LAST_ENTRY_AT_V1',
      migratedAt: '2026-02-01T00:00:00.000Z',
      ttlDays: 30,
    })
  })

  it('skips a completed migration', async () => {
    const doc = client(() => ({ Item: { PK: 'MIGRATION' } }))
    await expect(migrateEntryMetadata({ doc, tableName: 'T', ttlDays: 90 })).resolves.toEqual({
      migrated: false,
      sessions: 0,
      entries: 0,
    })
    expect(doc.send).toHaveBeenCalledTimes(1)
  })

  it('fails malformed entry metadata without writing the marker', async () => {
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') return {}
      if (command.constructor.name === 'ScanCommand') {
        return {
          Items: [{ PK: 'ENTRIES#c#s', SK: 'ENTRY#x', sessionId: 's', createdAt: 'bad' }],
        }
      }
      return {}
    })
    await expect(migrateEntryMetadata({ doc, tableName: 'T', ttlDays: 90 })).rejects.toThrow(
      'createdAt is invalid',
    )
    expect(doc.send.mock.calls.some(([command]) => command.constructor.name === 'PutCommand')).toBe(
      false,
    )
  })

  it('tolerates records removed or superseded during migration', async () => {
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') return {}
      if (command.constructor.name === 'ScanCommand') {
        return {
          Items: [
            {
              PK: 'ENTRIES#c#s',
              SK: 'ENTRY#x',
              sessionId: 's',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }
      }
      if (command.constructor.name === 'UpdateCommand') throw conditional()
      return {}
    })
    await expect(migrateEntryMetadata({ doc, tableName: 'T', ttlDays: 90 })).resolves.toEqual({
      migrated: true,
      sessions: 0,
      entries: 0,
    })
  })

  it('applies per-repository TTL overrides using scanned and fetched session data', async () => {
    const commands = []
    const doc = client((command) => {
      commands.push(command)
      if (command.constructor.name === 'GetCommand') {
        if (command.input.Key.PK === 'SESSIONS#c' && command.input.Key.SK === 'SESSION#s2') {
          return { Item: { data: { repositories: ['org/other', 'Org/Short', 42] } } }
        }
        return {}
      }
      if (command.constructor.name === 'ScanCommand') {
        return {
          Items: [
            { PK: 'SESSIONS#c', SK: 'SESSION#s1', data: { repository: 'org/medium' } },
            {
              PK: 'ENTRIES#c#s1',
              SK: 'ENTRY#1',
              sessionId: 's1',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              PK: 'ENTRIES#c#s2',
              SK: 'ENTRY#2',
              sessionId: 's2',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              PK: 'ENTRIES#c#s3',
              SK: 'ENTRY#3',
              sessionId: 's3',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }
      }
      return {}
    })

    await expect(
      migrateEntryMetadata({
        doc,
        tableName: 'T',
        ttlDays: 90,
        ttlOverrides: JSON.stringify({ 'org/medium': 14, 'org/short': 7, 'org/other': 30 }),
      }),
    ).resolves.toEqual({ migrated: true, sessions: 0, entries: 3 })

    const baseEpoch = Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000)
    const entryUpdates = commands.filter(
      (command) =>
        command.constructor.name === 'UpdateCommand' &&
        command.input.UpdateExpression === 'SET #ttl = :ttl',
    )
    expect(entryUpdates.map((u) => u.input.ExpressionAttributeValues[':ttl'])).toEqual([
      baseEpoch + 14 * 86400,
      baseEpoch + 7 * 86400,
      baseEpoch + 90 * 86400,
    ])
  })

  it('rejects malformed TTL override configuration before scanning', async () => {
    const doc = client(() => ({}))
    await expect(
      migrateEntryMetadata({ doc, tableName: 'T', ttlDays: 90, ttlOverrides: '[]' }),
    ).rejects.toThrow('JSON object')
    await expect(
      migrateEntryMetadata({ doc, tableName: 'T', ttlDays: 90, ttlOverrides: '{"org/a":0}' }),
    ).rejects.toThrow('invalid TTL override')
    expect(doc.send).not.toHaveBeenCalled()
  })
})
