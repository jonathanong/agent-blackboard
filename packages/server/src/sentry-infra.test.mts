import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../opentofu/sentry/', import.meta.url)

async function read(name: string): Promise<string> {
  return readFile(new URL(name, root), 'utf8')
}

describe('independent Sentry OpenTofu stack', () => {
  it('owns only the Agent Blackboard Lambda project and two environment keys', async () => {
    const main = await read('main.tf')
    expect(main).toMatch(/slug\s+= "agent-blackboard-lambda"/)
    expect(main).toMatch(/platform\s+= "node-awslambda"/)
    expect(main).toContain('default_key   = false')
    expect(main).toContain('default_rules = false')
    expect(main).toContain('toset(["staging", "production"])')
    expect(main).not.toContain('vouchington-')
    expect(main).not.toContain('auto-harness-')
  })

  it('pins the sponsored provider and exposes public DSNs only', async () => {
    const versions = await read('versions.tf')
    const outputs = await read('outputs.tf')
    expect(versions).toContain('source  = "jianyuan/sentry"')
    expect(versions).toContain('version = "= 0.15.7"')
    expect(outputs).toContain('dsn["public"]')
    expect(outputs).not.toMatch(/dsn\["secret"\]|dsn_secret|\.secret/)
  })

  it('references the existing organization, platform team, and GitHub integration', async () => {
    const main = await read('main.tf')
    expect(main).toContain('data "sentry_organization" "current"')
    expect(main).toContain('data "sentry_team" "platform"')
    expect(main).toContain('data "sentry_organization_integration" "github"')
    expect(main).not.toContain('resource "sentry_organization_repository"')
  })
})
