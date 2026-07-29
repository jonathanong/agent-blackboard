import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'

const MARKER_KEY = {
  PK: 'MIGRATION',
  SK: 'ENTRY_TTL_AND_LAST_ENTRY_AT_V1',
}
const ENTRY_PK_PREFIX = 'ENTRIES#'
const SESSION_PK_PREFIX = 'SESSIONS#'

function isConditionalFailure(error) {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException'
}

function entryOwner(item) {
  const pk = item.PK
  if (typeof pk !== 'string' || !pk.startsWith(ENTRY_PK_PREFIX)) return undefined
  const separator = pk.indexOf('#', ENTRY_PK_PREFIX.length)
  if (separator === -1 || typeof item.sessionId !== 'string') {
    throw new Error(`entry has invalid owner keys: ${String(item.PK)} / ${String(item.SK)}`)
  }
  return {
    PK: `${SESSION_PK_PREFIX}${pk.slice(ENTRY_PK_PREFIX.length, separator)}`,
    SK: `SESSION#${item.sessionId}`,
  }
}

function entryTtl(createdAt, ttlDays) {
  if (typeof createdAt !== 'string') throw new Error('entry createdAt must be an ISO timestamp')
  const createdAtMs = Date.parse(createdAt)
  if (Number.isNaN(createdAtMs)) throw new Error(`entry createdAt is invalid: ${createdAt}`)
  return Math.floor(createdAtMs / 1000) + ttlDays * 86400
}

async function updateIfPresent(doc, input) {
  try {
    await doc.send(new UpdateCommand(input))
    return true
  } catch (error) {
    if (isConditionalFailure(error)) return false
    throw error
  }
}

async function migrateItem(doc, tableName, ttlDays, item) {
  if (typeof item.PK === 'string' && item.PK.startsWith(SESSION_PK_PREFIX)) {
    if (item.ttl === undefined) return { sessions: 0, entries: 0 }
    const changed = await updateIfPresent(doc, {
      TableName: tableName,
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression: 'REMOVE #ttl',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
    })
    return { sessions: changed ? 1 : 0, entries: 0 }
  }

  const owner = entryOwner(item)
  if (!owner) return { sessions: 0, entries: 0 }
  const ttl = entryTtl(item.createdAt, ttlDays)
  const entryChanged = await updateIfPresent(doc, {
    TableName: tableName,
    Key: { PK: item.PK, SK: item.SK },
    UpdateExpression: 'SET #ttl = :ttl',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: { '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':ttl': ttl },
  })
  await updateIfPresent(doc, {
    TableName: tableName,
    Key: owner,
    UpdateExpression: 'SET lastEntryAt = :createdAt',
    ConditionExpression:
      'attribute_exists(PK) AND (attribute_not_exists(lastEntryAt) OR lastEntryAt < :createdAt)',
    ExpressionAttributeValues: { ':createdAt': item.createdAt },
  })
  return { sessions: 0, entries: entryChanged ? 1 : 0 }
}

export function migrationClient(region) {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  })
}

export async function migrateEntryMetadata({ doc, tableName, ttlDays, now = () => new Date() }) {
  const marker = await doc.send(
    new GetCommand({ TableName: tableName, Key: MARKER_KEY, ConsistentRead: true }),
  )
  if (marker.Item) return { migrated: false, sessions: 0, entries: 0 }

  let sessions = 0
  let entries = 0
  let exclusiveStartKey
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: 'PK, SK, sessionId, createdAt, #ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )
    for (const item of page.Items ?? []) {
      const changed = await migrateItem(doc, tableName, ttlDays, item)
      sessions += changed.sessions
      entries += changed.entries
    }
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)

  try {
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: { ...MARKER_KEY, migratedAt: now().toISOString(), ttlDays },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    )
  } catch (error) {
    if (!isConditionalFailure(error)) throw error
  }
  return { migrated: true, sessions, entries }
}
