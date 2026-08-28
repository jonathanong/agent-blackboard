import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { Snapshots } from './snapshots.mjs'

const session = {
  id: 'session-1',
  parentSessionId: null,
  agent: 'codex',
  version: '1',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastEntryAt: null,
  archivedAt: null,
  data: {},
}
const entry = {
  sessionId: 'session-1',
  createdAt: '2026-01-01T00:01:00.000Z',
  data: { type: 'retrospective' },
}

function records() {
  return [
    { type: 'session', session },
    { type: 'entry', entry },
    {
      type: 'manifest',
      manifest: {
        schemaVersion: 1,
        status: 'complete',
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
        selection: {
          archived: false,
          agent: 'codex',
          parentSessionId: null,
          data: { branch: 'main' },
          inactiveForHours: 8,
        },
        counts: { sessions: 1, entries: 1, records: 3 },
        ordering: {
          sessions: 'createdAt ascending',
          entries: 'createdAt ascending within session',
        },
        consistency: 'best-effort',
      },
    },
  ]
}

it('streams an authenticated snapshot into a read-only JSONL file and verifies its manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'export.jsonl')
  const fixture = await startHttpFixture((_req, response) => sendNdjson(response, records()))
  try {
    const result = await new Snapshots({ baseUrl: fixture.baseUrl, token: 'secret' }).export({
      path: destination,
      selection: {
        agent: 'codex',
        parentSessionId: null,
        data: { branch: 'main' },
        inactiveForHours: 8,
      },
    })
    const contents = await readFile(destination)
    expect(result).toMatchObject({
      path: destination,
      counts: { sessions: 1, entries: 1, records: 3 },
    })
    expect(result.checksum).toEqual({
      algorithm: 'sha256',
      value: createHash('sha256').update(contents).digest('hex'),
    })
    expect(result.manifest.status).toBe('complete')
    expect((await stat(destination)).mode & 0o777).toBe(0o400)
    expect(fixture.requests[0]!.headers.authorization).toBe('Bearer secret')
    const request = new URL(fixture.requests[0]!.url, fixture.baseUrl)
    expect(request.pathname).toBe('/snapshot')
    expect(request.searchParams.get('parentSessionId')).toBe('')
    expect(request.searchParams.get('data')).toBe('{"branch":"main"}')
  } finally {
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('removes incomplete files when records or manifest counts are invalid', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'invalid.jsonl')
  const fixture = await startHttpFixture((_req, response) =>
    sendNdjson(response, [
      { type: 'session', session },
      {
        type: 'manifest',
        manifest: {
          schemaVersion: 1,
          status: 'complete',
          createdAt: 'now',
          completedAt: 'now',
          selection: { archived: false },
          counts: { sessions: 2, entries: 0, records: 2 },
          ordering: {},
          consistency: 'best-effort',
        },
      },
    ]),
  )
  try {
    await expect(
      new Snapshots({ baseUrl: fixture.baseUrl, token: 't' }).export({ path: destination }),
    ).rejects.toThrow('counts')
    expect(await readdir(directory)).toEqual([])
  } finally {
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects non-absolute or pre-existing destinations without touching them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'taken.jsonl')
  await writeFile(destination, 'keep')
  const snapshots = new Snapshots({ baseUrl: 'http://example.test', token: 't' })
  try {
    await expect(snapshots.export({ path: 'relative.jsonl' })).rejects.toThrow('absolute')
    await expect(snapshots.export({ path: destination })).rejects.toThrow('already exists')
    await expect(
      snapshots.export({ path: join(directory, 'missing', 'snapshot.jsonl') }),
    ).rejects.toThrow()
    expect(await readFile(destination, 'utf8')).toBe('keep')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('removes a generated destination when the server terminates with an error record', async () => {
  const fixture = await startHttpFixture((_req, response) =>
    sendNdjson(response, [
      { type: 'session', session },
      { type: 'error', error: { code: 'snapshot_too_large', limitBytes: 199229440 } },
    ]),
  )
  try {
    await expect(new Snapshots({ baseUrl: fixture.baseUrl, token: 't' }).export()).rejects.toThrow(
      'snapshot_too_large',
    )
  } finally {
    await fixture.close()
  }
})

it('removes malformed, incomplete, and semantically invalid snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const cases = [
    { records: '{bad\n', error: 'invalid JSONL' },
    { records: [{ nope: true }], error: 'invalid record' },
    { records: [{ type: 'session' }], error: 'unsupported record' },
    { records: [{ type: 'session', session }], error: 'missing a complete' },
    {
      records: [records()[2], records()[0]],
      error: 'records after its manifest',
    },
    {
      records: [
        { type: 'session', session },
        {
          type: 'manifest',
          manifest: {
            schemaVersion: 1,
            status: 'complete',
            createdAt: 'now',
            completedAt: 'now',
            selection: { archived: false },
            counts: { sessions: 1, entries: 0, records: 2 },
            ordering: {},
            consistency: 'best-effort',
          },
        },
      ],
      error: 'terminal manifest',
    },
    {
      records: [
        { type: 'session', session },
        {
          type: 'manifest',
          manifest: {
            ...records()[2]!.manifest,
            completedAt: null,
            selection: { archived: false },
            counts: { sessions: 1, entries: 0, records: 2 },
          },
        },
      ],
      error: 'terminal manifest',
    },
    {
      records: [
        { type: 'session', session },
        {
          type: 'manifest',
          manifest: {
            ...records()[2]!.manifest,
            createdAt: 1,
            selection: { archived: false },
            counts: { sessions: 1, entries: 0, records: 2 },
          },
        },
      ],
      error: 'terminal manifest',
    },
    {
      records: [
        { type: 'session', session },
        {
          type: 'manifest',
          manifest: {
            ...records()[2]!.manifest,
            selection: { archived: false, agent: 'other' },
            counts: { sessions: 1, entries: 0, records: 2 },
          },
        },
      ],
      error: 'terminal manifest',
    },
  ]
  try {
    for (const [index, current] of cases.entries()) {
      const destination = join(directory, `${index}.jsonl`)
      const fixture = await startHttpFixture((_req, response) => {
        if (typeof current.records === 'string') {
          response.writeHead(200, { 'content-type': 'application/x-ndjson' })
          response.end(current.records)
        } else sendNdjson(response, current.records)
      })
      try {
        await expect(
          new Snapshots({ baseUrl: fixture.baseUrl, token: 't' }).export({ path: destination }),
        ).rejects.toThrow(current.error)
        expect(await readdir(directory)).toEqual([])
      } finally {
        await fixture.close()
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('ignores blank JSONL records between valid records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'blank-line.jsonl')
  const fixture = await startHttpFixture((_req, response) => {
    const [first, second, third] = records().map((record) => JSON.stringify(record))
    response.writeHead(200, { 'content-type': 'application/x-ndjson' })
    response.end(`${first}\n\n${second}\n${third}\n`)
  })
  try {
    await expect(
      new Snapshots({ baseUrl: fixture.baseUrl, token: 't' }).export({
        path: destination,
        selection: {
          agent: 'codex',
          parentSessionId: null,
          data: { branch: 'main' },
          inactiveForHours: 8,
        },
      }),
    ).resolves.toMatchObject({ counts: { records: 3 } })
  } finally {
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('compares the manifest selection after JSON wire serialization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'wire-selection.jsonl')
  const since = new Date('2026-01-01T00:00:00.000Z')
  const base = records()
  const fixture = await startHttpFixture((_req, response) =>
    sendNdjson(response, [
      base[0],
      base[1],
      {
        ...base[2],
        manifest: {
          ...base[2]!.manifest,
          selection: { archived: false, data: { since: since.toJSON() } },
        },
      },
    ]),
  )
  try {
    await expect(
      new Snapshots({ baseUrl: fixture.baseUrl, token: 't' }).export({
        path: destination,
        selection: { data: { since } },
      }),
    ).resolves.toMatchObject({ path: destination })
  } finally {
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('accepts a terminal manifest without a trailing newline and rejects a bodyless response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'no-newline.jsonl')
  const fixture = await startHttpFixture((_req, response) => {
    response.writeHead(200, { 'content-type': 'application/x-ndjson' })
    response.end(
      records()
        .map((record) => JSON.stringify(record))
        .join('\n'),
    )
  })
  const bodyless = await startHttpFixture((_req, response) => {
    response.writeHead(204)
    response.end()
  })
  try {
    await expect(
      new Snapshots({ baseUrl: fixture.baseUrl, token: 't' }).export({
        path: destination,
        selection: {
          agent: 'codex',
          parentSessionId: null,
          data: { branch: 'main' },
          inactiveForHours: 8,
        },
      }),
    ).resolves.toMatchObject({ counts: { records: 3 } })
    await expect(
      new Snapshots({ baseUrl: bodyless.baseUrl, token: 't' }).export({
        path: join(directory, 'bodyless.jsonl'),
      }),
    ).rejects.toThrow('no body')
  } finally {
    await fixture.close()
    await bodyless.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects a final record validation failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'invalid.jsonl')
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{bad}'))
      controller.close()
    },
  })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))
  try {
    await expect(
      new Snapshots({ baseUrl: 'https://example.test', token: 't' }).export({ path: destination }),
    ).rejects.toThrow('invalid JSONL')
  } finally {
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  }
})

it('cancels the response stream when an incremental record validation fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'invalid-record.jsonl')
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{bad}\n'))
    },
    cancel,
  })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))
  try {
    await expect(
      new Snapshots({ baseUrl: 'https://example.test', token: 't' }).export({ path: destination }),
    ).rejects.toThrow('invalid JSONL')
    expect(cancel).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  }
})

it('cancels the response stream when writing the local file fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-snapshot-test-'))
  const destination = join(directory, 'write-error.jsonl')
  const probe = await open(join(directory, 'probe'), 'w')
  const write = vi
    .spyOn(Object.getPrototypeOf(probe), 'write')
    .mockRejectedValueOnce(new Error('disk full'))
  await probe.close()
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"session"}\n'))
    },
    cancel,
  })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))
  try {
    await expect(
      new Snapshots({ baseUrl: 'https://example.test', token: 't' }).export({ path: destination }),
    ).rejects.toThrow('disk full')
    expect(cancel).toHaveBeenCalledOnce()
  } finally {
    write.mockRestore()
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  }
})
