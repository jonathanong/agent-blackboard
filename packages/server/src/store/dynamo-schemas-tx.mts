import type { SchemaRecord, SchemaVersionRecord } from '../core/types.mjs'
import {
  SCHEMA_REGISTRY_PK,
  SCHEMA_REGISTRY_SK,
  SCHEMAS_PK,
  SCHEMA_VERSIONS_PK,
  schemaSk,
  schemaVersionSk,
} from './dynamo-keys.mjs'

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
