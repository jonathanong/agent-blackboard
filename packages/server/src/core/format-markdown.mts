import type { SessionEntry } from './types.mjs'

/** One `##` heading per entry (timestamp + session), with `data` rendered as a fenced JSON code block. */
export async function* formatMarkdown(
  entries: AsyncIterable<SessionEntry>,
): AsyncGenerator<string> {
  for await (const entry of entries) {
    const schemaSuffix =
      entry.schemaId !== undefined && entry.schemaVersion !== undefined
        ? ` (${entry.schemaId}@${entry.schemaVersion})`
        : ''
    yield `## ${entry.createdAt} — session ${entry.sessionId}${schemaSuffix}\n\n`
    yield '```json\n'
    yield `${JSON.stringify(entry.data, null, 2)}\n`
    yield '```\n\n'
  }
}
