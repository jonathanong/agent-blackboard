import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

const DEFAULT_TABLE_NAME = 'AgentBlackboard'
const DEFAULT_TTL_DAYS = 90

export interface DynamoStoreOptions {
  /** Inject a pre-built document client (tests use this with a hand-rolled `send()`). Defaults to a real client wrapping a default-configured `DynamoDBClient`. */
  client?: DynamoDBDocumentClient
  /** Defaults to `process.env.AGENT_BLACKBOARD_TABLE`, then `"AgentBlackboard"`. */
  tableName?: string
  /** Defaults to `process.env.AGENT_BLACKBOARD_TTL_DAYS`, then `90`. */
  ttlDays?: number
  now?: () => Date
}

export interface DynamoStoreConfig {
  doc: DynamoDBDocumentClient
  tableName: string
  ttlDays: number
  now: () => Date
}

export function resolveDynamoConfig(options: DynamoStoreOptions = {}): DynamoStoreConfig {
  const doc =
    options.client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    })
  const tableName = options.tableName ?? process.env.AGENT_BLACKBOARD_TABLE ?? DEFAULT_TABLE_NAME
  const ttlDaysEnv = process.env.AGENT_BLACKBOARD_TTL_DAYS
  const ttlDays = options.ttlDays ?? (ttlDaysEnv ? Number(ttlDaysEnv) : DEFAULT_TTL_DAYS)
  const now = options.now ?? ((): Date => new Date())
  return { doc, tableName, ttlDays, now }
}
