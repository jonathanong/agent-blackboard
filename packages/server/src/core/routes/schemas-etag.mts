export const SCHEMA_REVISION_HEADER = 'x-schema-registry-revision'

/** Canonical strong ETag for a schema registry revision. */
export function schemaRegistryEtag(revision: number): string {
  return `"rev-${revision}"`
}

function stripWeakPrefix(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/**
 * Evaluates an HTTP `If-None-Match` header against the current registry ETag,
 * supporting `*`, comma-separated lists, and weak `W/` tags per RFC 9110.
 */
export function etagMatches(ifNoneMatch: string | undefined, currentEtag: string): boolean {
  if (!ifNoneMatch) return false
  for (const part of ifNoneMatch.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '*' || stripWeakPrefix(trimmed) === currentEtag) return true
  }
  return false
}

export function revisionHeaders(
  revision: number,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { [SCHEMA_REVISION_HEADER]: String(revision), ...extra }
}
