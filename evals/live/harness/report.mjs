// Renders the eval blackboard's state as markdown for graders: one block per session, sorted by
// id, with every field and every entry. Graders read it with `source: file`.

async function allSessions(store, credId) {
  const sessions = []
  let cursor
  do {
    const page = await store.listSessions(credId, { limit: 100, ...(cursor ? { cursor } : {}) })
    sessions.push(...page.sessions)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return sessions.sort((a, b) => a.id.localeCompare(b.id))
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])]),
    )
  }
  return value
}

export async function renderReport(store, credId) {
  const sessions = await allSessions(store, credId)
  const lines = [`# Blackboard state`, '', `${sessions.length} sessions.`, '']
  for (const session of sessions) {
    lines.push(`## Session \`${session.id}\``, '')
    lines.push(`- parentSessionId: ${JSON.stringify(session.parentSessionId)}`)
    lines.push(
      `- agent: ${JSON.stringify(session.agent)}`,
      `- version: ${JSON.stringify(session.version)}`,
    )
    lines.push(`- archivedAt: ${JSON.stringify(session.archivedAt)}`)
    lines.push(`- data: \`${JSON.stringify(sorted(session.data))}\``)
    const entries = []
    for await (const entry of store.getEntries(credId, session.id)) entries.push(entry)
    lines.push(`- entries: ${entries.length}`, '')
    for (const entry of entries) {
      lines.push(`  - ${entry.createdAt}: \`${JSON.stringify(sorted(entry.data))}\``)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}
