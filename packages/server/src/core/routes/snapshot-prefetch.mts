import type { Session, SessionEntry } from '../types.mjs'
import type { BlackboardStore } from '../../store/store.mjs'

export interface PrefetchedSession {
  session: Session
  entries: AsyncIterator<SessionEntry>
  first: IteratorResult<SessionEntry>
}

async function prefetchSession(
  store: BlackboardStore,
  credId: string,
  listed: Session,
): Promise<PrefetchedSession | undefined> {
  const session = await store.getSession(credId, listed.id)
  if (!session || session.archivedAt !== null) return undefined
  const entries = store
    .getEntries(credId, session.id, { sessionVerified: true })
    [Symbol.asyncIterator]()
  return { session, entries, first: await entries.next() }
}

/** Starts one entry read per session concurrently; callers emit the results in input order. */
export async function prefetchSessions(
  store: BlackboardStore,
  credId: string,
  sessions: Session[],
): Promise<PrefetchedSession[]> {
  const prefetched = await Promise.all(
    sessions.map((session) => prefetchSession(store, credId, session)),
  )
  return prefetched.filter((session): session is PrefetchedSession => session !== undefined)
}

async function closeEntries(entries: AsyncIterator<SessionEntry>): Promise<void> {
  if (entries.return) await entries.return()
}

/** Ends started iterators when the enclosing snapshot cannot emit their session blocks. */
export async function closePrefetched(sessions: PrefetchedSession[]): Promise<void> {
  await Promise.all(sessions.map(({ entries }) => closeEntries(entries)))
}
