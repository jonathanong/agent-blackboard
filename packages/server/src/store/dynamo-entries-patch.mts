// Split out of dynamo-entries.mts purely to stay under the repo's 200-line
// file cap — patchEntries' DynamoDB implementation.
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { JournalEntry } from '../core/types.mjs'
import { itemToEntry } from './dynamo-entries.mjs'
import type { EntryPatch } from './store.mjs'

const PATCH_CONCURRENCY = 10

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
