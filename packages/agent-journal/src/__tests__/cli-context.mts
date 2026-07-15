import type { CliContext } from '../cli/context.mjs'

/** A `CliContext` backed by in-memory buffers, for driving CLI subcommands directly in tests. */
export interface FakeCliContext extends CliContext {
  stdoutLines: string[]
  stderrLines: string[]
}

async function* emptyStdin(): AsyncGenerator<string> {
  // yields nothing — used when a test doesn't pipe anything via stdin
}

export function fakeStdin(chunks: Array<string | Buffer>): AsyncIterable<Buffer | string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

export function createFakeContext(
  overrides: Pick<CliContext, 'env'> & Partial<Pick<CliContext, 'stdin'>>,
): FakeCliContext {
  const stdoutLines: string[] = []
  const stderrLines: string[] = []
  return {
    env: overrides.env,
    stdin: overrides.stdin ?? emptyStdin(),
    stdout: {
      write: (chunk: string) => {
        stdoutLines.push(chunk)
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderrLines.push(chunk)
      },
    },
    stdoutLines,
    stderrLines,
  }
}
