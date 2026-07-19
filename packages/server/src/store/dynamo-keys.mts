export function sessionsPk(credId: string): string {
  return `SESSIONS#${credId}`
}

export function sessionSk(sessionId: string): string {
  return `SESSION#${sessionId}`
}

export function entriesPk(credId: string, sessionId: string): string {
  return `ENTRIES#${credId}#${sessionId}`
}

export function entrySk(createdAt: string): string {
  return `ENTRY#${createdAt}`
}
