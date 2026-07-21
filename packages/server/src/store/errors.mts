export type SessionStoreErrorCode =
  | 'session_exists'
  | 'session_not_found'
  | 'parent_not_found'
  | 'parent_archived'
  | 'session_archived'
  | 'timestamp_exhausted'
  | 'invalid_cursor'

export class SessionStoreError extends Error {
  constructor(
    readonly code: SessionStoreErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SessionStoreError'
  }
}
