import { resolveTelemetryCredential } from '../../auth/telemetry.mjs'
import type { TelemetryStore } from '../../store/store.mjs'
import { notFoundResponse, unauthorizedResponse } from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { getTelemetry } from './telemetry-get.mjs'
import { patchTelemetry } from './telemetry-patch.mjs'
import { postTelemetry } from './telemetry-post.mjs'

/**
 * `/telemetry*` — telemetry-credential auth ONLY. An admin token (or any
 * other non-`atl_sk_`-shaped token) is rejected before any store lookup —
 * see `resolveTelemetryCredential`. A method other than POST/GET/PATCH on
 * this path is treated the same as an unknown route (404), not 405 — kept
 * simple and consistent with the rest of this API.
 */
export async function handleTelemetryRoute(
  request: HandlerRequest,
  store: TelemetryStore,
): Promise<HandlerResponse> {
  const cred = await resolveTelemetryCredential(request.headers.authorization, store)
  if (!cred) return unauthorizedResponse()
  switch (request.method) {
    case 'POST':
      return postTelemetry(request, store, cred)
    case 'GET':
      return getTelemetry(request, store, cred)
    case 'PATCH':
      return patchTelemetry(request, store, cred)
    default:
      return notFoundResponse()
  }
}
