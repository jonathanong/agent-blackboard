import {
  checkBounds,
  checkTypeAndEnum,
  isPlainObject,
  joinPath,
  type BreakingChange,
} from './compatibility-checks.mjs'

export interface CompatibilityResult {
  compatible: boolean
  breakingChanges: BreakingChange[]
}

function compareNodes(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  path: string,
  changes: BreakingChange[],
): void {
  checkTypeAndEnum(prev, next, path, changes)
  checkBounds(prev, next, path, changes)

  const prevRequired = new Set(Array.isArray(prev.required) ? (prev.required as string[]) : [])
  const nextRequired = Array.isArray(next.required) ? (next.required as string[]) : []
  for (const field of nextRequired) {
    if (!prevRequired.has(field)) {
      changes.push({
        path: joinPath(path, 'required'),
        kind: 'added_required',
        message: `added required field "${field}"`,
      })
    }
  }

  const prevProps = isPlainObject(prev.properties) ? prev.properties : {}
  const nextProps = isPlainObject(next.properties) ? next.properties : {}
  for (const [name, prevProp] of Object.entries(prevProps)) {
    if (!(name in nextProps)) {
      changes.push({
        path: joinPath(joinPath(path, 'properties'), name),
        kind: 'removed_property',
        message: `removed property "${name}"`,
      })
      continue
    }
    const nextProp = nextProps[name]
    if (isPlainObject(prevProp) && isPlainObject(nextProp)) {
      compareNodes(prevProp, nextProp, joinPath(joinPath(path, 'properties'), name), changes)
    }
  }

  if (next.additionalProperties === false && prev.additionalProperties !== false) {
    changes.push({ path, kind: 'narrowed_constraint', message: 'disallowed additionalProperties' })
  } else if (isPlainObject(next.additionalProperties)) {
    if (!isPlainObject(prev.additionalProperties)) {
      changes.push({
        path,
        kind: 'narrowed_constraint',
        message: 'restricted additionalProperties',
      })
    } else {
      compareNodes(
        prev.additionalProperties,
        next.additionalProperties,
        joinPath(path, 'additionalProperties'),
        changes,
      )
    }
  }

  if (isPlainObject(next.items)) {
    if (!isPlainObject(prev.items)) {
      changes.push({ path, kind: 'narrowed_constraint', message: 'restricted items schema' })
    } else {
      compareNodes(prev.items, next.items, joinPath(path, 'items'), changes)
    }
  }
}

/**
 * Evaluates backward compatibility from `previous` to `next` JSON Schema 2020-12 documents:
 * existing valid entries must remain valid (no new required fields, no removed properties,
 * and no narrowed types or constraints).
 */
export function checkBackwardCompatibility(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): CompatibilityResult {
  const breakingChanges: BreakingChange[] = []
  compareNodes(previous, next, '/', breakingChanges)
  return { compatible: breakingChanges.length === 0, breakingChanges }
}
