import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('CloudFormation template', () => {
  it('grants the Lambda role query access to the session-list GSI', async () => {
    const template = await readFile(new URL('../infra/template.yaml', import.meta.url), 'utf8')
    const roleStart = template.indexOf('  AgentBlackboardFunctionRole:')
    const roleEnd = template.indexOf('  AgentBlackboardFunction:', roleStart)

    expect(roleStart).toBeGreaterThanOrEqual(0)
    expect(roleEnd).toBeGreaterThan(roleStart)
    expect(template.slice(roleStart, roleEnd)).toContain(`              - Effect: Allow
                Action: dynamodb:Query
                Resource: !Sub '\${AgentBlackboardTable.Arn}/index/SessionsByCreatedAt'`)
  })

  it('allows long-running response-stream snapshot exports', async () => {
    const template = await readFile(new URL('../infra/template.yaml', import.meta.url), 'utf8')
    expect(template).toContain('      Timeout: 300')
  })

  it('keeps Sentry optional and injects only public runtime configuration', async () => {
    const template = await readFile(new URL('../infra/template.yaml', import.meta.url), 'utf8')
    expect(template).toContain('  SentryEnabled:')
    expect(template).toContain('  SentryDsn:')
    expect(template).toContain('  SentryEnvironment:')
    expect(template).toContain('  SentryRelease:')
    expect(template).toContain('          SENTRY_ENABLED: !Ref SentryEnabled')
    expect(template).toContain('          SENTRY_DSN: !Ref SentryDsn')
    expect(template).toContain('          SENTRY_ENVIRONMENT: !Ref SentryEnvironment')
    expect(template).toContain('          SENTRY_RELEASE: !Ref SentryRelease')
    expect(template).not.toContain('SENTRY_AUTH_TOKEN')
  })
})
