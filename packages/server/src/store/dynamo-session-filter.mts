import type { ListSessionsQuery } from './store.mjs'

/** DynamoDB `FilterExpression` pieces for server-side `listSessions` pushdown. */
export interface SessionFilter {
  FilterExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, unknown>
}

export function buildSessionFilter(query: ListSessionsQuery): SessionFilter {
  const expressions: string[] = []
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}

  if (query.archived !== undefined) {
    names['#archivedAt'] = 'archivedAt'
    expressions.push(
      query.archived ? 'attribute_exists(#archivedAt)' : 'attribute_not_exists(#archivedAt)',
    )
  }
  if (query.agent !== undefined) {
    names['#agent'] = 'agent'
    values[':agent'] = query.agent
    expressions.push('#agent = :agent')
  }
  if (query.version !== undefined) {
    names['#version'] = 'version'
    values[':version'] = query.version
    expressions.push('#version = :version')
  }
  if (query.parentSessionId !== undefined) {
    names['#parentSessionId'] = 'parentSessionId'
    values[':parentSessionId'] = query.parentSessionId
    expressions.push('#parentSessionId = :parentSessionId')
  }
  if (query.data && Object.keys(query.data).length > 0) {
    names['#data'] = 'data'
    for (const [index, [key, value]] of Object.entries(query.data).entries()) {
      const nameToken = `#dataKey${index}`
      const valueToken = `:dataValue${index}`
      names[nameToken] = key
      values[valueToken] = value
      expressions.push(`#data.${nameToken} = ${valueToken}`)
    }
  }

  if (expressions.length === 0) return {}
  return {
    FilterExpression: expressions.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }
}
