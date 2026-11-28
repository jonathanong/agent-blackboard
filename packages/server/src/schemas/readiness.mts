import type { SchemaBundle } from '../core/types.mjs'
import type { BlackboardStore } from '../store/store.mjs'
import { getSnapshotCache } from './enforce-cache.mjs'
import {
  resolveEnforcementMode,
  type SchemaEnforcementEnv,
  type SchemaEnforcementMode,
} from './enforce.mjs'

export interface SchemaEnforcementReadiness {
  ok: boolean
  mode: SchemaEnforcementMode
  error?: string
}

const EMPTY_REQUIRED_REGISTRY_ERROR =
  'AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT=required requires at least one active enforced schema in the registry; register and promote a schema, or set AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT=shadow.'

function hasActiveEnforcedSchema(bundle: SchemaBundle): boolean {
  return bundle.schemas.some(
    (schema) =>
      schema.deprecatedAt === null &&
      schema.versions.some((version) => version.mode === 'enforced'),
  )
}

/** Checks whether the server's configured schema enforcement policy can accept writes. */
export async function checkSchemaEnforcementReadiness(
  store: BlackboardStore,
  env: SchemaEnforcementEnv,
): Promise<SchemaEnforcementReadiness> {
  const mode = resolveEnforcementMode(env)
  if (mode !== 'required') return { ok: true, mode }
  const revision = await store.getSchemaRegistryRevision()
  const cache = await getSnapshotCache(store, revision)
  if (!hasActiveEnforcedSchema(cache.bundle)) {
    return { ok: false, mode, error: EMPTY_REQUIRED_REGISTRY_ERROR }
  }
  return { ok: true, mode }
}

/** Throws if `AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT=required` has no active enforced schema. */
export async function assertSchemaEnforcementReady(
  store: BlackboardStore,
  env: SchemaEnforcementEnv,
): Promise<void> {
  const readiness = await checkSchemaEnforcementReadiness(store, env)
  if (!readiness.ok) throw new Error(readiness.error)
}
