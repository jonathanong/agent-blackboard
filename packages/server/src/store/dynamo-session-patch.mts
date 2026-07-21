import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Session } from '../core/types.mjs'
import { SessionStoreError } from './errors.mjs'
import { dynamoGetSession, itemToSession } from './dynamo-sessions.mjs'
import { sessionSk, sessionsPk } from './dynamo-keys.mjs'
import type { SessionPatch } from './store.mjs'

export async function dynamoPatchSession(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  patch: SessionPatch,
): Promise<Session> {
  const entries = Object.entries(patch.data)
  if (entries.length === 0) {
    throw new Error('patchSession requires at least one key in data')
  }
  const names: Record<string, string> = { '#data': 'data' }
  const values: Record<string, unknown> = {}
  const assignments = entries.map(([key, value], index) => {
    names[`#key${index}`] = key
    values[`:value${index}`] = value
    return `#data.#key${index} = :value${index}`
  })
  try {
    const result = await doc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: sessionsPk(credId), SK: sessionSk(patch.sessionId) },
        UpdateExpression: `SET ${assignments.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(archivedAt)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    )
    if (!result.Attributes) throw new Error('session patch returned no session')
    return itemToSession(result.Attributes)
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error
    const session = await dynamoGetSession(doc, tableName, credId, patch.sessionId)
    if (!session) {
      throw new SessionStoreError('session_not_found', `session not found: ${patch.sessionId}`)
    }
    throw new SessionStoreError('session_archived', `session is archived: ${patch.sessionId}`)
  }
}
