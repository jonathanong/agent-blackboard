import { describe, expect, it } from 'vitest'
import type { CredentialRecord } from '../core/types.mjs'
import { hashToken } from './hash.mjs'
import { generateTelemetryToken } from './tokens.mjs'
import { resolveTelemetryCredential, type CredentialLookup } from './telemetry.mjs'

function storeWith(record: CredentialRecord | undefined): CredentialLookup {
  return {
    getCredentialById: async (id: string) => (record && record.id === id ? record : undefined),
  }
}

describe('resolveTelemetryCredential', () => {
  it('resolves a valid token to its credential record', async () => {
    const { credId, token } = generateTelemetryToken()
    const record: CredentialRecord = {
      id: credId,
      name: 'agent',
      tokenHash: hashToken(token),
      createdAt: 'now',
    }
    const resolved = await resolveTelemetryCredential(`Bearer ${token}`, storeWith(record))
    expect(resolved).toEqual(record)
  })

  it('returns undefined when the Authorization header is missing', async () => {
    expect(await resolveTelemetryCredential(undefined, storeWith(undefined))).toBeUndefined()
  })

  it('returns undefined for an admin-shaped token without a store lookup', async () => {
    let lookedUp = false
    const store: CredentialLookup = {
      getCredentialById: async () => {
        lookedUp = true
        return undefined
      },
    }
    const resolved = await resolveTelemetryCredential('Bearer atl_admin_alice_secret', store)
    expect(resolved).toBeUndefined()
    expect(lookedUp).toBe(false)
  })

  it('returns undefined when the credId is not found in the store', async () => {
    const { token } = generateTelemetryToken()
    const resolved = await resolveTelemetryCredential(`Bearer ${token}`, storeWith(undefined))
    expect(resolved).toBeUndefined()
  })

  it('returns undefined when the secret does not match the stored hash', async () => {
    const { credId, token } = generateTelemetryToken()
    const record: CredentialRecord = {
      id: credId,
      name: 'agent',
      tokenHash: hashToken(token),
      createdAt: 'now',
    }
    const tamperedToken = `${token}x`
    const resolved = await resolveTelemetryCredential(`Bearer ${tamperedToken}`, storeWith(record))
    expect(resolved).toBeUndefined()
  })
})
