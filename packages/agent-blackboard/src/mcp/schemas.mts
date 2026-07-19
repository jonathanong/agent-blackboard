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
      },
      required: ['sessionId', 'parentSessionId'],
    },
  },
  {
    name: 'session_archive',
    description: 'Archives a session, preventing further entry reads and writes.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: SESSION_ID },
      required: ['sessionId'],
    },
  },
  {
    name: 'entry_append',
    description: 'Appends unstructured data to an existing active session.',
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
    description: 'Reads entries from one existing active session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        format: { type: 'string', enum: ['json', 'jsonl'] },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'entry_patch',
    description: 'Shallow-merges data into one timestamp-addressed session entry.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        createdAt: { type: 'string', description: 'The entry timestamp returned by entry_append.' },
        data: { type: 'object', description: 'Non-empty data to shallow-merge.' },
      },
      required: ['sessionId', 'createdAt', 'data'],
    },
  },
]
