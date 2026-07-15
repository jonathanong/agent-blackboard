import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { hashToken } from '../auth/hash.mjs'
import { generateJournalingToken } from '../auth/tokens.mjs'
import type { CredentialRecord } from '../core/types.mjs'
import type { CredentialIdOrName } from './store.mjs'

const CREDENTIAL_PK = 'CRED'

function itemToCredential(item: Record<string, unknown>): CredentialRecord {
  return {
    id: item.id as string,
    name: item.name as string,
    tokenHash: item.tokenHash as string,
    createdAt: item.createdAt as string,
  }
}

export async function dynamoCreateCredential(
  doc: DynamoDBDocumentClient,
  tableName: string,
  now: () => Date,
  name: string,
): Promise<{ record: CredentialRecord; token: string }> {
  const { credId, token } = generateJournalingToken()
  const record: CredentialRecord = {
    id: credId,
    name,
    tokenHash: hashToken(token),
    createdAt: now().toISOString(),
  }
  await doc.send(
    new PutCommand({ TableName: tableName, Item: { PK: CREDENTIAL_PK, SK: record.id, ...record } }),
  )
  return { record, token }
}

export async function dynamoListCredentials(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<CredentialRecord[]> {
  const results: CredentialRecord[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': CREDENTIAL_PK },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )
    for (const item of page.Items ?? []) results.push(itemToCredential(item))
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)
  return results
}

export async function dynamoGetCredentialById(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
): Promise<CredentialRecord | undefined> {
  const result = await doc.send(
    new GetCommand({ TableName: tableName, Key: { PK: CREDENTIAL_PK, SK: id } }),
  )
  return result.Item ? itemToCredential(result.Item) : undefined
}

async function dynamoDeleteCredentialById(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
): Promise<boolean> {
  const result = await doc.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: CREDENTIAL_PK, SK: id },
      ReturnValues: 'ALL_OLD',
    }),
  )
  return result.Attributes !== undefined
}

/** Deletes by `id` if given, else deletes ALL credentials matching `name` (names aren't unique) — returns whether anything was deleted. */
export async function dynamoDeleteCredential(
  doc: DynamoDBDocumentClient,
  tableName: string,
  idOrName: CredentialIdOrName,
): Promise<boolean> {
  if (idOrName.id) return dynamoDeleteCredentialById(doc, tableName, idOrName.id)
  if (idOrName.name) {
    const all = await dynamoListCredentials(doc, tableName)
    const matches = all.filter((record) => record.name === idOrName.name)
    if (matches.length === 0) return false
    await Promise.all(
      matches.map((record) => dynamoDeleteCredentialById(doc, tableName, record.id)),
    )
    return true
  }
  return false
}
