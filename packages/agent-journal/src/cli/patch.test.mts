import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { CliError } from './errors.mjs'
import { runPatch } from './patch.mjs'

const ENV = (baseUrl: string) => ({ AGENT_JOURNAL_URL: baseUrl, AGENT_JOURNAL_TOKEN: 't' })

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'agent-journal-patch-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('runPatch', () => {
  it('patches a single id with --archived and --data', async () => {
    const fixture = await startHttpFixture((_req, res) =>
      sendJson(res, 200, [{ id: 'a', archived: true }]),
    )
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runPatch(['a', '--archived', 'true', '--data', '{"pr":7777}'], ctx)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual([
        { id: 'a', archived: true, data: { pr: 7777 } },
      ])
      expect(ctx.stdoutLines).toEqual([`${JSON.stringify([{ id: 'a', archived: true }])}\n`])
    } finally {
      await fixture.close()
    }
  })

  it('patches a single id with only --archived (no --data)', async () => {
    const fixture = await startHttpFixture((_req, res) =>
      sendJson(res, 200, [{ id: 'a', archived: true }]),
    )
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runPatch(['a', '--archived', 'true'], ctx)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual([{ id: 'a', archived: true }])
    } finally {
      await fixture.close()
    }
  })

  it('patches a batch from a JSON array file via --file', async () => {
    const file = join(tmpRoot, 'patches.json')
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'a', archived: true },
        { id: 'b', data: { pr: 1 } },
      ]),
    )
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runPatch(['--file', file], ctx)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual([
        { id: 'a', archived: true },
        { id: 'b', data: { pr: 1 } },
      ])
    } finally {
      await fixture.close()
    }
  })

  it('throws CliError when neither an id nor --file is given', async () => {
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runPatch([], ctx)).rejects.toThrow(CliError)
  })

  it('throws CliError when --file points at a missing path', async () => {
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runPatch(['--file', join(tmpRoot, 'missing.json')], ctx)).rejects.toThrow(CliError)
  })

  it('throws CliError when the --file content is not a JSON array', async () => {
    const file = join(tmpRoot, 'not-array.json')
    writeFileSync(file, JSON.stringify({ id: 'a' }))
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runPatch(['--file', file], ctx)).rejects.toThrow(CliError)
  })

  it('throws CliError when --data is not valid JSON', async () => {
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runPatch(['a', '--data', 'not json'], ctx)).rejects.toThrow(CliError)
  })
})
