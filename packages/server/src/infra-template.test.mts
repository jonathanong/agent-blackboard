import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('CloudFormation template', () => {
  it('grants the Lambda role query access to the session-list GSI', async () => {
    const template = await readFile(new URL('../infra/template.yaml', import.meta.url), 'utf8')

    expect(template).toContain(`              - Effect: Allow
                Action: dynamodb:Query
                Resource: !Sub '\${AgentBlackboardTable.Arn}/index/SessionsByCreatedAt'`)
  })
})
