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

function selectionFrom(args: Record<string, unknown>): SnapshotSelection {
  const hasParent = Object.hasOwn(args, 'parentSessionId')
  return {
    ...(args.agent === undefined ? {} : { agent: requiredString(args.agent, 'agent') }),
    ...(args.version === undefined ? {} : { version: requiredString(args.version, 'version') }),
    ...(hasParent ? { parentSessionId: parentSessionId(args.parentSessionId) } : {}),
    ...(args.data === undefined ? {} : { data: expectObject(args.data, 'data') }),
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
