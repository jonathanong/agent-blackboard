import { CliError } from './errors.mjs'

export function parseDataArrayContains(
  raw: string | undefined,
  command: string,
): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    const entries = Object.entries(parsed)
    if (
      entries.length === 0 ||
      entries.some(
        ([key, value]) => key.length === 0 || typeof value !== 'string' || value.length === 0,
      )
    ) {
      throw new Error()
    }
    return parsed as Record<string, string>
  } catch {
    throw new CliError(`${command} must be a JSON object with string values.`)
  }
}
