import { describe, expect, it } from 'vitest'
import { AgentBlackboardError } from './client/errors.mjs'
import { formatError } from './format-error.mjs'

describe('formatError', () => {
  it('includes the parsed body for AgentBlackboardError', () => {
    expect(
      formatError(new AgentBlackboardError('request failed', 401, { message: 'bad token' })),
    ).toBe('request failed {"message":"bad token"}')
  })

  it('omits the body suffix when AgentBlackboardError has no body', () => {
    expect(formatError(new AgentBlackboardError('request failed', 404, undefined))).toBe(
      'request failed',
    )
  })

  it('uses the message for a plain Error', () => {
    expect(formatError(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(formatError('boom')).toBe('boom')
    expect(formatError(42)).toBe('42')
  })
})
