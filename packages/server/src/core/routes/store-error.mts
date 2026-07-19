import { SessionStoreError } from '../../store/errors.mjs'
import { errorResponse } from '../response.mjs'
import type { HandlerResponse } from '../types.mjs'

export function storeErrorResponse(error: unknown): HandlerResponse | undefined {
  if (!(error instanceof SessionStoreError)) return undefined
  const status = ['session_not_found', 'parent_not_found', 'entry_not_found'].includes(error.code)
    ? 404
    : 409
  return errorResponse(status, error.message)
}
