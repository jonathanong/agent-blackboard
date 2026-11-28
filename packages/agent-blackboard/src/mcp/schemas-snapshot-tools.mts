import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { ADDITIVE, MUTATING } from './schema-fields.mjs'

export const SNAPSHOT_TOOLS: Tool[] = [
  {
    name: 'snapshot_export',
    description:
      'Streams an immutable non-archived snapshot into a local private JSONL file and returns its path, counts, checksum, manifest, and (when path is omitted) cleanupToken.',
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
    name: 'snapshot_partition',
    description:
      'Splits a generated temporary snapshot JSONL file into bounded session-preserving read-only partitions using the cleanupToken from snapshot_export.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Generated temporary snapshot path returned by snapshot_export.',
        },
        cleanupToken: {
          type: 'string',
          description: 'Ownership capability returned by snapshot_export.',
        },
        maxSessions: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum whole sessions per partition (default 25).',
        },
        maxBytes: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum bytes per partition (default 1048576).',
        },
        checksum: {
          type: 'string',
          pattern: '^[a-f0-9]{64}$',
          description: 'Optional SHA-256 hex digest to verify against the snapshot file.',
        },
        counts: {
          type: 'object',
          description: 'Optional exact snapshot counts to verify before partitioning.',
          properties: {
            sessions: { type: 'integer', minimum: 0 },
            entries: { type: 'integer', minimum: 0 },
            records: { type: 'integer', minimum: 0 },
            bytes: { type: 'integer', minimum: 0 },
          },
          required: ['sessions', 'entries', 'records', 'bytes'],
        },
      },
      required: ['path', 'cleanupToken'],
    },
    annotations: ADDITIVE,
  },
  {
    name: 'snapshot_cleanup',
    description:
      'Removes a generated temporary snapshot file and/or partition directory using the cleanupToken from snapshot_export or snapshot_partition. Pass path, directory, or both: the token alone removes nothing and is rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Generated temporary snapshot path to remove.',
        },
        directory: {
          type: 'string',
          description: 'Generated temporary partition directory to remove.',
        },
        cleanupToken: {
          type: 'string',
          description: 'Ownership capability returned by snapshot_export or snapshot_partition.',
        },
      },
      required: ['cleanupToken'],
    },
    annotations: MUTATING,
  },
]
