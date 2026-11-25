import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { SchemaRecord, SchemaVersionRecord } from '../core/types.mjs'
import { formatSchemaRef } from '../schemas/id.mjs'
import { SCHEMAS_PK, schemaSk } from './dynamo-keys.mjs'
import { dynamoGetSchemaHead, dynamoGetSchemaRegistryRevision } from './dynamo-schemas-read.mjs'
import {
  isRetryableTransactionCanceled,
  registryMetaTxItem,
  schemaHeadTxItem,
  schemaVersionTxItem,
} from './dynamo-schemas-tx.mjs'
import { SessionStoreError } from './errors.mjs'
import type {
  DeprecateSchemaResult,
  PutSchemaVersionInput,
  PutSchemaVersionResult,
} from './store.mjs'

const REVISION_RETRIES = 20

export async function dynamoPutSchemaVersion(
  doc: DynamoDBDocumentClient,
  tableName: string,
  now: () => Date,
  input: PutSchemaVersionInput,
): Promise<PutSchemaVersionResult> {
  const nextVersion = input.expectedVersion + 1
  const maxAttempts = input.expectedRevision === undefined ? REVISION_RETRIES : 1
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const [currentRevision, existing] = await Promise.all([
      dynamoGetSchemaRegistryRevision(doc, tableName),
      input.expectedVersion > 0
        ? dynamoGetSchemaHead(doc, tableName, input.id)
        : Promise.resolve(undefined),
    ])
    if (existing !== undefined && existing.deprecatedAt !== null) {
      throw new SessionStoreError('schema_deprecated', `schema is deprecated: ${input.id}`)
    }
    if (input.expectedVersion > 0 && (existing?.latestVersion ?? 0) !== input.expectedVersion) {
      throw new SessionStoreError(
        'schema_conflict',
        `schema ${input.id} was modified concurrently (expected version ${input.expectedVersion})`,
      )
    }
    if (input.expectedRevision !== undefined && currentRevision !== input.expectedRevision) {
      throw new SessionStoreError(
        'schema_conflict',
        `schema registry changed concurrently (expected revision ${input.expectedRevision}, found ${currentRevision})`,
      )
    }

    const timestamp = now().toISOString()
    const nextRevision = currentRevision + 1
    const summary: SchemaRecord = existing
      ? { ...existing, latestVersion: nextVersion, updatedAt: timestamp, updatedBy: input.actor }
      : {
          id: input.id,
          latestVersion: nextVersion,
          deprecatedAt: null,
          deprecatedBy: null,
          createdAt: timestamp,
          createdBy: input.actor,
          updatedAt: timestamp,
          updatedBy: input.actor,
        }
    const versionRecord: SchemaVersionRecord = {
      id: input.id,
      version: nextVersion,
      ref: formatSchemaRef(input.id, nextVersion),
      schema: structuredClone(input.schema),
      mode: input.mode ?? 'enforced',
      createdAt: timestamp,
      createdBy: input.actor,
      promotedAt: null,
      promotedBy: null,
    }

    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            registryMetaTxItem(tableName, currentRevision, nextRevision, timestamp),
            schemaHeadTxItem(tableName, input.expectedVersion, summary, timestamp, input.actor),
            schemaVersionTxItem(tableName, versionRecord),
          ],
        }),
      )
      return { revision: nextRevision, summary, versionRecord }
    } catch (error) {
      if (!isRetryableTransactionCanceled(error)) throw error
      const head = await dynamoGetSchemaHead(doc, tableName, input.id)
      if (head !== undefined && head.deprecatedAt !== null) {
        throw new SessionStoreError('schema_deprecated', `schema is deprecated: ${input.id}`)
      }
      if (
        input.expectedRevision !== undefined ||
        (head?.latestVersion ?? 0) !== input.expectedVersion
      ) {
        throw new SessionStoreError(
          'schema_conflict',
          `schema ${input.id} was modified concurrently (expected version ${input.expectedVersion})`,
        )
      }
    }
  }
  throw new SessionStoreError(
    'schema_conflict',
    `could not allocate schema registry revision for ${input.id}`,
  )
}

export async function dynamoDeprecateSchema(
  doc: DynamoDBDocumentClient,
  tableName: string,
  now: () => Date,
  id: string,
  actor: string,
): Promise<DeprecateSchemaResult> {
  for (let attempt = 0; attempt < REVISION_RETRIES; attempt++) {
    const [currentRevision, existing] = await Promise.all([
      dynamoGetSchemaRegistryRevision(doc, tableName),
      dynamoGetSchemaHead(doc, tableName, id),
    ])
    if (!existing) throw new SessionStoreError('schema_not_found', `schema not found: ${id}`)
    if (existing.deprecatedAt !== null) {
      const revision = await dynamoGetSchemaRegistryRevision(doc, tableName)
      return { revision, summary: existing, alreadyDeprecated: true }
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
                UpdateExpression:
                  'SET deprecatedAt = :now, deprecatedBy = :actor, updatedAt = :now, updatedBy = :actor',
                ConditionExpression:
                  'attribute_exists(PK) AND deprecatedAt = :null AND latestVersion = :expectedVersion',
                ExpressionAttributeValues: {
                  ':now': timestamp,
                  ':actor': actor,
                  ':null': null,
                  ':expectedVersion': existing.latestVersion,
                },
              },
            },
          ],
        }),
      )
      return {
        revision: nextRevision,
        summary: {
          ...existing,
          deprecatedAt: timestamp,
          deprecatedBy: actor,
          updatedAt: timestamp,
          updatedBy: actor,
        },
        alreadyDeprecated: false,
      }
    } catch (error) {
      if (!isRetryableTransactionCanceled(error)) throw error
    }
  }
  throw new SessionStoreError(
    'schema_conflict',
    `could not deprecate schema ${id} due to contention`,
  )
}
