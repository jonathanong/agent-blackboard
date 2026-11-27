import {
  checkBounds,
  checkTypeAndEnum,
  COMPOSITION_KEYWORDS,
  isPlainObject,
  joinPath,
  jsonEqual,
  resolveLocalPointer,
  type BreakingChange,
} from './compatibility-checks.mjs'

export interface CompatibilityResult {
  compatible: boolean
  breakingChanges: BreakingChange[]
}

interface CompareContext {
  prevRoot: Record<string, unknown>
  nextRoot: Record<string, unknown>
  changes: BreakingChange[]
  visitedRefs: Set<string>
}

function compareSubschema(prev: unknown, next: unknown, path: string, ctx: CompareContext): void {
  if (prev === false) return
  if (next === false) {
    ctx.changes.push({ path, kind: 'narrowed_constraint', message: 'subschema changed to false' })
    return
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    compareNodes(prev, next, path, ctx)
    return
  }
  if (prev === true && isPlainObject(next) && Object.keys(next).length > 0) {
    compareNodes({}, next, path, ctx)
  }
}

function compareLocalRef(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  path: string,
  ctx: CompareContext,
): void {
  if (typeof prev.$ref !== 'string' || typeof next.$ref !== 'string') return
  if (prev.$ref !== next.$ref || !prev.$ref.startsWith('#')) return
  const visitKey = prev.$ref
  if (ctx.visitedRefs.has(visitKey)) return
  const prevTarget = resolveLocalPointer(ctx.prevRoot, prev.$ref)
  const nextTarget = resolveLocalPointer(ctx.nextRoot, next.$ref)
  if (prevTarget === undefined || nextTarget === undefined) return
  ctx.visitedRefs.add(visitKey)
  compareSubschema(prevTarget, nextTarget, path, ctx)
}

function compareProperties(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  path: string,
  ctx: CompareContext,
): void {
  const prevProps = isPlainObject(prev.properties) ? prev.properties : {}
  const nextProps = isPlainObject(next.properties) ? next.properties : {}
  const propsPath = joinPath(path, 'properties')

  for (const [name, prevProp] of Object.entries(prevProps)) {
    const propPath = joinPath(propsPath, name)
    if (!Object.hasOwn(nextProps, name)) {
      ctx.changes.push({
        path: propPath,
        kind: 'removed_property',
        message: `removed property "${name}"`,
      })
      continue
    }
    compareSubschema(prevProp, nextProps[name], propPath, ctx)
  }

  // Newly added properties must not narrow an existing additionalProperties or patternProperties schema.
  const prevPatterns = isPlainObject(prev.patternProperties)
    ? Object.entries(prev.patternProperties).map(([pat, schema]) => ({
        regex: new RegExp(pat),
        schema,
      }))
    : []
  for (const [name, nextProp] of Object.entries(nextProps)) {
    if (Object.hasOwn(prevProps, name)) continue
    const propPath = joinPath(propsPath, name)
    const matchedPatterns = prevPatterns.filter((entry) => entry.regex.test(name))
    if (matchedPatterns.length > 0) {
      for (const entry of matchedPatterns) compareSubschema(entry.schema, nextProp, propPath, ctx)
    } else if (isPlainObject(prev.additionalProperties)) {
      compareSubschema(prev.additionalProperties, nextProp, propPath, ctx)
    }
  }
}

function compareNodes(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  path: string,
  ctx: CompareContext,
): void {
  checkTypeAndEnum(prev, next, path, ctx.changes)
  checkBounds(prev, next, path, ctx.changes)
  compareLocalRef(prev, next, path, ctx)

  for (const keyword of COMPOSITION_KEYWORDS) {
    if (Object.hasOwn(next, keyword) && !jsonEqual(prev[keyword], next[keyword])) {
      ctx.changes.push({
        path: joinPath(path, keyword),
        kind: 'narrowed_constraint',
        message: `changed ${keyword} constraint`,
      })
    }
  }

  const prevRequired = new Set(Array.isArray(prev.required) ? (prev.required as string[]) : [])
  const nextRequired = Array.isArray(next.required) ? (next.required as string[]) : []
  for (const field of nextRequired) {
    if (!prevRequired.has(field)) {
      ctx.changes.push({
        path: joinPath(path, 'required'),
        kind: 'added_required',
        message: `added required field "${field}"`,
      })
    }
  }

  compareProperties(prev, next, path, ctx)

  if (Object.hasOwn(next, 'additionalProperties')) {
    const prevAdditional = Object.hasOwn(prev, 'additionalProperties')
      ? prev.additionalProperties
      : true
    compareSubschema(
      prevAdditional,
      next.additionalProperties,
      joinPath(path, 'additionalProperties'),
      ctx,
    )
  } else if (Object.hasOwn(prev, 'additionalProperties') && next.unevaluatedProperties === false) {
    ctx.changes.push({
      path: joinPath(path, 'additionalProperties'),
      kind: 'narrowed_constraint',
      message: 'removed additionalProperties while unevaluatedProperties is false',
    })
  }

  if (Object.hasOwn(next, 'items')) {
    const prevItems = Object.hasOwn(prev, 'items') ? prev.items : true
    compareSubschema(prevItems, next.items, joinPath(path, 'items'), ctx)
  } else if (Object.hasOwn(prev, 'items') && next.unevaluatedItems === false) {
    ctx.changes.push({
      path: joinPath(path, 'items'),
      kind: 'narrowed_constraint',
      message: 'removed items while unevaluatedItems is false',
    })
  }
}

/**
 * Evaluates backward compatibility from `previous` to `next` JSON Schema 2020-12 documents:
 * existing valid entries must remain valid (no new required fields, no removed properties,
 * and no narrowed types, subschemas, local `$ref` targets, or constraints).
 */
export function checkBackwardCompatibility(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): CompatibilityResult {
  const ctx: CompareContext = {
    prevRoot: previous,
    nextRoot: next,
    changes: [],
    visitedRefs: new Set(),
  }
  compareNodes(previous, next, '/', ctx)
  return { compatible: ctx.changes.length === 0, breakingChanges: ctx.changes }
}
