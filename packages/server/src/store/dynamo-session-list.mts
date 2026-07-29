import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { sessionIdFromSk, sessionSk, sessionsPk } from './dynamo-keys.mjs'
import { buildSessionFilter } from './dynamo-session-filter.mjs'
import { itemToSession } from './dynamo-sessions.mjs'
import {
  decodeSessionCursor,
  encodeSessionCursor,
  type SessionCursorKey,
} from './session-cursor.mjs'
import {
  DEFAULT_SESSIONS_LIMIT,
  MAX_SESSIONS_LIMIT,
  type ListSessionsQuery,
  type ListSessionsResult,
} from './store.mjs'

const SESSIONS_BY_CREATED_AT_INDEX = 'SessionsByCreatedAt'

function exclusiveStartKey(credId: string, key: SessionCursorKey): Record<string, unknown> {
  return { PK: sessionsPk(credId), sessionCreatedAt: key.createdAt, SK: sessionSk(key.sessionId) }
}

/**
 * Single-page session list via the sparse `SessionsByCreatedAt` GSI.
 * DynamoDB applies `FilterExpression` AFTER `Limit`, so the returned
 * `sessions` array may be shorter than `limit` (even empty) while
 * `nextCursor` is still non-null — callers must keep paging on `nextCursor`
 * alone, never on `sessions.length`.
 */
export async function dynamoListSessions(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  query: ListSessionsQuery = {},
  now: Date = new Date(),
): Promise<ListSessionsResult> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_SESSIONS_LIMIT, 1), MAX_SESSIONS_LIMIT)
  const filter = buildSessionFilter(query, now)

  const page = await doc.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: SESSIONS_BY_CREATED_AT_INDEX,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeNames: filter.ExpressionAttributeNames,
      ExpressionAttributeValues: { ':pk': sessionsPk(credId), ...filter.ExpressionAttributeValues },
      FilterExpression: filter.FilterExpression,
      ExclusiveStartKey:
        query.cursor === undefined
          ? undefined
          : exclusiveStartKey(credId, decodeSessionCursor(query.cursor)),
      Limit: limit,
    }),
  )

  const sessions = (page.Items ?? []).map((item) => itemToSession(item))
  const lastKey = page.LastEvaluatedKey
  const nextCursor = lastKey
    ? encodeSessionCursor({
        createdAt: lastKey.sessionCreatedAt as string,
        sessionId: sessionIdFromSk(lastKey.SK as string),
      })
    : null

  return { sessions, nextCursor }
}
