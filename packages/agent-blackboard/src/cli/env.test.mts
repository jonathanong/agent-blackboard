import { describe, expect, it } from 'vitest'
import { adminConfigFromEnv, clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'

describe('clientConfigFromEnv', () => {
  it('reads AGENT_BLACKBOARD_URL / AGENT_BLACKBOARD_TOKEN', () => {
    expect(
      clientConfigFromEnv({
        AGENT_BLACKBOARD_URL: 'http://h/',
        AGENT_BLACKBOARD_TOKEN: 'abb_sk_x_y',
      }),
    ).toEqual({
      baseUrl: 'http://h/',
      token: 'abb_sk_x_y',
    })
  })

  it('throws when AGENT_BLACKBOARD_URL is missing', () => {
    expect(() => clientConfigFromEnv({ AGENT_BLACKBOARD_TOKEN: 't' })).toThrow(CliError)
  })

  it('throws when AGENT_BLACKBOARD_TOKEN is missing', () => {
    expect(() => clientConfigFromEnv({ AGENT_BLACKBOARD_URL: 'http://h/' })).toThrow(CliError)
  })
})

describe('adminConfigFromEnv', () => {
  it('reads AGENT_BLACKBOARD_URL / AGENT_BLACKBOARD_ADMIN_TOKEN', () => {
    expect(
      adminConfigFromEnv({
        AGENT_BLACKBOARD_URL: 'http://h/',
        AGENT_BLACKBOARD_ADMIN_TOKEN: 'abb_admin_x_y',
      }),
    ).toEqual({
      baseUrl: 'http://h/',
      token: 'abb_admin_x_y',
    })
  })

  it('throws when AGENT_BLACKBOARD_URL is missing', () => {
    expect(() => adminConfigFromEnv({ AGENT_BLACKBOARD_ADMIN_TOKEN: 't' })).toThrow(CliError)
  })

  it('throws when AGENT_BLACKBOARD_ADMIN_TOKEN is missing', () => {
    expect(() => adminConfigFromEnv({ AGENT_BLACKBOARD_URL: 'http://h/' })).toThrow(CliError)
  })
})
