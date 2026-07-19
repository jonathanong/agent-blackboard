import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { SessionEntry } from '../core/types.mjs'
import { entrySk, entriesPk, sessionSk, sessionsPk } from './dynamo-keys.mjs'
import { dynamoGetSession } from './dynamo-sessions.mjs'
import { SessionStoreError } from './errors.mjs'
import type { EntryPatch, NewSessionEntry } from './store.mjs'

const QUERY_PAGE_LIMIT = 100
const TIMESTAMP_RETRIES = 100

export function itemToEntry(item: Record<string, unknown>): SessionEntry {
  return {
    sessionId: item.sessionId as string,
    createdAt: item.createdAt as string,
    data: item.data as Record<string, unknown>,
  }
}

async function requireActiveSession(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  sessionId: string,
): Promise<void> {
  const session = await dynamoGetSession(doc, tableName, credId, sessionId)
  if (!session) throw new SessionStoreError('session_not_found', `session not found: ${sessionId}`)
  if (session.archivedAt !== null) {
    throw new SessionStoreError('session_archived', `session is archived: ${sessionId}`)
  }
}

export async function dynamoAppendEntry(
  doc: DynamoDBDocumentClient,
  tableName: string,
  ttlDays: number,
  now: () => Date,
  input: NewSessionEntry,
): Promise<SessionEntry> {
  const initial = now().getTime()
  for (let offset = 0; offset < TIMESTAMP_RETRIES; offset++) {
    const createdAt = new Date(initial + offset).toISOString()
    const entry: SessionEntry = { sessionId: input.sessionId, createdAt, data: input.data }
    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: tableName,
                Key: { PK: sessionsPk(input.credId), SK: sessionSk(input.sessionId) },
                ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(archivedAt)',
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: {
                  PK: entriesPk(input.credId, input.sessionId),
                  SK: entrySk(createdAt),
                  entityType: 'entry',
                  ...entry,
                  ttl: Math.floor((initial + offset) / 1000) + ttlDays * 86400,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      )
      return entry
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') throw error
      await requireActiveSession(doc, tableName, input.credId, input.sessionId)
    }
  }
  throw new Error(`could not allocate a unique timestamp for session ${input.sessionId}`)
}

export async function* dynamoGetEntries(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  sessionId: string,
): AsyncGenerator<SessionEntry> {
  await requireActiveSession(doc, tableName, credId, sessionId)
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': entriesPk(credId, sessionId),
          ':sk': 'ENTRY#',
        },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: QUERY_PAGE_LIMIT,
      }),
    )
    for (const item of page.Items ?? []) yield itemToEntry(item)
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)
}

export async function dynamoPatchEntry(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  patch: EntryPatch,
): Promise<SessionEntry> {
  await requireActiveSession(doc, tableName, credId, patch.sessionId)
  const key = { PK: entriesPk(credId, patch.sessionId), SK: entrySk(patch.createdAt) }
  const existing = await doc.send(
    new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }),
  )
  if (!existing.Item) {
    throw new SessionStoreError(
      'entry_not_found',
      `entry not found: ${patch.sessionId} at ${patch.createdAt}`,
    )
  }
  const updated = {
    ...itemToEntry(existing.Item),
    data: { ...itemToEntry(existing.Item).data, ...patch.data },
  }
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: sessionsPk(credId), SK: sessionSk(patch.sessionId) },
              ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(archivedAt)',
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: { ...existing.Item, data: updated.data },
              ConditionExpression: 'attribute_exists(PK)',
            },
          },
        ],
      }),
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'TransactionCanceledException') {
      await requireActiveSession(doc, tableName, credId, patch.sessionId)
    }
    throw error
  }
  return updated
}
