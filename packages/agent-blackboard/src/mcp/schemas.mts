import type { Tool } from '@modelcontextprotocol/sdk/types.js'

const SESSION_ID = {
  type: 'string' as const,
  description: 'Caller-supplied session id. Never inferred or generated.',
}

export const ENTRY_TOOLS: Tool[] = [
  {
    name: 'session_create',
    description: 'Creates a root or subagent session before entries are appended.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        parentSessionId: {
          type: ['string', 'null'],
          description: 'Null for a root session; the direct parent session id for a subagent.',
        },
        agent: { type: 'string', description: 'Agent name, for example claude-code.' },
        version: { type: 'string', description: 'Agent version, for example 1.0.13.' },
      },
      required: ['sessionId', 'parentSessionId', 'agent', 'version'],
    },
  },
  {
    name: 'session_search',
    description:
      'Searches undistilled or archived sessions using exact metadata, data, and inactivity filters. Returns ' +
      'one page at a time via limit/cursor; page until nextCursor is null for the complete ' +
      'result set.',
    inputSchema: {
      type: 'object',
      properties: {
        archived: {
          type: 'integer',
          enum: [0, 1],
          description: '0 or omitted searches undistilled sessions; 1 searches archived sessions.',
        },
        sessionId: { type: 'string', description: 'Exact session id to match.' },
        parentSessionId: {
          type: ['string', 'null'],
          description: 'Exact parent id to match; null matches root sessions.',
        },
        agent: { type: 'string', description: 'Exact agent name to match.' },
        version: { type: 'string', description: 'Exact agent version to match.' },
        data: {
          type: 'object',
          description: 'Top-level data fields whose JSON values must match exactly.',
        },
        inactiveForHours: {
          type: 'number',
          exclusiveMinimum: 0,
          description:
            'Matches sessions whose last entry is strictly older than this many hours; sessions without entries do not match.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description:
            'Max sessions per page (server default 50, hard max 200 — see MAX_SESSIONS_LIMIT in packages/server/src/store/store.mts).',
        },
        cursor: {
          type: 'string',
          description:
            "Opaque cursor from a previous call's nextCursor. Omit to fetch the first page.",
        },
      },
    },
  },
  {
    name: 'session_patch',
    description: 'Shallow-merges arbitrary data into one unarchived session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        data: { type: 'object', description: 'Non-empty session data to shallow-merge.' },
      },
      required: ['sessionId', 'data'],
    },
  },
  {
    name: 'session_archive',
    description:
      'Marks a session as distilled. Metadata becomes immutable, but entries remain appendable.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: SESSION_ID },
      required: ['sessionId'],
    },
  },
  {
    name: 'entry_append',
    description: 'Appends unstructured data to an existing session, including an archived one.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        data: { type: 'object', description: 'Unstructured JSON payload.' },
      },
      required: ['sessionId', 'data'],
    },
  },
  {
    name: 'entry_get',
    description: 'Reads entries from one existing session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        format: { type: 'string', enum: ['json', 'jsonl'] },
      },
      required: ['sessionId'],
    },
  },
]
