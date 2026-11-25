import { readLocalManifest, resolveSchemasDir } from '../schemas/local-store.mjs'
import type { CliContext } from './context.mjs'
import { writeLine } from './output.mjs'

/**
 * Returns an `onSchemaRevision` callback that warns once on `stderr` whenever
 * the server advertises a schema registry revision newer than the local copy.
 */
export function createRevisionNotifier(ctx: CliContext): (serverRevision: number) => void {
  let warned = false
  return (serverRevision: number) => {
    if (warned || serverRevision <= 0) return
    const dir = resolveSchemasDir(ctx.cwd, ctx.env)
    const localRevision = readLocalManifest(dir)?.revision ?? 0
    if (serverRevision > localRevision) {
      warned = true
      writeLine(
        ctx.stderr,
        `Schema registry is out of date (local rev ${localRevision}, server rev ${serverRevision}). Run: agent-blackboard schemas pull`,
      )
    }
  }
}
