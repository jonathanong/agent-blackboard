import { describe, expect, it } from 'vitest'
import { adminConfigFromEnv, telemetryConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'

describe('telemetryConfigFromEnv', () => {
  it('reads ATEL_URL / ATEL_TOKEN', () => {
    expect(telemetryConfigFromEnv({ ATEL_URL: 'http://h/', ATEL_TOKEN: 'atl_sk_x_y' })).toEqual({
      baseUrl: 'http://h/',
      token: 'atl_sk_x_y',
    })
  })

  it('throws when ATEL_URL is missing', () => {
    expect(() => telemetryConfigFromEnv({ ATEL_TOKEN: 't' })).toThrow(CliError)
  })

  it('throws when ATEL_TOKEN is missing', () => {
    expect(() => telemetryConfigFromEnv({ ATEL_URL: 'http://h/' })).toThrow(CliError)
  })
})

describe('adminConfigFromEnv', () => {
  it('reads ATEL_URL / ATEL_ADMIN_TOKEN', () => {
    expect(
      adminConfigFromEnv({
        ATEL_URL: 'http://h/',
        ATEL_ADMIN_TOKEN: 'atl_admin_x_y',
      }),
    ).toEqual({
      baseUrl: 'http://h/',
      token: 'atl_admin_x_y',
    })
  })

  it('throws when ATEL_URL is missing', () => {
    expect(() => adminConfigFromEnv({ ATEL_ADMIN_TOKEN: 't' })).toThrow(CliError)
  })

  it('throws when ATEL_ADMIN_TOKEN is missing', () => {
    expect(() => adminConfigFromEnv({ ATEL_URL: 'http://h/' })).toThrow(CliError)
  })
})
