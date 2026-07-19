import { AgentBlackboardError } from './errors.mjs'
import type { ClientConfig, EntryWireFormat } from './types.mjs'

/** Query params as they go on the wire — every value is a string. */
type WireQuery = Record<string, string>

/** Converts a typed entry query into wire-format string params. */
export function buildEntriesQuery(format?: EntryWireFormat): WireQuery {
  const wire: WireQuery = {}
  if (format !== undefined) wire.format = format
  return wire
}

const ACCEPT_HEADERS: Record<EntryWireFormat, string> = {
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  markdown: 'text/markdown',
}

/** The `Accept` header that matches a given wire format. */
export function acceptHeaderFor(format: EntryWireFormat): string {
  return ACCEPT_HEADERS[format]
}

function buildUrl(baseUrl: string, path: string, query: WireQuery): URL {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const url = new URL(path.replace(/^\//, ''), base)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return url
}

async function parseErrorBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

interface RequestOptions {
  method: string
  headers?: Record<string, string>
  body?: string
  query?: WireQuery
}

/**
 * Issues an authenticated HTTP request and returns the raw `Response`,
 * throwing `AgentBlackboardError` on any non-2xx status. Callers that need the
 * body streamed (not buffered) should read `response.body` directly.
 */
export async function rawRequest(
  config: ClientConfig,
  path: string,
  options: RequestOptions,
): Promise<Response> {
  const url = buildUrl(config.baseUrl, path, options.query ?? {})
  const headers = new Headers(options.headers)
  headers.set('authorization', `Bearer ${config.token}`)
  const init: RequestInit = { method: options.method, headers }
  if (options.body !== undefined) init.body = options.body
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await parseErrorBody(response)
    throw new AgentBlackboardError(
      `agent-blackboard request failed: ${options.method} ${path} -> ${response.status}`,
      response.status,
      body,
    )
  }
  return response
}

/** Issues an authenticated HTTP request and parses the response body as JSON. */
export async function requestJson<T>(
  config: ClientConfig,
  path: string,
  options: RequestOptions,
): Promise<T> {
  const response = await rawRequest(config, path, options)
  return (await response.json()) as T
}
