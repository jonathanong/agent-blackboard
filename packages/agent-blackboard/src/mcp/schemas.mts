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
    description: 'Searches active or archived sessions using exact metadata and data filters.',
    inputSchema: {
      type: 'object',
      properties: {
        archived: {
          type: 'integer',
          enum: [0, 1],
          description: '0 or omitted searches active sessions; 1 searches archived sessions.',
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
      },
    },
  },
  {
    name: 'session_patch',
    description: 'Shallow-merges arbitrary data into one active session.',
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
    description: 'Archives a session, preserving reads while preventing further writes.',
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
    description: 'Reads entries from one existing active or archived session.',
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
