export const SCHEMA_REVISION_HEADER = 'x-schema-registry-revision'

/** Canonical strong ETag for a schema registry revision. */
export function schemaRegistryEtag(revision: number): string {
  return `"rev-${revision}"`
}

function stripWeakPrefix(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/** Splits an HTTP entity-tag list on commas outside quoted entity-tags per RFC 9110. */
function splitEntityTags(header: string): string[] {
  const tags: string[] = []
  let start = 0
  let inQuotes = false
  for (let i = 0; i < header.length; i++) {
    const ch = header[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) {
      tags.push(header.slice(start, i).trim())
      start = i + 1
    }
  }
  tags.push(header.slice(start).trim())
  return tags
}

/**
 * Evaluates an HTTP `If-None-Match` header against the current registry ETag,
 * supporting `*`, comma-separated lists (respecting quoted commas), and weak `W/` tags.
 */
export function etagMatches(ifNoneMatch: string | undefined, currentEtag: string): boolean {
  if (!ifNoneMatch) return false
  for (const tag of splitEntityTags(ifNoneMatch)) {
    if (tag === '*' || stripWeakPrefix(tag) === currentEtag) return true
  }
  return false
}

export function revisionHeaders(
  revision: number,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { [SCHEMA_REVISION_HEADER]: String(revision), ...extra }
}
