/**
 * The I/O the CLI depends on, injected so subcommands are testable by
 * calling their exported functions directly (no shelling out to a built
 * binary, no real stdin/stdout).
 */
export interface CliContext {
  env: NodeJS.ProcessEnv
  stdin: AsyncIterable<Buffer | string>
  stdout: { write: (chunk: string) => void }
  stderr: { write: (chunk: string) => void }
}
