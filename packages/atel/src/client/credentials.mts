import { rawRequest, requestJson } from './http.mjs'
import type { ClientConfig, CredentialCreated, CredentialSummary } from './types.mjs'

/** `POST /credentials` (admin-only) — creates a telemetry credential. The token is shown once. */
export async function createCredential(
  config: ClientConfig,
  input: { name: string },
): Promise<CredentialCreated> {
  return requestJson(config, '/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** `GET /credentials` (admin-only) — lists credentials; never includes tokens. */
export async function listCredentials(config: ClientConfig): Promise<CredentialSummary[]> {
  return requestJson(config, '/credentials', { method: 'GET' })
}

/** `DELETE /credentials?id=` or `?name=` (admin-only). */
export async function deleteCredential(
  config: ClientConfig,
  selector: { id: string } | { name: string },
): Promise<void> {
  const query = 'id' in selector ? { id: selector.id } : { name: selector.name }
  const response = await rawRequest(config, '/credentials', { method: 'DELETE', query })
  await response.text()
}
