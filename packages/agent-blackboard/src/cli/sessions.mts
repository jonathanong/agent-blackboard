import { Sessions } from '../client/sessions.mjs'
import type { CreateSessionInput, ListSessionsQuery, Session } from '../client/types.mjs'
import { parseArgs, stringFlag, type ParsedArgs } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'

/** Shared by `create` and `ensure`, which take identical flags. */
function parseCreateSessionInput(
  subcommand: string,
  positional: string[],
  flags: ParsedArgs['flags'],
): CreateSessionInput {
  const id = positional[0]
  if (!id) throw new CliError(`sessions ${subcommand} requires <session-id>.`)
  const parentFlag = stringFlag(flags, 'parent-session-id')
  if (Object.hasOwn(flags, 'parent-session-id') && !parentFlag) {
    throw new CliError(`sessions ${subcommand} --parent-session-id requires <session-id>.`)
  }
  const agent = stringFlag(flags, 'agent')
  const version = stringFlag(flags, 'version')
  if (!agent) throw new CliError(`sessions ${subcommand} requires --agent <name>.`)
  if (!version) throw new CliError(`sessions ${subcommand} requires --version <version>.`)
  return { id, parentSessionId: parentFlag ?? null, agent, version }
}

export async function runSessions(argv: string[], ctx: CliContext): Promise<void> {
  const [subcommand, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  const sessions = new Sessions(clientConfigFromEnv(ctx.env))
  if (subcommand === 'create') {
    const input = parseCreateSessionInput('create', positional, flags)
    writeLine(ctx.stdout, JSON.stringify(await sessions.create(input)))
    return
  }
  if (subcommand === 'ensure') {
    const input = parseCreateSessionInput('ensure', positional, flags)
    writeLine(ctx.stdout, JSON.stringify(await sessions.ensure(input)))
    return
  }
  if (subcommand === 'list') {
    const archivedFlag = stringFlag(flags, 'archived')
    if (archivedFlag !== undefined && archivedFlag !== 'true' && archivedFlag !== 'false') {
      throw new CliError('sessions list --archived must be true or false.')
    }
    const inactiveForHoursFlag = stringFlag(flags, 'inactive-for-hours')
    const inactiveForHours =
      inactiveForHoursFlag === undefined ? undefined : Number(inactiveForHoursFlag)
    if (
      inactiveForHours !== undefined &&
      (!Number.isFinite(inactiveForHours) || inactiveForHours <= 0)
    ) {
      throw new CliError('sessions list --inactive-for-hours must be a positive number.')
    }
    const limitFlag = stringFlag(flags, 'limit')
    if (Object.hasOwn(flags, 'limit') && limitFlag === undefined) {
      throw new CliError('sessions list --limit requires <n>.')
    }
    const limit = limitFlag === undefined ? undefined : Number(limitFlag)
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new CliError('sessions list --limit must be a positive integer.')
    }
    const query: ListSessionsQuery = {
      ...(archivedFlag === undefined ? {} : { archived: archivedFlag === 'true' }),
      ...(inactiveForHours === undefined ? {} : { inactiveForHours }),
    }
    if (limit !== undefined) {
      // `--limit` fetches a single bounded page instead of the full drain below —
      // for a cheap connectivity probe (e.g. a health check) that only needs to
      // confirm the call succeeds. The store applies filters after the page limit,
      // so this page can be shorter than `n` (even empty) while more matching
      // sessions exist further in the table — do not treat this as a reliable
      // existence or count check.
      const page = await sessions.list({ ...query, limit })
      writeLine(ctx.stdout, JSON.stringify(page.sessions))
      return
    }
    // The CLI's stdout contract is a flat JSON array (pre-pagination shape) —
    // drain every page here rather than surfacing cursors, so scripts piping
    // `sessions list` output don't need to know pagination exists.
    const all: Session[] = []
    let cursor: string | undefined
    do {
      const page = await sessions.list(cursor === undefined ? query : { ...query, cursor })
      all.push(...page.sessions)
      cursor = page.nextCursor ?? undefined
    } while (cursor !== undefined)
    writeLine(ctx.stdout, JSON.stringify(all))
    return
  }
  const id = positional[0]
  if (!id) throw new CliError(`sessions ${subcommand ?? '<subcommand>'} requires <session-id>.`)
  if (subcommand === 'get') {
    writeLine(ctx.stdout, JSON.stringify(await sessions.get(id)))
    return
  }
  if (subcommand === 'archive') {
    writeLine(ctx.stdout, JSON.stringify(await sessions.archive(id)))
    return
  }
  if (subcommand === 'patch') {
    const raw = stringFlag(flags, 'data')
    if (!raw) throw new CliError('sessions patch requires --data <json>.')
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new CliError('--data must be a JSON object.')
    }
    if (
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data) ||
      Object.keys(data).length === 0
    ) {
      throw new CliError('--data must be a non-empty JSON object.')
    }
    writeLine(
      ctx.stdout,
      JSON.stringify(
        await sessions.patch({ sessionId: id, data: data as Record<string, unknown> }),
      ),
    )
    return
  }
  throw new CliError('sessions requires one of: create, ensure, list, get, patch, archive.')
}
