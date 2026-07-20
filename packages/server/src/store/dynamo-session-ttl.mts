import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { entriesPk } from './dynamo-keys.mjs'

const QUERY_PAGE_LIMIT = 100

/**
 * Sets `ttl` on every entry belonging to a session, via one single-attribute
 * `UpdateItem` per entry (never `BatchWriteCommand`'s `PutRequest`, which
 * would overwrite the whole item and destroy `data`/`createdAt`/etc).
 *
 * Paginates with the same `QueryCommand` shape `dynamoGetEntries` uses
 * (`packages/server/src/store/dynamo-entries.mts`). Duplicated here rather
 * than imported from that module to avoid a circular import:
 * `dynamo-entries.mts` already imports `dynamoGetSession` from
 * `dynamo-sessions.mts`, which is this function's only caller.
 *
 * Uses `ConsistentRead` — an eventually-consistent query could miss an entry
 * appended just before archival, and once `archivedAt` flips no further
 * append can ever surface it, stranding that entry with no `ttl`.
 */
export async function fanOutEntryTtl(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  sessionId: string,
  ttl: number,
): Promise<void> {
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
        ConsistentRead: true,
      }),
    )
    for (const item of page.Items ?? []) {
      await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: item.PK as string, SK: item.SK as string },
          UpdateExpression: 'SET #ttl = :ttl',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':ttl': ttl },
        }),
      )
    }
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)
}
