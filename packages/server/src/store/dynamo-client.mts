import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { resolveRetentionPolicy, type RetentionPolicy, type TtlOverrides } from './retention.mjs'

const DEFAULT_TABLE_NAME = 'AgentBlackboard'

export interface DynamoStoreOptions {
  /** Inject a pre-built document client (tests use this with a hand-rolled `send()`). Defaults to a real client wrapping a default-configured `DynamoDBClient`. */
  client?: DynamoDBDocumentClient
  /** Defaults to `process.env.AGENT_BLACKBOARD_TABLE`, then `"AgentBlackboard"`. */
  tableName?: string
  /** Defaults to `process.env.AGENT_BLACKBOARD_TTL_DAYS`, then `90`. */
  ttlDays?: number
  /** Per-repository TTL overrides in days. Defaults to `process.env.AGENT_BLACKBOARD_TTL_OVERRIDES`. */
  ttlOverrides?: TtlOverrides
  now?: () => Date
}

export interface DynamoStoreConfig {
  doc: DynamoDBDocumentClient
  tableName: string
  retention: RetentionPolicy
  now: () => Date
}

export function resolveDynamoConfig(options: DynamoStoreOptions = {}): DynamoStoreConfig {
  const doc =
    options.client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    })
  const tableName = options.tableName ?? process.env.AGENT_BLACKBOARD_TABLE ?? DEFAULT_TABLE_NAME
  const retention = resolveRetentionPolicy({
    ttlDays: options.ttlDays,
    ttlOverrides: options.ttlOverrides,
    env: process.env,
  })
  const now = options.now ?? ((): Date => new Date())
  return { doc, tableName, retention, now }
}
