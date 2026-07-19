import { describe, expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runGet } from './get.mjs'

const ENV = (url: string) => ({ AGENT_BLACKBOARD_URL: url, AGENT_BLACKBOARD_TOKEN: 't' })

describe('runGet', () => {
  it('requires a session and streams every supported format', async () => {
    const fixture = await startHttpFixture((req, res) => {
      if (req.url.includes('jsonl')) return sendNdjson(res, [{ a: 1 }, { b: 2 }])
      if (req.url.includes('markdown')) {
        res.writeHead(200)
        res.end('# entry')
        return
      }
      sendJson(res, 200, [{ a: 1 }])
    })
    try {
      for (const format of ['json', 'jsonl', 'markdown']) {
        const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
        await runGet(['--session-id', 's', '--format', format], ctx)
        expect(ctx.stdoutLines.join('')).not.toBe('')
      }
      expect(fixture.requests[0]!.url).toBe('/sessions/s/entries?format=json')
    } finally {
      await fixture.close()
    }
  })

  it('handles no response body and rejects missing sessions/formats', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(204)
      res.end()
    })
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runGet(['--session-id', 's'], ctx)
      expect(ctx.stdoutLines).toEqual([])
      await expect(runGet([], ctx)).rejects.toThrow('session-id')
      await expect(runGet(['--session-id', 's', '--format', 'yaml'], ctx)).rejects.toThrow()
    } finally {
      await fixture.close()
    }
  })
})
