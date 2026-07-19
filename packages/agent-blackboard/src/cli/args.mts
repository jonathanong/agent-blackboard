export interface ParsedArgs {
  positional: string[]
  flags: Record<string, string | boolean>
}

/**
 * A minimal, zero-dependency `argv` parser. Supports `--flag value`,
 * `--flag=value`, and bare boolean flags (`--flag` with no following
 * value, or immediately followed by another `--flag`).
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const body = arg.slice(2)
    const eqIndex = body.indexOf('=')
    if (eqIndex !== -1) {
      flags[body.slice(0, eqIndex)] = body.slice(eqIndex + 1)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next
      i += 1
    } else {
      flags[body] = true
    }
  }
  return { positional, flags }
}

/** Reads a flag expected to be a string; `undefined` if unset or given as a bare boolean. */
export function stringFlag(flags: ParsedArgs['flags'], key: string): string | undefined {
  const value = flags[key]
  return typeof value === 'string' ? value : undefined
}
