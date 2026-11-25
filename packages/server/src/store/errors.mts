export type SessionStoreErrorCode =
  | 'session_exists'
  | 'session_not_found'
  | 'parent_not_found'
  | 'session_archived'
  | 'timestamp_exhausted'
  | 'invalid_cursor'
  | 'schema_not_found'
  | 'schema_deprecated'
  | 'schema_conflict'

export class SessionStoreError extends Error {
  constructor(
    readonly code: SessionStoreErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SessionStoreError'
  }
}
