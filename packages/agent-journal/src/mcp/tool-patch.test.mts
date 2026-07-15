import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { handleJournalPatch } from './tool-patch.mjs'

const ENTRY = {
  id: 'a',
  sessionId: 's1',
  agent: 'claude-code',
  createdAt: 'now',
  archived: true,
  data: { pr: 7777 },
}

describe('handleJournalPatch', () => {
  it('sends the batch of patches and returns { patched }', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY]))
    try {
      const result = await handleJournalPatch(
        { patches: [{ id: 'a', archived: true, data: { pr: 7777 } }] },
        { baseUrl: fixture.baseUrl, token: 't' },
      )
      expect(result).toEqual({ patched: [ENTRY] })
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual([
        { id: 'a', archived: true, data: { pr: 7777 } },
      ])
    } finally {
      await fixture.close()
    }
  })

  it('supports a patch with only an id (no archived, no data)', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY]))
    try {
      await handleJournalPatch({ patches: [{ id: 'a' }] }, { baseUrl: fixture.baseUrl, token: 't' })
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual([{ id: 'a' }])
    } finally {
      await fixture.close()
    }
  })

  it('supports a patch with only data (no archived field)', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY]))
    try {
      const result = await handleJournalPatch(
        { patches: [{ id: 'a', data: { pr: 7777 } }] },
        { baseUrl: fixture.baseUrl, token: 't' },
      )
      expect(result).toEqual({ patched: [ENTRY] })
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual([{ id: 'a', data: { pr: 7777 } }])
    } finally {
      await fixture.close()
    }
  })

  it('throws when patches is missing or not an array', async () => {
    const config = { baseUrl: 'http://h/', token: 't' }
    await expect(handleJournalPatch({}, config)).rejects.toThrow('"patches" must be an array.')
    await expect(handleJournalPatch({ patches: 'x' }, config)).rejects.toThrow(
      '"patches" must be an array.',
    )
  })

  it('throws when a patch entry has no string id', async () => {
    const config = { baseUrl: 'http://h/', token: 't' }
    await expect(handleJournalPatch({ patches: [{}] }, config)).rejects.toThrow(
      'patches[0].id must be a string.',
    )
  })

  it('throws when a patch entry data is not an object', async () => {
    const config = { baseUrl: 'http://h/', token: 't' }
    await expect(handleJournalPatch({ patches: [{ id: 'a', data: 'x' }] }, config)).rejects.toThrow(
      '"patches[0].data" must be an object.',
    )
  })
})
