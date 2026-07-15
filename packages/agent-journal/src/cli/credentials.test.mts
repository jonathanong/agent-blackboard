import { describe, expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runCredentials } from './credentials.mjs'
import { CliError } from './errors.mjs'

const ENV = (baseUrl: string) => ({
  AGENT_JOURNAL_URL: baseUrl,
  AGENT_JOURNAL_ADMIN_TOKEN: 'ag_admin_root_secret',
})

describe('runCredentials', () => {
  it('create posts --name and prints the created credential', async () => {
    const created = { id: 'c1', name: 'ci-bot', token: 'ag_sk_c1_secret', createdAt: 'now' }
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, created))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runCredentials(['create', '--name', 'ci-bot'], ctx)
      expect(ctx.stdoutLines).toEqual([`${JSON.stringify(created)}\n`])
    } finally {
      await fixture.close()
    }
  })

  it('create without --name throws CliError', async () => {
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runCredentials(['create'], ctx)).rejects.toThrow(CliError)
  })

  it('list prints the credential list', async () => {
    const list = [{ id: 'c1', name: 'ci-bot', createdAt: 'now' }]
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, list))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runCredentials(['list'], ctx)
      expect(ctx.stdoutLines).toEqual([`${JSON.stringify(list)}\n`])
    } finally {
      await fixture.close()
    }
  })

  it('delete --id deletes by id', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, {}))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runCredentials(['delete', '--id', 'c1'], ctx)
      expect(new URL(fixture.requests[0]!.url, fixture.baseUrl).searchParams.get('id')).toBe('c1')
      expect(ctx.stdoutLines).toEqual([`${JSON.stringify({ deleted: true })}\n`])
    } finally {
      await fixture.close()
    }
  })

  it('delete --name deletes by name', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, {}))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runCredentials(['delete', '--name', 'ci-bot'], ctx)
      expect(new URL(fixture.requests[0]!.url, fixture.baseUrl).searchParams.get('name')).toBe(
        'ci-bot',
      )
    } finally {
      await fixture.close()
    }
  })

  it('delete without --id or --name throws CliError', async () => {
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runCredentials(['delete'], ctx)).rejects.toThrow(CliError)
  })

  it('throws CliError for an unknown subcommand', async () => {
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runCredentials(['rename'], ctx)).rejects.toThrow(CliError)
  })

  it('throws CliError with no subcommand at all', async () => {
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runCredentials([], ctx)).rejects.toThrow(CliError)
  })
})
