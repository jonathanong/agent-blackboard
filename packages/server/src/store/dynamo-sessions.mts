import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Session } from '../core/types.mjs'
import { SessionStoreError } from './errors.mjs'
import { sessionSk, sessionsPk } from './dynamo-keys.mjs'
import type { NewSession } from './store.mjs'

export function itemToSession(item: Record<string, unknown>): Session {
  return {
    id: item.id as string,
    parentSessionId: (item.parentSessionId as string | null) ?? null,
    agent: item.agent as string,
    version: item.version as string,
    createdAt: item.createdAt as string,
    lastEntryAt: typeof item.lastEntryAt === 'string' ? item.lastEntryAt : null,
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
    lastEntryAt: null,
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
                ConditionExpression: 'attribute_exists(PK)',
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
  now: () => Date,
  credId: string,
  sessionId: string,
): Promise<Session> {
  const existing = await dynamoGetSession(doc, tableName, credId, sessionId)
  if (!existing) throw new SessionStoreError('session_not_found', `session not found: ${sessionId}`)
  if (existing.archivedAt !== null) return existing
  const result = await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: sessionsPk(credId), SK: sessionSk(sessionId) },
      UpdateExpression: 'SET archivedAt = :archivedAt',
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(archivedAt)',
      ExpressionAttributeValues: { ':archivedAt': now().toISOString() },
      ReturnValues: 'ALL_NEW',
    }),
  )
  if (!result.Attributes) throw new Error('archive update returned no session')
  return itemToSession(result.Attributes)
}
