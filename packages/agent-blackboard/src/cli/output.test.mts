import { describe, expect, it, vi } from 'vitest'
import { writeLine } from './output.mjs'

describe('writeLine', () => {
  it('writes the text with a trailing newline', () => {
    const write = vi.fn()
    writeLine({ write }, 'hello')
    expect(write).toHaveBeenCalledWith('hello\n')
  })
})
