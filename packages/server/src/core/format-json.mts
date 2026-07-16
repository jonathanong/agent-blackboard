import type { TelemetryEntry } from './types.mjs'

/** Streams entries as a JSON array without buffering the full result set. */
export async function* formatJson(entries: AsyncIterable<TelemetryEntry>): AsyncGenerator<string> {
  yield '['
  let first = true
  for await (const entry of entries) {
    yield `${first ? '' : ','}${JSON.stringify(entry)}`
    first = false
  }
  yield ']'
}
