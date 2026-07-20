import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Session } from '../core/types.mjs'
import { SessionStoreError } from './errors.mjs'
import { sessionSk, sessionsPk } from './dynamo-keys.mjs'
import { fanOutEntryTtl } from './dynamo-session-ttl.mjs'
import type { NewSession } from './store.mjs'

export function itemToSession(item: Record<string, unknown>): Session {
  return {
    id: item.id as string,
    parentSessionId: (item.parentSessionId as string | null) ?? null,
    agent: item.agent as string,
    version: item.version as string,
    createdAt: item.createdAt as string,
    archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
    data: item.data as Record<string, unknown>,
  }
}

export async function dynamoGetSession(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  sessionId: string,
): Promise<Session | undefined> {
  const result = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: sessionsPk(credId), SK: sessionSk(sessionId) },
      ConsistentRead: true,
    }),
  )
  return result.Item ? itemToSession(result.Item) : undefined
}

async function explainCreateFailure(
  doc: DynamoDBDocumentClient,
  tableName: string,
  input: NewSession,
): Promise<never> {
  if (await dynamoGetSession(doc, tableName, input.credId, input.id)) {
    throw new SessionStoreError('session_exists', `session already exists: ${input.id}`)
  }
  if (input.parentSessionId !== null) {
    const parent = await dynamoGetSession(doc, tableName, input.credId, input.parentSessionId)
    if (!parent) {
      throw new SessionStoreError(
        'parent_not_found',
        `parent session not found: ${input.parentSessionId}`,
      )
    }
    if (parent.archivedAt !== null) {
      throw new SessionStoreError(
        'parent_archived',
        `parent session is archived: ${input.parentSessionId}`,
      )
    }
  }
  throw new Error('session creation transaction failed')
}

export async function dynamoCreateSession(
  doc: DynamoDBDocumentClient,
  tableName: string,
  now: () => Date,
  input: NewSession,
): Promise<Session> {
  const session: Session = {
    id: input.id,
    parentSessionId: input.parentSessionId,
    agent: input.agent,
    version: input.version,
    createdAt: now().toISOString(),
    archivedAt: null,
    data: {},
  }
  const item = {
    PK: sessionsPk(input.credId),
    SK: sessionSk(input.id),
    entityType: 'session',
    id: session.id,
    parentSessionId: session.parentSessionId,
    agent: session.agent,
    version: session.version,
    createdAt: session.createdAt,
    sessionCreatedAt: session.createdAt,
    data: session.data,
  }
  try {
    if (input.parentSessionId === null) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      )
    } else {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: tableName,
                Key: { PK: sessionsPk(input.credId), SK: sessionSk(input.parentSessionId) },
                ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(archivedAt)',
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: item,
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      )
    }
    return session
  } catch (error) {
    if (
      error instanceof Error &&
      ['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(error.name)
    ) {
      return explainCreateFailure(doc, tableName, input)
    }
    throw error
  }
}

export async function dynamoArchiveSession(
  doc: DynamoDBDocumentClient,
  tableName: string,
  ttlDays: number,
  now: () => Date,
  credId: string,
  sessionId: string,
): Promise<Session> {
  const existing = await dynamoGetSession(doc, tableName, credId, sessionId)
  if (!existing) throw new SessionStoreError('session_not_found', `session not found: ${sessionId}`)
  if (existing.archivedAt !== null) return existing
  const ttl = Math.floor(now().getTime() / 1000) + ttlDays * 86400
  // Fan ttl onto every entry BEFORE flipping archivedAt. The flip below is
  // conditioned on attribute_not_exists(archivedAt), so if this process dies
  // partway through the entry fan-out, the session stays un-archived and a
  // retry re-runs this entire function from scratch — each entry's
  // UpdateItem re-sets the same ttl value, so replaying is safe/idempotent.
  // Flipping archivedAt first would instead strand entries with no ttl and
  // no way to detect/recover them, since the session would already read as
  // archived and nothing would ever revisit it.
  await fanOutEntryTtl(doc, tableName, credId, sessionId, ttl)
  const result = await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: sessionsPk(credId), SK: sessionSk(sessionId) },
      UpdateExpression: 'SET archivedAt = :archivedAt, #ttl = :ttl',
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(archivedAt)',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':archivedAt': now().toISOString(), ':ttl': ttl },
      ReturnValues: 'ALL_NEW',
    }),
  )
  if (!result.Attributes) throw new Error('archive update returned no session')
  return itemToSession(result.Attributes)
}
