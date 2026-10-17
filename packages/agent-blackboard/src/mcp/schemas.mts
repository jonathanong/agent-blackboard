import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  ADDITIVE,
  AGENT,
  IDEMPOTENT_ADDITIVE,
  MUTATING,
  READ_ONLY,
  RESOLVABLE_SESSION_ID,
  SESSION_ID,
} from './schema-fields.mjs'

export const ENTRY_TOOLS: Tool[] = [
  {
    name: 'snapshot_export',
    description:
      'Streams an immutable non-archived snapshot into a local private JSONL file and returns only its path, counts, checksum, and manifest.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional new absolute destination path.' },
        agent: { type: 'string', description: 'Exact agent name to include.' },
        version: { type: 'string', description: 'Exact agent version to include.' },
        parentSessionId: {
          type: ['string', 'null'],
          pattern: '^[A-Za-z0-9._:-]+$',
          description: 'Exact parent id; null selects root sessions.',
        },
        data: { type: 'object', description: 'Top-level session data fields to match exactly.' },
        dataArrayContains: { type: 'object', description: 'Exact string membership in arrays.' },
        inactiveForHours: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Only sessions inactive for this many hours (createdAt if no entries).',
        },
      },
    },
    annotations: ADDITIVE,
  },
  {
    name: 'session_create',
    description: 'Creates a root or subagent session before entries are appended.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: RESOLVABLE_SESSION_ID,
        parentSessionId: {
          type: ['string', 'null'],
          description: 'Null for a root session; the direct parent session id for a subagent.',
        },
        agent: AGENT,
        version: { type: 'string', description: 'Agent version, for example 1.0.13.' },
      },
      required: ['parentSessionId', 'version'],
    },
    annotations: ADDITIVE,
  },
  {
    name: 'session_ensure',
    description:
      'Idempotently creates a session: if it already exists, verifies parentSessionId/agent/version ' +
      'match instead of erroring, returning status "created" or "exists" either way.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: RESOLVABLE_SESSION_ID,
        parentSessionId: {
          type: ['string', 'null'],
          description: 'Null for a root session; the direct parent session id for a subagent.',
        },
        agent: AGENT,
        version: { type: 'string', description: 'Agent version, for example 1.0.13.' },
      },
      required: ['parentSessionId', 'version'],
    },
    annotations: IDEMPOTENT_ADDITIVE,
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
        dataArrayContains: { type: 'object', description: 'Exact string membership in arrays.' },
        inactiveForHours: {
          type: 'number',
          exclusiveMinimum: 0,
          description:
            'Matches sessions whose last entry (or createdAt, without entries) is strictly older than this many hours.',
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
    annotations: READ_ONLY,
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
    annotations: MUTATING,
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
    annotations: MUTATING,
  },
  {
    name: 'entry_append',
    description: 'Appends unstructured data to an existing session, including an archived one.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: RESOLVABLE_SESSION_ID,
        data: { type: 'object', description: 'Unstructured JSON payload.' },
      },
      required: ['data'],
    },
    annotations: ADDITIVE,
  },
  {
    name: 'entry_get',
    description: 'Reads entries from one existing session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: RESOLVABLE_SESSION_ID,
        format: { type: 'string', enum: ['json', 'jsonl'] },
      },
    },
    annotations: READ_ONLY,
  },
]
