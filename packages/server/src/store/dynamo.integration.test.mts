import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { beforeAll, describe } from 'vitest'
import { runStoreConformance } from './conformance/index.mjs'
import { createDynamoStore } from './dynamo.mjs'

const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const TABLE_NAME = 'AgentBlackboardIntegrationTest'
const GSI_NAME = 'SessionsByCreatedAt'

async function createTable(client: DynamoDBClient): Promise<void> {
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
          IndexName: GSI_NAME,
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
}

/**
 * A table left over from a run of this suite before the `SessionsByCreatedAt` GSI existed
 * lacks it; recreating on top (`ResourceInUseException`) would leave GSI-dependent
 * conformance cases failing in a way that looks like a product bug. Detect the schema drift
 * and replace the table instead of reusing it as-is.
 */
async function ensureTable(client: DynamoDBClient): Promise<void> {
  try {
    await createTable(client)
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) throw error
    const description = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }))
    const hasGsi = description.Table?.GlobalSecondaryIndexes?.some(
      (index) => index.IndexName === GSI_NAME,
    )
    if (hasGsi) return
    await client.send(new DeleteTableCommand({ TableName: TABLE_NAME }))
    await waitUntilTableNotExists({ client, maxWaitTime: 30 }, { TableName: TABLE_NAME })
    await createTable(client)
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
