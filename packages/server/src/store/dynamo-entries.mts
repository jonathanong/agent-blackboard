import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { JournalEntry } from '../core/types.mjs'
import { generateEntryId } from './ids.mjs'
import type { EntryFilter, EntryPatch, NewJournalEntry } from './store.mjs'

const QUERY_PAGE_LIMIT = 100
const PATCH_CONCURRENCY = 10

/** Narrows a raw DynamoDB item (which also carries `PK`/`SK`) down to the public `JournalEntry` shape. */
function itemToEntry(item: Record<string, unknown>): JournalEntry {
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
  entry: NewJournalEntry,
): Promise<JournalEntry> {
  const nowDate = now()
  const id = `${entry.sessionId}#${generateEntryId(nowDate)}`
  const record: JournalEntry = {
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
): AsyncGenerator<JournalEntry> {
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

function buildPatchUpdate(patch: EntryPatch): {
  setClauses: string[]
  expressionNames: Record<string, string>
  expressionValues: Record<string, unknown>
} {
  const setClauses: string[] = []
  const expressionNames: Record<string, string> = {}
  const expressionValues: Record<string, unknown> = {}
  if (patch.archived !== undefined) {
    setClauses.push('#archived = :archived')
    expressionNames['#archived'] = 'archived'
    expressionValues[':archived'] = patch.archived
  }
  if (patch.data !== undefined) {
    expressionNames['#data'] = 'data'
    Object.entries(patch.data).forEach(([key, value], i) => {
      setClauses.push(`#data.#dk${i} = :dv${i}`)
      expressionNames[`#dk${i}`] = key
      expressionValues[`:dv${i}`] = value
    })
  }
  return { setClauses, expressionNames, expressionValues }
}

/**
 * Applies one patch. Relies on the HTTP layer having already rejected
 * effectively-empty patches (no `archived`, no non-empty `data`) — this
 * assumes `setClauses` is non-empty. Uses `attribute_exists(PK)` so a patch
 * for an unknown id fails the condition instead of upserting a bare item
 * (DynamoDB's `UpdateItem` creates the item by default otherwise).
 */
async function dynamoPatchOne(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  patch: EntryPatch,
): Promise<JournalEntry | undefined> {
  const { setClauses, expressionNames, expressionValues } = buildPatchUpdate(patch)
  try {
    const result = await doc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: credId, SK: patch.id },
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ReturnValues: 'ALL_NEW',
      }),
    )
    return result.Attributes ? itemToEntry(result.Attributes) : undefined
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return undefined
    throw error
  }
}

export async function dynamoPatchEntries(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  patches: EntryPatch[],
): Promise<JournalEntry[]> {
  const results: Array<JournalEntry | undefined> = Array.from(
    { length: patches.length },
    () => undefined,
  )
  for (let start = 0; start < patches.length; start += PATCH_CONCURRENCY) {
    const batch = patches.slice(start, start + PATCH_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map((patch) => dynamoPatchOne(doc, tableName, credId, patch)),
    )
    batchResults.forEach((result, i) => {
      results[start + i] = result
    })
  }
  return results.filter((entry): entry is JournalEntry => entry !== undefined)
}
