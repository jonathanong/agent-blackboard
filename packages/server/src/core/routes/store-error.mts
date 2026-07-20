import { SessionStoreError } from '../../store/errors.mjs'
import { errorResponse } from '../response.mjs'
import type { HandlerResponse } from '../types.mjs'

export function storeErrorResponse(error: unknown): HandlerResponse | undefined {
  if (!(error instanceof SessionStoreError)) return undefined
  if (error.code === 'timestamp_exhausted') return errorResponse(503, error.message)
  if (error.code === 'invalid_cursor') return errorResponse(400, error.message)
  const status = ['session_not_found', 'parent_not_found'].includes(error.code) ? 404 : 409
  return errorResponse(status, error.message)
}
