/** Extracts the token from an `Authorization: Bearer <token>` header value. */
export function parseBearerToken(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(headerValue.trim())
  return match?.[1]
}
