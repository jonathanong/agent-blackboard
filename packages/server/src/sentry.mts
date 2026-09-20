import * as Sentry from '@sentry/aws-serverless'

interface SentryClient {
  init(options: { dsn: string; environment: string; release: string }): void
  captureException(
    error: unknown,
    context: { tags: { stage: string }; extra: { requestId?: string | undefined } },
  ): void
  flush(timeout: number): Promise<boolean>
}

interface ErrorContext {
  stage: string
  requestId?: string | undefined
}

export type ErrorReporter = (error: unknown, context: ErrorContext) => Promise<void>

const disabledReporter: ErrorReporter = async () => undefined

export function createErrorReporter(
  env: NodeJS.ProcessEnv,
  client: SentryClient,
  log: (message: string) => void,
): ErrorReporter {
  if (env.SENTRY_ENABLED !== 'true') return disabledReporter

  const dsn = env.SENTRY_DSN
  const environment = env.SENTRY_ENVIRONMENT
  const release = env.SENTRY_RELEASE
  if (!dsn || !environment || !release) {
    log('Sentry is enabled but runtime configuration is incomplete; reporting is disabled')
    return disabledReporter
  }

  try {
    client.init({ dsn, environment, release })
  } catch (error) {
    log(`Sentry initialization failed; reporting is disabled: ${String(error)}`)
    return disabledReporter
  }

  return async (error, context) => {
    try {
      client.captureException(error, {
        tags: { stage: context.stage },
        extra: { requestId: context.requestId },
      })
      await client.flush(2_000)
    } catch (reportingError) {
      log(`Sentry error reporting failed: ${String(reportingError)}`)
    }
  }
}

export const reportSentryError = createErrorReporter(process.env, Sentry, console.error)
