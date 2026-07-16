import type { TelemetryEntry } from './types.mjs'

/** Streams entries as newline-delimited JSON, one object per line. */
export async function* formatJsonl(entries: AsyncIterable<TelemetryEntry>): AsyncGenerator<string> {
  for await (const entry of entries) {
    yield `${JSON.stringify(entry)}\n`
  }
}
