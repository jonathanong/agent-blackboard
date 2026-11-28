import { describe, expect, it } from 'vitest'
import { parseSentryDeployOptions, validateRetentionDeployOptions } from './deploy-options.mjs'

const cleanGit = (args) => {
  if (args.join(' ') === 'rev-parse HEAD') return 'a'.repeat(40) + '\n'
  if (args.join(' ') === 'status --porcelain') return ''
  throw new Error(`unexpected git args: ${args.join(' ')}`)
}

describe('parseSentryDeployOptions', () => {
  it('defaults to an explicitly disabled integration', () => {
    expect(parseSentryDeployOptions([], {}, cleanGit)).toEqual({
      enabled: false,
      dsn: '',
      environment: 'staging',
      release: '',
    })
  })

  it('enables Sentry only with a public DSN, environment, clean tree, and commit release', () => {
    expect(
      parseSentryDeployOptions(
        ['--sentry=required', '--sentry-environment=production'],
        { AGENT_BLACKBOARD_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123' },
        cleanGit,
      ),
    ).toEqual({
      enabled: true,
      dsn: 'https://public@example.ingest.sentry.io/123',
      environment: 'production',
      release: 'a'.repeat(40),
    })
  })

  it('rejects missing or malformed required configuration', () => {
    expect(() =>
      parseSentryDeployOptions(['--sentry=required', '--sentry-environment=staging'], {}, cleanGit),
    ).toThrow('AGENT_BLACKBOARD_SENTRY_DSN')
    expect(() =>
      parseSentryDeployOptions(
        ['--sentry=required', '--sentry-environment=preview'],
        { AGENT_BLACKBOARD_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123' },
        cleanGit,
      ),
    ).toThrow('staging or production')
    expect(() =>
      parseSentryDeployOptions(
        ['--sentry=required', '--sentry-environment=staging'],
        { AGENT_BLACKBOARD_SENTRY_DSN: 'not-a-dsn' },
        cleanGit,
      ),
    ).toThrow('public HTTPS Sentry DSN')
  })

  it('rejects dirty or non-commit builds when Sentry is required', () => {
    const env = { AGENT_BLACKBOARD_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123' }
    expect(() =>
      parseSentryDeployOptions(['--sentry=required', '--sentry-environment=staging'], env, (args) =>
        args[0] === 'status' ? ' M src/handler.mts\n' : 'a'.repeat(40),
      ),
    ).toThrow('clean Git worktree')
    expect(() =>
      parseSentryDeployOptions(['--sentry=required', '--sentry-environment=staging'], env, (args) =>
        args[0] === 'status' ? '' : 'not-a-sha',
      ),
    ).toThrow('40-character Git commit')
  })

  it('rejects unsupported modes and unrelated arguments', () => {
    expect(() => parseSentryDeployOptions(['--sentry=best-effort'], {}, cleanGit)).toThrow(
      '--sentry must be off or required',
    )
    expect(() => parseSentryDeployOptions(['--unknown'], {}, cleanGit)).toThrow(
      'Unknown deploy argument',
    )
  })
})

describe('validateRetentionDeployOptions', () => {
  it('accepts absent or valid TTL days and overrides', () => {
    expect(() => validateRetentionDeployOptions({})).not.toThrow()
    expect(() =>
      validateRetentionDeployOptions({
        AGENT_BLACKBOARD_TTL_DAYS: '30',
        AGENT_BLACKBOARD_TTL_OVERRIDES: '{"org/repo":7,"ORG/REPO":7}',
      }),
    ).not.toThrow()
  })

  it('rejects malformed TTL days and overrides before deploy', () => {
    expect(() => validateRetentionDeployOptions({ AGENT_BLACKBOARD_TTL_DAYS: '0' })).toThrow(
      /AGENT_BLACKBOARD_TTL_DAYS/,
    )
    expect(() => validateRetentionDeployOptions({ AGENT_BLACKBOARD_TTL_DAYS: 'abc' })).toThrow(
      /AGENT_BLACKBOARD_TTL_DAYS/,
    )
    expect(() =>
      validateRetentionDeployOptions({ AGENT_BLACKBOARD_TTL_OVERRIDES: '{bad' }),
    ).toThrow(/JSON object/)
    expect(() => validateRetentionDeployOptions({ AGENT_BLACKBOARD_TTL_OVERRIDES: '[]' })).toThrow(
      /JSON object/,
    )
    expect(() =>
      validateRetentionDeployOptions({ AGENT_BLACKBOARD_TTL_OVERRIDES: '{" ":7}' }),
    ).toThrow(/non-empty/)
    expect(() =>
      validateRetentionDeployOptions({ AGENT_BLACKBOARD_TTL_OVERRIDES: '{"org/a":0}' }),
    ).toThrow(/positive integer/)
    expect(() =>
      validateRetentionDeployOptions({
        AGENT_BLACKBOARD_TTL_OVERRIDES: '{"org/a":7,"ORG/A":14}',
      }),
    ).toThrow(/conflicting overrides/)
  })
})
