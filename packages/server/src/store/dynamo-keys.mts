export function sessionsPk(credId: string): string {
  return `SESSIONS#${credId}`
}

const SESSION_SK_PREFIX = 'SESSION#'

export function sessionSk(sessionId: string): string {
  return `${SESSION_SK_PREFIX}${sessionId}`
}

export function sessionIdFromSk(sk: string): string {
  return sk.slice(SESSION_SK_PREFIX.length)
}

export function entriesPk(credId: string, sessionId: string): string {
  return `ENTRIES#${credId}#${sessionId}`
}

export function entrySk(createdAt: string): string {
  return `ENTRY#${createdAt}`
}
