import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { SchemaBundle, SchemaRecord, SchemaVersionRecord } from '../core/types.mjs'
import { formatSchemaRef } from '../schemas/id.mjs'
import {
  SCHEMA_REGISTRY_PK,
  SCHEMA_REGISTRY_SK,
  SCHEMAS_PK,
  SCHEMA_VERSIONS_PK,
  schemaSk,
  schemaVersionPrefix,
  schemaVersionSk,
} from './dynamo-keys.mjs'
import { SessionStoreError } from './errors.mjs'
import type { GetSchemaResult, ListSchemaVersionsResult, ListSchemasResult } from './store.mjs'

const SNAPSHOT_RETRIES = 10

function itemToSchemaRecord(item: Record<string, unknown>): SchemaRecord {
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

function itemToSchemaVersion(item: Record<string, unknown>): SchemaVersionRecord {
  const id = item.id as string
  const version = item.version as number
  return {
    id,
    version,
    ref: formatSchemaRef(id, version),
    schema: item.schema as Record<string, unknown>,
    createdAt: item.createdAt as string,
    createdBy: item.createdBy as string,
  }
}

export async function dynamoGetSchemaRegistryRevision(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<number> {
  const result = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: SCHEMA_REGISTRY_PK, SK: SCHEMA_REGISTRY_SK },
      ConsistentRead: true,
    }),
  )
  return typeof result.Item?.revision === 'number' ? result.Item.revision : 0
}

export async function dynamoGetSchemaHead(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
): Promise<SchemaRecord | undefined> {
  const result = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: SCHEMAS_PK, SK: schemaSk(id) },
      ConsistentRead: true,
    }),
  )
  return result.Item ? itemToSchemaRecord(result.Item) : undefined
}

async function queryAllPartition(
  doc: DynamoDBDocumentClient,
  tableName: string,
  pk: string,
  skPrefix?: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: skPrefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
        ExpressionAttributeValues: skPrefix ? { ':pk': pk, ':sk': skPrefix } : { ':pk': pk },
        ExclusiveStartKey: exclusiveStartKey,
        ConsistentRead: true,
      }),
    )
    for (const item of page.Items ?? []) items.push(item)
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)
  return items
}

/**
 * Brackets a strongly consistent base-table read with revision reads before and
 * after, retrying if a registry mutation committed mid-read so the returned data
 * and revision (ETag) always describe one consistent snapshot.
 */
async function readConsistentSnapshot<T>(
  doc: DynamoDBDocumentClient,
  tableName: string,
  readData: () => Promise<T>,
): Promise<{ revision: number; data: T }> {
  for (let attempt = 0; attempt < SNAPSHOT_RETRIES; attempt++) {
    const revBefore = await dynamoGetSchemaRegistryRevision(doc, tableName)
    const data = await readData()
    const revAfter = await dynamoGetSchemaRegistryRevision(doc, tableName)
    if (revBefore === revAfter) return { revision: revAfter, data }
  }
  throw new SessionStoreError(
    'schema_conflict',
    'schema registry changed concurrently while reading a consistent snapshot',
  )
}

export async function dynamoListSchemas(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<ListSchemasResult> {
  const { revision, data } = await readConsistentSnapshot(doc, tableName, () =>
    queryAllPartition(doc, tableName, SCHEMAS_PK),
  )
  const schemas = data.map(itemToSchemaRecord).sort((a, b) => a.id.localeCompare(b.id))
  return { revision, schemas }
}

export async function dynamoGetSchema(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
  version?: number,
): Promise<GetSchemaResult | undefined> {
  const { revision, data } = await readConsistentSnapshot(doc, tableName, async () => {
    const summary = await dynamoGetSchemaHead(doc, tableName, id)
    if (!summary) return undefined
    const targetVersion = version ?? summary.latestVersion
    const versionResult = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: SCHEMA_VERSIONS_PK, SK: schemaVersionSk(id, targetVersion) },
        ConsistentRead: true,
      }),
    )
    if (!versionResult.Item) return undefined
    return { summary, versionRecord: itemToSchemaVersion(versionResult.Item) }
  })
  return data ? { revision, ...data } : undefined
}

export async function dynamoListSchemaVersions(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
): Promise<ListSchemaVersionsResult | undefined> {
  const { revision, data } = await readConsistentSnapshot(doc, tableName, async () => {
    const summary = await dynamoGetSchemaHead(doc, tableName, id)
    if (!summary) return undefined
    const rawVersions = await queryAllPartition(
      doc,
      tableName,
      SCHEMA_VERSIONS_PK,
      schemaVersionPrefix(id),
    )
    const versions = rawVersions.map(itemToSchemaVersion).sort((a, b) => a.version - b.version)
    return { summary, versions }
  })
  return data ? { revision, ...data } : undefined
}

export async function dynamoGetSchemaBundle(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<SchemaBundle> {
  const { revision, data } = await readConsistentSnapshot(doc, tableName, async () => {
    const [rawHeads, rawVersions] = await Promise.all([
      queryAllPartition(doc, tableName, SCHEMAS_PK),
      queryAllPartition(doc, tableName, SCHEMA_VERSIONS_PK),
    ])
    return { rawHeads, rawVersions }
  })
  const versionsById = new Map<string, SchemaVersionRecord[]>()
  for (const raw of data.rawVersions) {
    const version = itemToSchemaVersion(raw)
    const list = versionsById.get(version.id) ?? []
    list.push(version)
    versionsById.set(version.id, list)
  }
  const schemas = data.rawHeads
    .map(itemToSchemaRecord)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((summary) => ({
      ...summary,
      versions: (versionsById.get(summary.id) ?? []).sort((a, b) => a.version - b.version),
    }))
  return { revision, schemas }
}
