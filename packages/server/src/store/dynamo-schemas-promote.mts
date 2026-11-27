import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { SCHEMAS_PK, SCHEMA_VERSIONS_PK, schemaSk, schemaVersionSk } from './dynamo-keys.mjs'
import { dynamoGetSchemaHead, dynamoGetSchemaRegistryRevision } from './dynamo-schemas-read.mjs'
import {
  isRetryableTransactionCanceled,
  itemToSchemaVersion,
  registryMetaTxItem,
} from './dynamo-schemas-tx.mjs'
import { SessionStoreError } from './errors.mjs'
import type { PromoteSchemaVersionResult } from './store.mjs'

const REVISION_RETRIES = 20

export async function dynamoPromoteSchemaVersion(
  doc: DynamoDBDocumentClient,
  tableName: string,
  now: () => Date,
  id: string,
  version: number,
  actor: string,
): Promise<PromoteSchemaVersionResult> {
  for (let attempt = 0; attempt < REVISION_RETRIES; attempt++) {
    const [currentRevision, head, versionRes] = await Promise.all([
      dynamoGetSchemaRegistryRevision(doc, tableName),
      dynamoGetSchemaHead(doc, tableName, id),
      doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: SCHEMA_VERSIONS_PK, SK: schemaVersionSk(id, version) },
          ConsistentRead: true,
        }),
      ),
    ])
    if (!head || !versionRes.Item) {
      throw new SessionStoreError('schema_not_found', `schema version not found: ${id}@${version}`)
    }
    if (head.deprecatedAt !== null) {
      throw new SessionStoreError('schema_deprecated', `schema is deprecated: ${id}`)
    }
    const existing = itemToSchemaVersion(versionRes.Item)
    if (existing.mode === 'enforced') {
      return {
        revision: currentRevision,
        summary: head,
        versionRecord: existing,
        alreadyEnforced: true,
      }
    }
    const timestamp = now().toISOString()
    const nextRevision = currentRevision + 1
    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            registryMetaTxItem(tableName, currentRevision, nextRevision, timestamp),
            {
              Update: {
                TableName: tableName,
                Key: { PK: SCHEMAS_PK, SK: schemaSk(id) },
                UpdateExpression: 'SET updatedAt = :now, updatedBy = :actor',
                ConditionExpression: 'attribute_exists(PK) AND deprecatedAt = :null',
                ExpressionAttributeValues: { ':now': timestamp, ':actor': actor, ':null': null },
              },
            },
            {
              Update: {
                TableName: tableName,
                Key: { PK: SCHEMA_VERSIONS_PK, SK: schemaVersionSk(id, version) },
                UpdateExpression: 'SET #mode = :enforced, promotedAt = :now, promotedBy = :actor',
                ConditionExpression: 'attribute_exists(PK) AND #mode = :shadow',
                ExpressionAttributeNames: { '#mode': 'mode' },
                ExpressionAttributeValues: {
                  ':enforced': 'enforced',
                  ':shadow': 'shadow',
                  ':now': timestamp,
                  ':actor': actor,
                },
              },
            },
          ],
        }),
      )
      return {
        revision: nextRevision,
        summary: { ...head, updatedAt: timestamp, updatedBy: actor },
        versionRecord: {
          ...existing,
          mode: 'enforced',
          promotedAt: timestamp,
          promotedBy: actor,
        },
        alreadyEnforced: false,
      }
    } catch (error) {
      if (!isRetryableTransactionCanceled(error)) throw error
    }
  }
  throw new SessionStoreError(
    'schema_conflict',
    `could not promote schema ${id}@${version} due to contention`,
  )
}
