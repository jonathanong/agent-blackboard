import { AgentBlackboardError } from './errors.mjs'
import type { ClientConfig, EntryWireFormat, ReadRetryOptions } from './types.mjs'

const DEFAULT_READ_RETRY = { maxRetries: 2, initialDelayMs: 100, maxDelayMs: 1000 }
const MAX_READ_RETRIES = 10
const MAX_READ_DELAY_MS = 60_000
const RETRYABLE_READ_STATUSES = new Set([408, 429, 500, 502, 503, 504])

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

function assertSecureUrl(url: URL): void {
  if (url.protocol === 'https:') return
  if (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  )
    return
  throw new TypeError('baseUrl must use HTTPS; HTTP is allowed only for local loopback servers')
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

type NormalizedReadRetry = Required<ReadRetryOptions>

function readRetry(config: ClientConfig, method: string): NormalizedReadRetry | undefined {
  if (method !== 'GET' || config.readRetry === undefined) return undefined
  if (typeof config.readRetry !== 'object' || config.readRetry === null)
    throw new TypeError('readRetry must be an object')
  const options = { ...DEFAULT_READ_RETRY, ...config.readRetry }
  for (const [name, value, maximum] of [
    ['maxRetries', options.maxRetries, MAX_READ_RETRIES],
    ['initialDelayMs', options.initialDelayMs, MAX_READ_DELAY_MS],
    ['maxDelayMs', options.maxDelayMs, MAX_READ_DELAY_MS],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
      throw new RangeError(`${name} must be a non-negative integer no greater than ${maximum}`)
  }
  return options
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryDelay(options: NormalizedReadRetry, attempt: number): number {
  return Math.min(options.initialDelayMs * 2 ** attempt, options.maxDelayMs)
}

async function errorFor(response: Response, method: string, path: string): Promise<never> {
  throw new AgentBlackboardError(
    `agent-blackboard request failed: ${method} ${path} -> ${response.status}`,
    response.status,
    await parseErrorBody(response),
  )
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
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
  assertSecureUrl(url)
  const headers = new Headers(options.headers)
  headers.set('authorization', `Bearer ${config.token}`)
  const init: RequestInit = { method: options.method, headers }
  if (options.body !== undefined) init.body = options.body
  const retry = readRetry(config, options.method)
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      if (!retry || attempt === retry.maxRetries) throw error
      await delay(retryDelay(retry, attempt))
      continue
    }
    if (response.ok) return response
    if (!retry || attempt === retry.maxRetries || !RETRYABLE_READ_STATUSES.has(response.status))
      return errorFor(response, options.method, path)
    await discard(response)
    await delay(retryDelay(retry, attempt))
  }
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
