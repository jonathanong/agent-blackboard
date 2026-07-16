#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { formatError } from '../format-error.mjs'
import { startMcpServer } from '../mcp/server.mjs'
import { runAppend } from './append.mjs'
import type { CliContext } from './context.mjs'
import { runCredentials } from './credentials.mjs'
import { CliError } from './errors.mjs'
import { telemetryConfigFromEnv } from './env.mjs'
import { runGet } from './get.mjs'
import { writeLine } from './output.mjs'
import { runPatch } from './patch.mjs'
import { USAGE } from './usage.mjs'

const HELP_COMMANDS = new Set(['help', '--help', '-h'])

export interface RunCliOptions {
  env?: NodeJS.ProcessEnv
  stdin?: AsyncIterable<Buffer | string>
  stdout?: { write: (chunk: string) => void }
  stderr?: { write: (chunk: string) => void }
  startMcpServer?: typeof startMcpServer
}

/**
 * Runs one CLI invocation and resolves to a process exit code (never calls
 * `process.exit` itself, so it's directly testable).
 */
export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const ctx: CliContext = {
    env: options.env ?? process.env,
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
  }
  const [command, ...rest] = argv
  try {
    if (command === undefined || HELP_COMMANDS.has(command)) {
      writeLine(ctx.stdout, USAGE)
      return 0
    }
    switch (command) {
      case 'append':
        await runAppend(rest, ctx)
        break
      case 'get':
        await runGet(rest, ctx)
        break
      case 'patch':
        await runPatch(rest, ctx)
        break
      case 'credentials':
        await runCredentials(rest, ctx)
        break
      case 'mcp':
        await (options.startMcpServer ?? startMcpServer)(telemetryConfigFromEnv(ctx.env))
        break
      default:
        throw new CliError(
          `Unknown command: ${command}. Expected one of: append, get, patch, credentials, mcp.`,
        )
    }
    return 0
  } catch (err) {
    writeLine(ctx.stderr, `Error: ${formatError(err)}`)
    return 1
  }
}

/* v8 ignore start -- real process entrypoint; exercised via the built `atel` binary, not under vitest */
// realpathSync, not a raw string compare: every real install path (npx, a
// global install, or a workspace-linked bin like this package's own) invokes
// this file through a symlink. `import.meta.url` resolves through it to the
// real file, but `process.argv[1]` is the symlink path as typed on the
// command line — comparing them directly would silently never match and
// this entrypoint would never run.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const code = await runCli(process.argv.slice(2))
  process.exitCode = code
}
/* v8 ignore stop */
