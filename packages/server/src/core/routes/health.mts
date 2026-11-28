import { checkSchemaEnforcementReadiness } from '../../schemas/readiness.mjs'
import type { SchemaEnforcementEnv } from '../../schemas/enforce.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import { jsonResponse, notFoundResponse } from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'

/** Reports server readiness, failing 503 when required schema enforcement has no active enforced schema. */
export async function handleHealthRoute(
  request: HandlerRequest,
  store: BlackboardStore,
  env: SchemaEnforcementEnv = {},
): Promise<HandlerResponse> {
  if (request.method !== 'GET') return notFoundResponse()
  const readiness = await checkSchemaEnforcementReadiness(store, env)
  if (!readiness.ok) {
    return jsonResponse(503, {
      status: 'unhealthy',
      schemaEnforcement: { mode: readiness.mode, ready: false, error: readiness.error },
    })
  }
  return jsonResponse(200, {
    status: 'ok',
    schemaEnforcement: { mode: readiness.mode, ready: true },
  })
}
