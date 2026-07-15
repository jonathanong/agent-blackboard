import { describe, expect, it } from 'vitest'
import { adminConfigFromEnv, journalConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'

describe('journalConfigFromEnv', () => {
  it('reads AGENT_JOURNAL_URL / AGENT_JOURNAL_TOKEN', () => {
    expect(
      journalConfigFromEnv({ AGENT_JOURNAL_URL: 'http://h/', AGENT_JOURNAL_TOKEN: 'ag_sk_x_y' }),
    ).toEqual({
      baseUrl: 'http://h/',
      token: 'ag_sk_x_y',
    })
  })

  it('throws when AGENT_JOURNAL_URL is missing', () => {
    expect(() => journalConfigFromEnv({ AGENT_JOURNAL_TOKEN: 't' })).toThrow(CliError)
  })

  it('throws when AGENT_JOURNAL_TOKEN is missing', () => {
    expect(() => journalConfigFromEnv({ AGENT_JOURNAL_URL: 'http://h/' })).toThrow(CliError)
  })
})

describe('adminConfigFromEnv', () => {
  it('reads AGENT_JOURNAL_URL / AGENT_JOURNAL_ADMIN_TOKEN', () => {
    expect(
      adminConfigFromEnv({
        AGENT_JOURNAL_URL: 'http://h/',
        AGENT_JOURNAL_ADMIN_TOKEN: 'ag_admin_x_y',
      }),
    ).toEqual({
      baseUrl: 'http://h/',
      token: 'ag_admin_x_y',
    })
  })

  it('throws when AGENT_JOURNAL_URL is missing', () => {
    expect(() => adminConfigFromEnv({ AGENT_JOURNAL_ADMIN_TOKEN: 't' })).toThrow(CliError)
  })

  it('throws when AGENT_JOURNAL_ADMIN_TOKEN is missing', () => {
    expect(() => adminConfigFromEnv({ AGENT_JOURNAL_URL: 'http://h/' })).toThrow(CliError)
  })
})
