import { describe, expect, it } from 'vitest'
import { resolveAdminCredential } from './admin.mjs'

function toEnv(entries: Array<{ name: string; token: string }>): {
  ATEL_ADMIN_CREDENTIALS: string
} {
  return { ATEL_ADMIN_CREDENTIALS: Buffer.from(JSON.stringify(entries)).toString('base64') }
}

describe('resolveAdminCredential', () => {
  const env = toEnv([
    { name: 'alice', token: 'atl_admin_alice_secret1' },
    { name: 'bob', token: 'atl_admin_bob_secret2' },
  ])

  it('returns the matching name for a valid admin token', () => {
    expect(resolveAdminCredential('Bearer atl_admin_alice_secret1', env)).toBe('alice')
    expect(resolveAdminCredential('Bearer atl_admin_bob_secret2', env)).toBe('bob')
  })

  it('returns undefined for a token that matches no entry', () => {
    expect(resolveAdminCredential('Bearer atl_admin_alice_wrong', env)).toBeUndefined()
  })

  it('returns undefined when the Authorization header is missing', () => {
    expect(resolveAdminCredential(undefined, env)).toBeUndefined()
  })

  it('returns undefined when ATEL_ADMIN_CREDENTIALS is unset', () => {
    expect(resolveAdminCredential('Bearer atl_admin_alice_secret1', {})).toBeUndefined()
  })

  it('returns undefined when ATEL_ADMIN_CREDENTIALS is not valid base64 JSON', () => {
    expect(
      resolveAdminCredential('Bearer x', { ATEL_ADMIN_CREDENTIALS: 'not-base64-json!!' }),
    ).toBeUndefined()
  })

  it('returns undefined when ATEL_ADMIN_CREDENTIALS decodes to non-array JSON', () => {
    const bad = Buffer.from(JSON.stringify({ not: 'an array' })).toString('base64')
    expect(resolveAdminCredential('Bearer x', { ATEL_ADMIN_CREDENTIALS: bad })).toBeUndefined()
  })

  it('ignores malformed entries in the ATEL_ADMIN_CREDENTIALS array', () => {
    const bad = Buffer.from(
      JSON.stringify([{ name: 'alice' }, 'not an object', 42, null]),
    ).toString('base64')
    expect(resolveAdminCredential('Bearer x', { ATEL_ADMIN_CREDENTIALS: bad })).toBeUndefined()
  })
})
