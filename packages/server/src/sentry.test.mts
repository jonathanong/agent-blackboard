import { describe, expect, it, vi } from 'vitest'
import { createErrorReporter } from './sentry.mjs'

function client() {
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    flush: vi.fn(async () => true),
  }
}

describe('createErrorReporter', () => {
  it('is a no-op unless Sentry is explicitly enabled', async () => {
    const sentry = client()
    const report = createErrorReporter({}, sentry, vi.fn())
    await report(new Error('ignored'), { stage: 'request', requestId: 'req-1' })
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('initializes once and captures errors with release context', async () => {
    const sentry = client()
    const report = createErrorReporter(
      {
        SENTRY_ENABLED: 'true',
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
        SENTRY_ENVIRONMENT: 'production',
        SENTRY_RELEASE: 'a'.repeat(40),
      },
      sentry,
      vi.fn(),
    )
    const error = new Error('boom')
    await report(error, { stage: 'response-stream', requestId: 'req-2' })

    expect(sentry.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.ingest.sentry.io/123',
      environment: 'production',
      release: 'a'.repeat(40),
    })
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { stage: 'response-stream' },
      extra: { requestId: 'req-2' },
    })
    expect(sentry.flush).toHaveBeenCalledWith(2_000)
  })

  it('fails closed when enabled configuration is incomplete', async () => {
    const sentry = client()
    const log = vi.fn()
    const report = createErrorReporter({ SENTRY_ENABLED: 'true' }, sentry, log)
    await report(new Error('ignored'), { stage: 'request' })
    expect(sentry.init).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('configuration is incomplete'))
  })

  it('fails closed when SDK initialization throws', async () => {
    const sentry = client()
    sentry.init.mockImplementation(() => {
      throw new Error('invalid DSN')
    })
    const log = vi.fn()
    const report = createErrorReporter(
      {
        SENTRY_ENABLED: 'true',
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_RELEASE: 'c'.repeat(40),
      },
      sentry,
      log,
    )
    await report(new Error('ignored'), { stage: 'request' })
    expect(sentry.captureException).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Sentry initialization failed'))
  })

  it('never turns telemetry failure into a request failure', async () => {
    const sentry = client()
    sentry.flush.mockRejectedValue(new Error('network down'))
    const log = vi.fn()
    const report = createErrorReporter(
      {
        SENTRY_ENABLED: 'true',
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_RELEASE: 'b'.repeat(40),
      },
      sentry,
      log,
    )
    await expect(report(new Error('boom'), { stage: 'request' })).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Sentry error reporting failed'))
  })
})
