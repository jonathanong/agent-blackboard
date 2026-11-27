import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { MUTATING, READ_ONLY } from './schema-fields.mjs'

export const SCHEMA_REGISTRY_TOOLS: Tool[] = [
  {
    name: 'schema_list',
    description: 'Lists all registered JSON Schemas and the current schema registry revision.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ_ONLY,
  },
  {
    name: 'schema_get',
    description:
      'Fetches one registered JSON Schema by id (latest version by default, or a pinned positive integer version).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Registered schema id, for example "finding".' },
        version: {
          type: 'integer',
          minimum: 1,
          description: 'Optional pinned schema version number.',
        },
      },
      required: ['id'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'schema_pull',
    description:
      'Pulls the full JSON Schema registry into the local cache using If-None-Match so offline validation stays current.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Optional local schema cache directory override.',
        },
      },
    },
    annotations: MUTATING,
  },
  {
    name: 'schema_validate',
    description:
      'Validates an entry payload offline against a locally pulled schema (<id> or <id>@<version>).',
    inputSchema: {
      type: 'object',
      properties: {
        schema: {
          type: 'string',
          description:
            'Schema reference (<id> or <id>@<version>), for example "finding" or "finding@1".',
        },
        data: {
          type: 'object',
          description: 'Entry JSON payload to validate.',
        },
        dir: {
          type: 'string',
          description: 'Optional local schema cache directory override.',
        },
      },
      required: ['schema', 'data'],
    },
    annotations: READ_ONLY,
  },
]
