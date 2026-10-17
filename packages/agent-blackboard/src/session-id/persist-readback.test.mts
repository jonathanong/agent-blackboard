import { describe, expect, it, vi } from 'vitest'

// Simulates a concurrent writer replacing the file between the write and the read-back, which a
// real filesystem can't reproduce deterministically.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => 'someone-else\n'),
  }
})

const { resolveAndPersistRootCodexSessionId } = await import('./persist.mjs')

describe('root Codex read-back', () => {
  it('fails when the persisted id does not match the selected id', () => {
    let thrown: unknown
    try {
      resolveAndPersistRootCodexSessionId({ root: '/r', payloadId: 'mine', newSession: true })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('failed to persist root Codex session id')
    expect(((thrown as Error).cause as Error).message).toBe(
      'persisted session id did not match the selected id',
    )
  })
})
