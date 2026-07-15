import { describe, expect, it } from 'vitest'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { Journals } from './journals.mjs'
import type { JournalEntry } from './types.mjs'

const ENTRY: JournalEntry = {
  id: 'a',
  sessionId: 's1',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: {},
}

describe('Journals', () => {
  it('append() posts a single object for a single input', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      const journals = new Journals({ baseUrl: fixture.baseUrl, token: 't' })
      const result = await journals.append({ sessionId: 's1', agent: 'claude-code', data: {} })
      expect(result).toEqual(ENTRY)
      expect(Array.isArray(JSON.parse(fixture.requests[0]!.body))).toBe(false)
    } finally {
      await fixture.close()
    }
  })

  it('append() posts an array for a batch input', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY, ENTRY]))
    try {
      const journals = new Journals({ baseUrl: fixture.baseUrl, token: 't' })
      const result = await journals.append([
        { sessionId: 's1', agent: 'claude-code', data: {} },
        { sessionId: 's2', agent: 'claude-code', data: {} },
      ])
      expect(result).toEqual([ENTRY, ENTRY])
      expect(Array.isArray(JSON.parse(fixture.requests[0]!.body))).toBe(true)
    } finally {
      await fixture.close()
    }
  })

  it('get() streams entries across sessions/agents', async () => {
    const fixture = await startHttpFixture((_req, res) => sendNdjson(res, [ENTRY]))
    try {
      const journals = new Journals({ baseUrl: fixture.baseUrl, token: 't' })
      const entries: JournalEntry[] = []
      for await (const entry of journals.get({ agent: 'claude-code' })) entries.push(entry)
      expect(entries).toEqual([ENTRY])
    } finally {
      await fixture.close()
    }
  })

  it('patch() sends a batch of patches and returns the updated entries', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY]))
    try {
      const journals = new Journals({ baseUrl: fixture.baseUrl, token: 't' })
      const result = await journals.patch([
        { id: 'a', archived: true },
        { id: 'b', data: { pr: 1 } },
      ])
      expect(result).toEqual([ENTRY])
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual([
        { id: 'a', archived: true },
        { id: 'b', data: { pr: 1 } },
      ])
    } finally {
      await fixture.close()
    }
  })
})
