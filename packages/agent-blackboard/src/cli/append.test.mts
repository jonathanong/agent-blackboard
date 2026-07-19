import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeContext, fakeStdin } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runAppend } from './append.mjs'
import { CliError } from './errors.mjs'

const ENV = (url: string) => ({ AGENT_BLACKBOARD_URL: url, AGENT_BLACKBOARD_TOKEN: 't' })

describe('runAppend', () => {
  it('requires an explicit session and accepts positional or stdin JSON', async () => {
    const entry = { sessionId: 's', createdAt: 'now', data: { a: 1 } }
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 201, entry))
    try {
      const first = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runAppend(['--session-id', 's', '{"a":1}'], first)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual({ data: { a: 1 } })
      expect(first.stdoutLines).toEqual([`${JSON.stringify(entry)}\n`])
      const second = createFakeContext({
        env: ENV(fixture.baseUrl),
        stdin: fakeStdin(['{"a":', Buffer.from('1'), '}']),
      })
      await runAppend(['--session-id', 's'], second)
    } finally {
      await fixture.close()
    }
  })

  it('reads JSON, Markdown, and text files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-'))
    const fixture = await startHttpFixture((_req, res) =>
      sendJson(res, 201, { sessionId: 's', createdAt: 'now', data: {} }),
    )
    try {
      const files = [
        ['entry.JSON', '{"a":1}', { a: 1 }],
        ['finding.md', '# Finding\n', { markdown: '# Finding\n' }],
        ['finding.markdown', 'details', { markdown: 'details' }],
        ['notes.txt', 'plain notes\n', { text: 'plain notes\n' }],
      ] as const
      for (const [name, contents, data] of files) {
        const path = join(directory, name)
        await writeFile(path, contents)
        await runAppend(
          ['--session-id', 's', '--file', path],
          createFakeContext({ env: ENV(fixture.baseUrl) }),
        )
        expect(JSON.parse(fixture.requests.at(-1)!.body)).toEqual({ data })
      }
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true })
    }
  })

  it('rejects missing sessions and invalid data', async () => {
    const ctx = createFakeContext({ env: ENV('http://h') })
    await expect(runAppend(['{}'], ctx)).rejects.toThrow('session-id')
    await expect(runAppend(['--session-id', 's', 'bad'], ctx)).rejects.toThrow(CliError)
    for (const value of ['[]', 'null', '1']) {
      await expect(runAppend(['--session-id', 's', value], ctx)).rejects.toThrow(CliError)
    }
    await expect(runAppend(['--session-id', 's', '--file'], ctx)).rejects.toThrow('path')
    await expect(runAppend(['--session-id', 's', '--file='], ctx)).rejects.toThrow('path')
    await expect(
      runAppend(['--session-id', 's', '--file', 'entry.json', '{}'], ctx),
    ).rejects.toThrow('not both')
    await expect(runAppend(['--session-id', 's', '--file', 'missing.json'], ctx)).rejects.toThrow(
      'could not read',
    )
    const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-'))
    try {
      const invalidJson = join(directory, 'invalid.json')
      const unsupported = join(directory, 'entry.yaml')
      await writeFile(invalidJson, 'bad')
      await writeFile(unsupported, 'data: value')
      await expect(runAppend(['--session-id', 's', '--file', invalidJson], ctx)).rejects.toThrow(
        'JSON object',
      )
      await expect(runAppend(['--session-id', 's', '--file', unsupported], ctx)).rejects.toThrow(
        'extension',
      )
    } finally {
      await rm(directory, { recursive: true })
    }
  })
})
