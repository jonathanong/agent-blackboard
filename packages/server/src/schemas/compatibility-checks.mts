type BreakingChangeKind =
  | 'added_required'
  | 'removed_property'
  | 'narrowed_type'
  | 'narrowed_enum'
  | 'narrowed_const'
  | 'narrowed_constraint'
  | 'changed_ref'

export interface BreakingChange {
  path: string
  kind: BreakingChangeKind
  message: string
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    return (
      aKeys.length === bKeys.length && aKeys.every((key) => key in b && jsonEqual(a[key], b[key]))
    )
  }
  return false
}

export function joinPath(base: string, segment: string): string {
  const escaped = segment.replaceAll('~', '~0').replaceAll('/', '~1')
  return base === '/' ? `/${escaped}` : `${base}/${escaped}`
}

function normalizeTypes(value: unknown): Set<string> | undefined {
  if (typeof value === 'string') return new Set([value])
  if (Array.isArray(value)) {
    return new Set(value.filter((item): item is string => typeof item === 'string'))
  }
  return undefined
}

function typeAllowedBy(typeName: string, allowed: Set<string>): boolean {
  if (allowed.has(typeName)) return true
  return typeName === 'integer' && allowed.has('number')
}

export function checkBounds(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  path: string,
  changes: BreakingChange[],
): void {
  const minKeys = ['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties'] as const
  for (const key of minKeys) {
    const nextVal = next[key]
    if (typeof nextVal !== 'number') continue
    const prevVal = prev[key]
    if (typeof prevVal !== 'number' || nextVal > prevVal) {
      changes.push({ path, kind: 'narrowed_constraint', message: `narrowed ${key} to ${nextVal}` })
    }
  }
  const maxKeys = ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties'] as const
  for (const key of maxKeys) {
    const nextVal = next[key]
    if (typeof nextVal !== 'number') continue
    const prevVal = prev[key]
    if (typeof prevVal !== 'number' || nextVal < prevVal) {
      changes.push({ path, kind: 'narrowed_constraint', message: `narrowed ${key} to ${nextVal}` })
    }
  }
  if (next.uniqueItems === true && prev.uniqueItems !== true) {
    changes.push({ path, kind: 'narrowed_constraint', message: 'enabled uniqueItems' })
  }
  for (const key of ['pattern', 'format', 'multipleOf'] as const) {
    if (next[key] !== undefined && next[key] !== prev[key]) {
      changes.push({ path, kind: 'narrowed_constraint', message: `changed ${key}` })
    }
  }
}

export function checkTypeAndEnum(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  path: string,
  changes: BreakingChange[],
): void {
  const prevTypes = normalizeTypes(prev.type)
  const nextTypes = normalizeTypes(next.type)
  if (nextTypes !== undefined) {
    if (prevTypes === undefined) {
      changes.push({
        path,
        kind: 'narrowed_type',
        message: `restricted type to ${[...nextTypes].join('|')}`,
      })
    } else {
      for (const t of prevTypes) {
        if (!typeAllowedBy(t, nextTypes)) {
          changes.push({ path, kind: 'narrowed_type', message: `removed allowed type "${t}"` })
        }
      }
    }
  }
  if (Array.isArray(next.enum)) {
    if (!Array.isArray(prev.enum)) {
      changes.push({ path, kind: 'narrowed_enum', message: 'added enum restriction' })
    } else {
      for (const value of prev.enum) {
        if (!next.enum.some((candidate) => jsonEqual(value, candidate))) {
          changes.push({
            path,
            kind: 'narrowed_enum',
            message: `removed enum value ${JSON.stringify(value)}`,
          })
        }
      }
    }
  }
  if ('const' in next && (!('const' in prev) || !jsonEqual(prev.const, next.const))) {
    changes.push({
      path,
      kind: 'narrowed_const',
      message: `restricted const to ${JSON.stringify(next.const)}`,
    })
  }
  if (typeof next.$ref === 'string' && next.$ref !== prev.$ref) {
    changes.push({ path, kind: 'changed_ref', message: `changed $ref to ${next.$ref}` })
  }
}
