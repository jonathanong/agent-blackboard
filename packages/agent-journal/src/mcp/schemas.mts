import type { Tool } from '@modelcontextprotocol/sdk/types.js'

/**
 * The three MCP tools this server exposes. Credential management
 * (`create`/`list`/`delete`) is deliberately NOT here — that's CLI/admin
 * only, per the plan's hard separation between admin and journaling
 * surfaces.
 */

const JOURNAL_APPEND_TOOL: Tool = {
  name: 'journal_append',
  description:
    'Append an entry to the agent journal for the current (or given) session. `data` is unstructured JSON — attach whatever is useful: notes, branch names, PR numbers, decisions made. This is a stream-of-consciousness log, not a knowledge base.',
  inputSchema: {
    type: 'object',
    properties: {
      data: { type: 'object', description: 'Unstructured JSON payload for this entry.' },
      sessionId: {
        type: 'string',
        description: 'Session id to journal under. Defaults to the current session.',
      },
      agent: { type: 'string', description: "Agent identifier. Defaults to 'claude-code'." },
    },
    required: ['data'],
  },
}

const JOURNAL_GET_TOOL: Tool = {
  name: 'journal_get',
  description:
    'Reads back journal entries for the current (or given) session, optionally filtered by agent/archived.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session id to read. Defaults to the current session.',
      },
      agent: { type: 'string', description: 'Filter by agent identifier.' },
      archived: { type: 'boolean', description: 'Filter by archived status.' },
      format: {
        type: 'string',
        enum: ['json', 'jsonl'],
        description: 'Internal wire format. Defaults to jsonl.',
      },
    },
  },
}

const JOURNAL_PATCH_TOOL: Tool = {
  name: 'journal_patch',
  description:
    'Batch-patches journal entries by id — archive them and/or shallow-merge new data into their existing `data` blob (e.g. attach a PR number once it exists).',
  inputSchema: {
    type: 'object',
    properties: {
      patches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            archived: { type: 'boolean' },
            data: { type: 'object', description: 'Shallow-merged into the existing data blob.' },
          },
          required: ['id'],
        },
      },
    },
    required: ['patches'],
  },
}

export const JOURNAL_TOOLS: Tool[] = [JOURNAL_APPEND_TOOL, JOURNAL_GET_TOOL, JOURNAL_PATCH_TOOL]
