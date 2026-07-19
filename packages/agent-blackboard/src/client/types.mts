export interface ClientConfig {
  baseUrl: string
  token: string
}

export interface Session {
  id: string
  parentSessionId: string | null
  createdAt: string
  archivedAt: string | null
}

export interface SessionEntry {
  sessionId: string
  createdAt: string
  data: Record<string, unknown>
}

export interface CreateSessionInput {
  id: string
  parentSessionId: string | null
}

export interface AppendEntryInput {
  sessionId: string
  data: Record<string, unknown>
}

export interface PatchEntryInput {
  sessionId: string
  createdAt: string
  data: Record<string, unknown>
}

export type EntryWireFormat = 'json' | 'jsonl' | 'markdown'
export type StructuredEntryFormat = Extract<EntryWireFormat, 'json' | 'jsonl'>

export interface GetEntriesQuery {
  sessionId: string
  format?: StructuredEntryFormat
}

export interface GetRawEntriesQuery {
  sessionId: string
  format?: EntryWireFormat
}

export interface CredentialSummary {
  id: string
  name: string
  createdAt: string
}

export interface CredentialCreated extends CredentialSummary {
  token: string
}
