import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { TelemetryEntry } from '../core/types.mjs'
import { generateEntryId } from './ids.mjs'
import type { EntryFilter, NewTelemetryEntry } from './store.mjs'
import { MAX_APPEND_BATCH_SIZE } from './store.mjs'

const QUERY_PAGE_LIMIT = 100

/** Narrows a raw DynamoDB item (which also carries `PK`/`SK`) down to the public `TelemetryEntry` shape. Exported for dynamo-entries-patch.mts. */
export function itemToEntry(item: Record<string, unknown>): TelemetryEntry {
  return {
    id: item.id as string,
    credId: item.credId as string,
    sessionId: item.sessionId as string,
    agent: item.agent as string,
    createdAt: item.createdAt as string,
    archived: item.archived as boolean,
    data: item.data as Record<string, unknown>,
    ttl: item.ttl as number,
  }
}

export async function dynamoAppendEntry(
  doc: DynamoDBDocumentClient,
  tableName: string,
  ttlDays: number,
  now: () => Date,
  entry: NewTelemetryEntry,
): Promise<TelemetryEntry> {
  const nowDate = now()
  const id = `${entry.sessionId}#${generateEntryId(nowDate)}`
  const record: TelemetryEntry = {
    id,
    credId: entry.credId,
    sessionId: entry.sessionId,
    agent: entry.agent,
    createdAt: nowDate.toISOString(),
    archived: false,
    data: entry.data,
    ttl: Math.floor(nowDate.getTime() / 1000) + ttlDays * 86400,
  }
  await doc.send(
    new PutCommand({ TableName: tableName, Item: { PK: record.credId, SK: record.id, ...record } }),
  )
  return record
}

/**
 * Appends every entry in one atomic transaction — all commit or none do.
 * Fixes a real failure mode of appending sequentially with independent
 * `PutItem` calls: a partial failure (or a Lambda timeout) could leave an
 * unknown prefix of the batch committed, and a client retry with fresh ids
 * would then duplicate that prefix. `TransactWriteItems` has a hard 100-item
 * limit, hence `MAX_APPEND_BATCH_SIZE` — callers must reject an oversized
 * batch before it reaches here (the HTTP layer does); this is a defensive
 * backstop, not the primary enforcement point.
 */
export async function dynamoAppendEntries(
  doc: DynamoDBDocumentClient,
  tableName: string,
  ttlDays: number,
  now: () => Date,
  entries: NewTelemetryEntry[],
): Promise<TelemetryEntry[]> {
  if (entries.length === 0) return []
  if (entries.length > MAX_APPEND_BATCH_SIZE) {
    throw new Error(
      `Batch of ${entries.length} entries exceeds MAX_APPEND_BATCH_SIZE (${MAX_APPEND_BATCH_SIZE})`,
    )
  }
  const nowDate = now()
  const records: TelemetryEntry[] = entries.map((entry) => ({
    id: `${entry.sessionId}#${generateEntryId(nowDate)}`,
    credId: entry.credId,
    sessionId: entry.sessionId,
    agent: entry.agent,
    createdAt: nowDate.toISOString(),
    archived: false,
    data: entry.data,
    ttl: Math.floor(nowDate.getTime() / 1000) + ttlDays * 86400,
  }))
  await doc.send(
    new TransactWriteCommand({
      TransactItems: records.map((record) => ({
        Put: { TableName: tableName, Item: { PK: record.credId, SK: record.id, ...record } },
      })),
    }),
  )
  return records
}

function buildEntryFilter(filter: EntryFilter): {
  filterExpression: string | undefined
  expressionValues: Record<string, unknown>
  expressionNames: Record<string, string> | undefined
} {
  const clauses: string[] = []
  const expressionValues: Record<string, unknown> = {}
  const expressionNames: Record<string, string> = {}
  if (filter.agent !== undefined) {
    clauses.push('#agent = :agent')
    expressionNames['#agent'] = 'agent'
    expressionValues[':agent'] = filter.agent
  }
  if (filter.archived !== undefined) {
    clauses.push('#archived = :archived')
    expressionNames['#archived'] = 'archived'
    expressionValues[':archived'] = filter.archived
  }
  return {
    filterExpression: clauses.length > 0 ? clauses.join(' AND ') : undefined,
    expressionValues,
    expressionNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
  }
}

export async function* dynamoGetEntries(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  filter: EntryFilter,
): AsyncGenerator<TelemetryEntry> {
  const { filterExpression, expressionValues, expressionNames } = buildEntryFilter(filter)
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: tableName,
        Limit: QUERY_PAGE_LIMIT,
        ExclusiveStartKey: exclusiveStartKey,
        KeyConditionExpression: filter.sessionId
          ? 'PK = :pk AND begins_with(SK, :skPrefix)'
          : 'PK = :pk',
        FilterExpression: filterExpression,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: {
          ':pk': credId,
          ...(filter.sessionId ? { ':skPrefix': `${filter.sessionId}#` } : {}),
          ...expressionValues,
        },
      }),
    )
    for (const item of page.Items ?? []) {
      yield itemToEntry(item)
    }
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)
}
