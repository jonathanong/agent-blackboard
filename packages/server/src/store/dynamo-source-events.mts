import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import type { AppendedSessionEntry, SessionEntry } from '../core/types.mjs'
import { entrySk, entriesPk, sourceEventSk, sourceEventsPk } from './dynamo-keys.mjs'
import { sourceEventConflictError } from './source-event.mjs'
import type { NewSessionEntry } from './store.mjs'

export function sourceEventPutItem(
  tableName: string,
  input: NewSessionEntry & { sourceEventId: string },
  contentHash: string,
  createdAt: string,
  ttl: number,
) {
  return {
    Put: {
      TableName: tableName,
      Item: {
        PK: sourceEventsPk(input.credId, input.sessionId),
        SK: sourceEventSk(input.sourceEventId),
        entityType: 'source_event',
        sourceEventId: input.sourceEventId,
        contentHash,
        entryCreatedAt: createdAt,
        ttl,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  }
}

export interface SourceEventLookup {
  credId: string
  sessionId: string
  sourceEventId: string
}

export async function resolveExistingSourceEvent(
  doc: DynamoDBDocumentClient,
  tableName: string,
  input: SourceEventLookup,
  contentHash: string,
  mapEntry: (item: Record<string, unknown>) => SessionEntry,
): Promise<AppendedSessionEntry | undefined> {
  const existing = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: sourceEventsPk(input.credId, input.sessionId),
        SK: sourceEventSk(input.sourceEventId),
      },
      ConsistentRead: true,
    }),
  )
  if (!existing.Item) return undefined
  const storedHash = existing.Item.contentHash as string
  const entryCreatedAt = existing.Item.entryCreatedAt as string
  if (storedHash !== contentHash) {
    throw sourceEventConflictError(input.sessionId, entryCreatedAt, input.sourceEventId)
  }
  const entryResult = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: entriesPk(input.credId, input.sessionId),
        SK: entrySk(entryCreatedAt),
      },
      ConsistentRead: true,
    }),
  )
  if (!entryResult.Item) {
    // DynamoDB TTL deletes expired items asynchronously, so the entry can vanish while its
    // source-event marker still exists. Remove the stale marker conditionally so the retry can
    // write a fresh entry instead of failing repeatedly until the marker is reaped.
    try {
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            PK: sourceEventsPk(input.credId, input.sessionId),
            SK: sourceEventSk(input.sourceEventId),
          },
          ConditionExpression: 'entryCreatedAt = :entryCreatedAt',
          ExpressionAttributeValues: { ':entryCreatedAt': entryCreatedAt },
        }),
      )
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error
    }
    return undefined
  }
  return { ...mapEntry(entryResult.Item), duplicate: true }
}
