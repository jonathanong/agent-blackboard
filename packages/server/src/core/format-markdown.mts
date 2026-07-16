import type { TelemetryEntry } from './types.mjs'

/** One `##` heading per entry (timestamp + session), with `data` rendered as a fenced JSON code block. */
export async function* formatMarkdown(
  entries: AsyncIterable<TelemetryEntry>,
): AsyncGenerator<string> {
  for await (const entry of entries) {
    yield `## ${entry.createdAt} — session ${entry.sessionId} (${entry.agent})\n\n`
    yield '```json\n'
    yield `${JSON.stringify(entry.data, null, 2)}\n`
    yield '```\n\n'
  }
}
