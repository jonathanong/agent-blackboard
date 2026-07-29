import { Sessions } from '../client/sessions.mjs'
import type { ListSessionsQuery, Session } from '../client/types.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'

export async function runSessions(argv: string[], ctx: CliContext): Promise<void> {
  const [subcommand, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  const sessions = new Sessions(clientConfigFromEnv(ctx.env))
  if (subcommand === 'create') {
    const id = positional[0]
    if (!id) throw new CliError('sessions create requires <session-id>.')
    const parentFlag = stringFlag(flags, 'parent-session-id')
    if (Object.hasOwn(flags, 'parent-session-id') && !parentFlag) {
      throw new CliError('sessions create --parent-session-id requires <session-id>.')
    }
    const parentSessionId = parentFlag ?? null
    const agent = stringFlag(flags, 'agent')
    const version = stringFlag(flags, 'version')
    if (!agent) throw new CliError('sessions create requires --agent <name>.')
    if (!version) throw new CliError('sessions create requires --version <version>.')
    writeLine(
      ctx.stdout,
      JSON.stringify(await sessions.create({ id, parentSessionId, agent, version })),
    )
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
    const query: ListSessionsQuery = {
      ...(archivedFlag === undefined ? {} : { archived: archivedFlag === 'true' }),
      ...(inactiveForHours === undefined ? {} : { inactiveForHours }),
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
  throw new CliError('sessions requires one of: create, list, get, patch, archive.')
}
