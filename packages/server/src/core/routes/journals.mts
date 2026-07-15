import { resolveJournalingCredential } from '../../auth/journaling.mjs'
import type { JournalStore } from '../../store/store.mjs'
import { notFoundResponse, unauthorizedResponse } from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { getJournals } from './journals-get.mjs'
import { patchJournals } from './journals-patch.mjs'
import { postJournals } from './journals-post.mjs'

/**
 * `/journals*` — journaling-credential auth ONLY. An admin token (or any
 * other non-`ag_sk_`-shaped token) is rejected before any store lookup —
 * see `resolveJournalingCredential`. A method other than POST/GET/PATCH on
 * this path is treated the same as an unknown route (404), not 405 — kept
 * simple and consistent with the rest of this API.
 */
export async function handleJournalsRoute(
  request: HandlerRequest,
  store: JournalStore,
): Promise<HandlerResponse> {
  const cred = await resolveJournalingCredential(request.headers.authorization, store)
  if (!cred) return unauthorizedResponse()
  switch (request.method) {
    case 'POST':
      return postJournals(request, store, cred)
    case 'GET':
      return getJournals(request, store, cred)
    case 'PATCH':
      return patchJournals(request, store, cred)
    default:
      return notFoundResponse()
  }
}
