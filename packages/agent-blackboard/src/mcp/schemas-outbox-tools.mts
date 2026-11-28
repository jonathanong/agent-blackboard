import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { MUTATING, READ_ONLY, SESSION_ID } from './schema-fields.mjs'

export const OUTBOX_TOOLS: Tool[] = [
  {
    name: 'outbox_status',
    description:
      'Reports pending and rejected entry counts per session in the local worktree outbox, including saved server errors for rejected records.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Optional local outbox directory override.' },
      },
    },
    annotations: READ_ONLY,
  },
  {
    name: 'outbox_flush',
    description:
      'Delivers queued entries from the local outbox to the server. Permanent 4xx rejections are moved to rejected/ with their server error so they do not block the queue.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          ...SESSION_ID,
          description: 'Optional session id to flush; omit to flush all sessions.',
        },
        dir: { type: 'string', description: 'Optional local outbox directory override.' },
      },
    },
    annotations: MUTATING,
  },
  {
    name: 'outbox_prune_rejected',
    description:
      'Removes permanently rejected records from the local outbox (all, or filtered by id and/or sessionId).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional specific rejected outbox record id.' },
        sessionId: {
          ...SESSION_ID,
          description: 'Optional session id whose rejected records should be removed.',
        },
        dir: { type: 'string', description: 'Optional local outbox directory override.' },
      },
    },
    annotations: MUTATING,
  },
]
