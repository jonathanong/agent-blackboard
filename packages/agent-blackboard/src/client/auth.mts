import { createCredential, deleteCredential, listCredentials } from './credentials.mjs'
import type { CredentialCreated, CredentialSummary } from './types.mjs'

export interface AuthOptions {
  baseUrl: string
  /** Admin token (`abb_admin_<name>_<secret>`) — never a client token. */
  adminToken: string
}

/**
 * Credential (tenant) management — admin-only. Never used by the MCP
 * server; wired up for the CLI's `credentials` subcommands only.
 */
export class Auth {
  readonly #config: { baseUrl: string; token: string }

  constructor(options: AuthOptions) {
    this.#config = { baseUrl: options.baseUrl, token: options.adminToken }
  }

  /** Creates a new client credential. The token is returned once. */
  async createCredentials(input: { name: string }): Promise<CredentialCreated> {
    return createCredential(this.#config, input)
  }

  /** Lists known credentials (never includes tokens). */
  async listCredentials(): Promise<CredentialSummary[]> {
    return listCredentials(this.#config)
  }

  /** Deletes a credential by id or by name. */
  async deleteCredentials(selector: { id: string } | { name: string }): Promise<void> {
    return deleteCredential(this.#config, selector)
  }
}
