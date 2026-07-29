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
})
