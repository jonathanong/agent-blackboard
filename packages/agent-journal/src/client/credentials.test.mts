import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { createCredential, deleteCredential, listCredentials } from './credentials.mjs'

describe('createCredential', () => {
  it('posts { name } and returns the created credential with its one-time token', async () => {
    const created = { id: 'c1', name: 'ci-bot', token: 'ag_sk_c1_secret', createdAt: 'now' }
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, created))
    try {
      const result = await createCredential(
        { baseUrl: fixture.baseUrl, token: 'admin' },
        { name: 'ci-bot' },
      )
      expect(result).toEqual(created)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual({ name: 'ci-bot' })
    } finally {
      await fixture.close()
    }
  })
})

describe('listCredentials', () => {
  it('GETs the credential list, never including tokens', async () => {
    const list = [{ id: 'c1', name: 'ci-bot', createdAt: 'now' }]
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, list))
    try {
      const result = await listCredentials({ baseUrl: fixture.baseUrl, token: 'admin' })
      expect(result).toEqual(list)
      expect(fixture.requests[0]!.method).toBe('GET')
    } finally {
      await fixture.close()
    }
  })
})

describe('deleteCredential', () => {
  it('deletes by id via ?id=', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, {}))
    try {
      await deleteCredential({ baseUrl: fixture.baseUrl, token: 'admin' }, { id: 'c1' })
      const url = new URL(fixture.requests[0]!.url, fixture.baseUrl)
      expect(fixture.requests[0]!.method).toBe('DELETE')
      expect(url.searchParams.get('id')).toBe('c1')
      expect(url.searchParams.get('name')).toBeNull()
    } finally {
      await fixture.close()
    }
  })

  it('deletes by name via ?name=', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, {}))
    try {
      await deleteCredential({ baseUrl: fixture.baseUrl, token: 'admin' }, { name: 'ci-bot' })
      const url = new URL(fixture.requests[0]!.url, fixture.baseUrl)
      expect(url.searchParams.get('name')).toBe('ci-bot')
      expect(url.searchParams.get('id')).toBeNull()
    } finally {
      await fixture.close()
    }
  })
})
