/** Thrown for any non-2xx response from the atel HTTP API. */
export class AtelError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number
  /** Parsed error body — JSON if the response was JSON, raw text otherwise. */
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'AtelError'
    this.status = status
    this.body = body
  }
}
