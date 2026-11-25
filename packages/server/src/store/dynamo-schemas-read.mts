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
import type { GetSchemaResult, ListSchemaVersionsResult, ListSchemasResult } from './store.mjs'

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
    new GetCommand({ TableName: tableName, Key: { PK: SCHEMAS_PK, SK: schemaSk(id) } }),
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
      }),
    )
    for (const item of page.Items ?? []) items.push(item)
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)
  return items
}

export async function dynamoListSchemas(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<ListSchemasResult> {
  const [revision, rawItems] = await Promise.all([
    dynamoGetSchemaRegistryRevision(doc, tableName),
    queryAllPartition(doc, tableName, SCHEMAS_PK),
  ])
  const schemas = rawItems.map(itemToSchemaRecord).sort((a, b) => a.id.localeCompare(b.id))
  return { revision, schemas }
}

export async function dynamoGetSchema(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
  version?: number,
): Promise<GetSchemaResult | undefined> {
  const [revision, summary] = await Promise.all([
    dynamoGetSchemaRegistryRevision(doc, tableName),
    dynamoGetSchemaHead(doc, tableName, id),
  ])
  if (!summary) return undefined
  const targetVersion = version ?? summary.latestVersion
  const versionResult = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: SCHEMA_VERSIONS_PK, SK: schemaVersionSk(id, targetVersion) },
    }),
  )
  if (!versionResult.Item) return undefined
  return { revision, summary, versionRecord: itemToSchemaVersion(versionResult.Item) }
}

export async function dynamoListSchemaVersions(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
): Promise<ListSchemaVersionsResult | undefined> {
  const [revision, summary] = await Promise.all([
    dynamoGetSchemaRegistryRevision(doc, tableName),
    dynamoGetSchemaHead(doc, tableName, id),
  ])
  if (!summary) return undefined
  const rawVersions = await queryAllPartition(
    doc,
    tableName,
    SCHEMA_VERSIONS_PK,
    schemaVersionPrefix(id),
  )
  const versions = rawVersions.map(itemToSchemaVersion).sort((a, b) => a.version - b.version)
  return { revision, summary, versions }
}

export async function dynamoGetSchemaBundle(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<SchemaBundle> {
  const [revision, rawHeads, rawVersions] = await Promise.all([
    dynamoGetSchemaRegistryRevision(doc, tableName),
    queryAllPartition(doc, tableName, SCHEMAS_PK),
    queryAllPartition(doc, tableName, SCHEMA_VERSIONS_PK),
  ])
  const versionsById = new Map<string, SchemaVersionRecord[]>()
  for (const raw of rawVersions) {
    const version = itemToSchemaVersion(raw)
    const list = versionsById.get(version.id) ?? []
    list.push(version)
    versionsById.set(version.id, list)
  }
  const schemas = rawHeads
    .map(itemToSchemaRecord)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((summary) => ({
      ...summary,
      versions: (versionsById.get(summary.id) ?? []).sort((a, b) => a.version - b.version),
    }))
  return { revision, schemas }
}
