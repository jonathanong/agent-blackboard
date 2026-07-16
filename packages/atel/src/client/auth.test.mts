import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { Auth } from './auth.mjs'

describe('Auth', () => {
  it('createCredentials() posts { name } using the admin token', async () => {
    const created = { id: 'c1', name: 'ci-bot', token: 'atl_sk_c1_secret', createdAt: 'now' }
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, created))
    try {
      const auth = new Auth({ baseUrl: fixture.baseUrl, adminToken: 'atl_admin_root_secret' })
      const result = await auth.createCredentials({ name: 'ci-bot' })
      expect(result).toEqual(created)
      expect(fixture.requests[0]!.headers.authorization).toBe('Bearer atl_admin_root_secret')
    } finally {
      await fixture.close()
    }
  })

  it('listCredentials() GETs the credential list', async () => {
    const list = [{ id: 'c1', name: 'ci-bot', createdAt: 'now' }]
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, list))
    try {
      const auth = new Auth({ baseUrl: fixture.baseUrl, adminToken: 'atl_admin_root_secret' })
      expect(await auth.listCredentials()).toEqual(list)
    } finally {
      await fixture.close()
    }
  })

  it('deleteCredentials() deletes by id or name', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, {}))
    try {
      const auth = new Auth({ baseUrl: fixture.baseUrl, adminToken: 'atl_admin_root_secret' })
      await auth.deleteCredentials({ id: 'c1' })
      await auth.deleteCredentials({ name: 'ci-bot' })
      expect(fixture.requests).toHaveLength(2)
      expect(new URL(fixture.requests[0]!.url, fixture.baseUrl).searchParams.get('id')).toBe('c1')
      expect(new URL(fixture.requests[1]!.url, fixture.baseUrl).searchParams.get('name')).toBe(
        'ci-bot',
      )
    } finally {
      await fixture.close()
    }
  })
})
