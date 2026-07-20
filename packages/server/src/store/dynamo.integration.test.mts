import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { beforeAll, describe } from 'vitest'
import { runStoreConformance } from './conformance/index.mjs'
import { createDynamoStore } from './dynamo.mjs'

const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const TABLE_NAME = 'AgentBlackboardIntegrationTest'

async function ensureTable(client: DynamoDBClient): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'sessionCreatedAt', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'SessionsByCreatedAt',
            KeySchema: [
              { AttributeName: 'PK', KeyType: 'HASH' },
              { AttributeName: 'sessionCreatedAt', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    )
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) throw error
  }
}

describe.skipIf(!ENDPOINT)('DynamoDB Local session/entry integration', () => {
  let doc: DynamoDBDocumentClient

  beforeAll(async () => {
    if (!ENDPOINT) throw new Error('DYNAMODB_ENDPOINT must be set')
    const client = new DynamoDBClient({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    })
    await ensureTable(client)
    doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    })
  })

  runStoreConformance(() => createDynamoStore({ client: doc, tableName: TABLE_NAME }))
})
