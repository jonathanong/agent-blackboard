import { getEntriesRaw } from '../client/stream.mjs'
import type { EntryWireFormat } from '../client/types.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'

const VALID_FORMATS: readonly EntryWireFormat[] = ['json', 'jsonl', 'markdown']

function parseFormat(value: string | boolean | undefined): EntryWireFormat {
  if (value === undefined) return 'json'
  if (typeof value === 'string' && (VALID_FORMATS as readonly string[]).includes(value)) {
    return value as EntryWireFormat
  }
  throw new CliError(`--format must be one of: ${VALID_FORMATS.join(', ')}`)
}

export async function runGet(argv: string[], ctx: CliContext): Promise<void> {
  const { flags } = parseArgs(argv)
  const sessionId = stringFlag(flags, 'session-id')
  if (!sessionId) throw new CliError('get requires --session-id <id>.')
  const response = await getEntriesRaw(clientConfigFromEnv(ctx.env), {
    sessionId,
    format: parseFormat(flags.format),
  })
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (value) ctx.stdout.write(decoder.decode(value, { stream: true }))
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
