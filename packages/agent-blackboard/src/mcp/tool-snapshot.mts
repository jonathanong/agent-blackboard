import { Snapshots } from '../client/snapshots.mjs'
import {
  expectObject,
  nullableString,
  optionalPositiveNumber,
  requiredString,
} from './validate.mjs'
import type { ClientConfig, SnapshotSelection } from '../client/types.mjs'

function parentSessionId(value: unknown): string | null {
  const id = nullableString(value, 'parentSessionId')
  if (id !== null && !/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error('"parentSessionId" is invalid.')
  }
  return id
}

function dataArrayContains(value: unknown): Record<string, string> {
  const object = expectObject(value, 'dataArrayContains')
  if (
    Object.keys(object).length === 0 ||
    Object.entries(object).some(
      ([key, item]) => key.length === 0 || typeof item !== 'string' || item.length === 0,
    )
  ) {
    throw new Error('"dataArrayContains" must contain only string values.')
  }
  return object as Record<string, string>
}

function selectionFrom(args: Record<string, unknown>): SnapshotSelection {
  const hasParent = Object.hasOwn(args, 'parentSessionId')
  return {
    ...(args.agent === undefined ? {} : { agent: requiredString(args.agent, 'agent') }),
    ...(args.version === undefined ? {} : { version: requiredString(args.version, 'version') }),
    ...(hasParent ? { parentSessionId: parentSessionId(args.parentSessionId) } : {}),
    ...(args.data === undefined ? {} : { data: expectObject(args.data, 'data') }),
    ...(args.dataArrayContains === undefined
      ? {}
      : { dataArrayContains: dataArrayContains(args.dataArrayContains) }),
    ...(args.inactiveForHours === undefined
      ? {}
      : { inactiveForHours: optionalPositiveNumber(args.inactiveForHours, 'inactiveForHours')! }),
  }
}

/** Exports a local JSONL evidence file; never returns the snapshot records through MCP. */
export function handleSnapshotExport(
  args: Record<string, unknown>,
  config: ClientConfig,
): ReturnType<Snapshots['export']> {
  const path = args.path === undefined ? undefined : requiredString(args.path, 'path')
  return new Snapshots(config).export({
    ...(path === undefined ? {} : { path }),
    selection: selectionFrom(args),
  })
}
