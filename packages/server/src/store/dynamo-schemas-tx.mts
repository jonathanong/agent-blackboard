import type { SchemaRecord, SchemaVersionRecord } from '../core/types.mjs'
import { formatSchemaRef } from '../schemas/id.mjs'
import {
  SCHEMA_REGISTRY_PK,
  SCHEMA_REGISTRY_SK,
  SCHEMAS_PK,
  SCHEMA_VERSIONS_PK,
  schemaSk,
  schemaVersionSk,
} from './dynamo-keys.mjs'

export function itemToSchemaRecord(item: Record<string, unknown>): SchemaRecord {
  return {
    id: item.id as string,
    latestVersion: item.latestVersion as number,
    deprecatedAt: (item.deprecatedAt as string | null) ?? null,
    deprecatedBy: (item.deprecatedBy as string | null) ?? null,
    createdAt: item.createdAt as string,
    createdBy: item.createdBy as string,
    updatedAt: item.updatedAt as string,
    updatedBy: item.updatedBy as string,
  }
}

export function itemToSchemaVersion(item: Record<string, unknown>): SchemaVersionRecord {
  const id = item.id as string
  const version = item.version as number
  return {
    id,
    version,
    ref: formatSchemaRef(id, version),
    schema: item.schema as Record<string, unknown>,
    mode: item.mode === 'shadow' ? 'shadow' : 'enforced',
    createdAt: item.createdAt as string,
    createdBy: item.createdBy as string,
    promotedAt: (item.promotedAt as string | null) ?? null,
    promotedBy: (item.promotedBy as string | null) ?? null,
  }
}

export function isRetryableTransactionCanceled(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return false
  const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons
  if (!reasons || reasons.length === 0) return true
  const codes = reasons.map((r) => r.Code).filter((c) => c !== undefined && c !== 'None')
  return (
    codes.length > 0 &&
    codes.every((c) => c === 'ConditionalCheckFailed' || c === 'TransactionConflict')
  )
}

export function registryMetaTxItem(
  tableName: string,
  currentRevision: number,
  nextRevision: number,
  timestamp: string,
) {
  if (currentRevision === 0) {
    return {
      Put: {
        TableName: tableName,
        Item: {
          PK: SCHEMA_REGISTRY_PK,
          SK: SCHEMA_REGISTRY_SK,
          entityType: 'schema_registry',
          revision: nextRevision,
          updatedAt: timestamp,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    }
  }
  return {
    Update: {
      TableName: tableName,
      Key: { PK: SCHEMA_REGISTRY_PK, SK: SCHEMA_REGISTRY_SK },
      UpdateExpression: 'SET revision = :nextRev, updatedAt = :updatedAt',
      ConditionExpression: 'revision = :expectedRev',
      ExpressionAttributeValues: {
        ':nextRev': nextRevision,
        ':expectedRev': currentRevision,
        ':updatedAt': timestamp,
      },
    },
  }
}

export function schemaHeadTxItem(
  tableName: string,
  expectedVersion: number,
  summary: SchemaRecord,
  timestamp: string,
  actor: string,
) {
  if (expectedVersion === 0) {
    return {
      Put: {
        TableName: tableName,
        Item: { PK: SCHEMAS_PK, SK: schemaSk(summary.id), entityType: 'schema', ...summary },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    }
  }
  return {
    Update: {
      TableName: tableName,
      Key: { PK: SCHEMAS_PK, SK: schemaSk(summary.id) },
      UpdateExpression:
        'SET latestVersion = :nextVersion, updatedAt = :updatedAt, updatedBy = :actor',
      ConditionExpression: 'latestVersion = :expectedVersion AND deprecatedAt = :null',
      ExpressionAttributeValues: {
        ':nextVersion': summary.latestVersion,
        ':expectedVersion': expectedVersion,
        ':updatedAt': timestamp,
        ':actor': actor,
        ':null': null,
      },
    },
  }
}

export function schemaVersionTxItem(tableName: string, versionRecord: SchemaVersionRecord) {
  return {
    Put: {
      TableName: tableName,
      Item: {
        PK: SCHEMA_VERSIONS_PK,
        SK: schemaVersionSk(versionRecord.id, versionRecord.version),
        entityType: 'schema_version',
        ...versionRecord,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  }
}
