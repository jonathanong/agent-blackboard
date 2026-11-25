import { randomUUID } from 'node:crypto'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type {
  SchemaShadowFailureRecord,
  SchemaShadowReport,
  SchemaShadowVersionCount,
  SchemaValidationIssue,
} from '../core/types.mjs'
import {
  schemaShadowCountSk,
  schemaShadowCountsPk,
  schemaShadowFailureSk,
  schemaShadowFailuresPk,
} from './dynamo-keys.mjs'
import {
  dynamoGetSchema,
  dynamoListSchemaVersions,
  queryAllPartition,
} from './dynamo-schemas-read.mjs'
import {
  DEFAULT_SHADOW_REPORT_LIMIT,
  type GetSchemaShadowReportOptions,
  type RecordSchemaShadowFailureInput,
} from './store.mjs'

const SECONDS_PER_DAY = 86_400

function itemToShadowFailure(item: Record<string, unknown>): SchemaShadowFailureRecord {
  return {
    schemaId: item.schemaId as string,
    schemaVersion: item.schemaVersion as number,
    sessionId: item.sessionId as string,
    occurredAt: item.occurredAt as string,
    code: item.code as string,
    message: item.message as string,
    details: (item.details as SchemaValidationIssue[]) ?? [],
  }
}

async function queryRecentFailures(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
  version: number,
  limit: number,
): Promise<SchemaShadowFailureRecord[]> {
  const result = await doc.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': schemaShadowFailuresPk(id, version) },
      ScanIndexForward: false,
      Limit: limit,
      ConsistentRead: true,
    }),
  )
  return (result.Items ?? []).map(itemToShadowFailure)
}

export async function dynamoRecordSchemaShadowFailure(
  doc: DynamoDBDocumentClient,
  tableName: string,
  ttlDays: number,
  now: () => Date,
  input: RecordSchemaShadowFailureInput,
): Promise<void> {
  const nowDate = now()
  const occurredAt = nowDate.toISOString()
  const ttl = Math.floor(nowDate.getTime() / 1000) + ttlDays * SECONDS_PER_DAY
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName,
            Key: {
              PK: schemaShadowCountsPk(input.schemaId),
              SK: schemaShadowCountSk(input.schemaVersion),
            },
            UpdateExpression:
              'ADD failureCount :one SET entityType = :type, schemaId = :id, schemaVersion = :version, lastFailureAt = :now',
            ExpressionAttributeValues: {
              ':one': 1,
              ':type': 'schema_shadow_count',
              ':id': input.schemaId,
              ':version': input.schemaVersion,
              ':now': occurredAt,
            },
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              PK: schemaShadowFailuresPk(input.schemaId, input.schemaVersion),
              SK: schemaShadowFailureSk(occurredAt, randomUUID()),
              entityType: 'schema_shadow_failure',
              schemaId: input.schemaId,
              schemaVersion: input.schemaVersion,
              sessionId: input.sessionId,
              occurredAt,
              code: input.code,
              message: input.message,
              details: structuredClone(input.details),
              ttl,
            },
          },
        },
      ],
    }),
  )
}

export async function dynamoGetSchemaShadowReport(
  doc: DynamoDBDocumentClient,
  tableName: string,
  id: string,
  options: GetSchemaShadowReportOptions = {},
): Promise<SchemaShadowReport | undefined> {
  const limit = options.limit ?? DEFAULT_SHADOW_REPORT_LIMIT
  if (options.version !== undefined) {
    const found = await dynamoGetSchema(doc, tableName, id, options.version)
    if (!found) return undefined
    const [countRes, recentFailures] = await Promise.all([
      doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: schemaShadowCountsPk(id), SK: schemaShadowCountSk(options.version) },
          ConsistentRead: true,
        }),
      ),
      queryRecentFailures(doc, tableName, id, options.version, limit),
    ])
    const failureCount = (countRes.Item?.failureCount as number | undefined) ?? 0
    const lastFailureAt = (countRes.Item?.lastFailureAt as string | undefined) ?? null
    return {
      id,
      version: options.version,
      totalFailures: failureCount,
      versions: [
        {
          version: found.versionRecord.version,
          ref: found.versionRecord.ref,
          mode: found.versionRecord.mode,
          failureCount,
          lastFailureAt,
        },
      ],
      recentFailures,
      revision: found.revision,
    }
  }
  const found = await dynamoListSchemaVersions(doc, tableName, id)
  if (!found) return undefined
  const countItems = await queryAllPartition(doc, tableName, schemaShadowCountsPk(id))
  const countsByVersion = new Map<number, { failureCount: number; lastFailureAt: string | null }>()
  for (const item of countItems) {
    countsByVersion.set(item.schemaVersion as number, {
      failureCount: item.failureCount as number,
      lastFailureAt: item.lastFailureAt as string,
    })
  }
  let totalFailures = 0
  const versions: SchemaShadowVersionCount[] = found.versions.map((v) => {
    const entry = countsByVersion.get(v.version)
    const failureCount = entry?.failureCount ?? 0
    totalFailures += failureCount
    return {
      version: v.version,
      ref: v.ref,
      mode: v.mode,
      failureCount,
      lastFailureAt: entry?.lastFailureAt ?? null,
    }
  })
  const failingVersions = versions.filter((v) => v.failureCount > 0)
  const lists = await Promise.all(
    failingVersions.map((v) => queryRecentFailures(doc, tableName, id, v.version, limit)),
  )
  const recentFailures = lists
    .flat()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.schemaVersion - a.schemaVersion)
    .slice(0, limit)
  return {
    id,
    version: null,
    totalFailures,
    versions,
    recentFailures,
    revision: found.revision,
  }
}
