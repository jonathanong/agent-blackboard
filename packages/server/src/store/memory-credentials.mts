import { hashToken } from '../auth/hash.mjs'
import { generateClientToken } from '../auth/tokens.mjs'
import type { CredentialRecord } from '../core/types.mjs'
import type { CredentialIdOrName } from './store.mjs'

/** In-memory credential store composed by `MemoryBlackboardStore`. */
export class MemoryCredentialStore {
  readonly #credentials = new Map<string, CredentialRecord>()
  readonly #now: () => Date

  constructor(now: () => Date) {
    this.#now = now
  }

  create(name: string): { record: CredentialRecord; token: string } {
    const { credId, token } = generateClientToken()
    const record: CredentialRecord = {
      id: credId,
      name,
      tokenHash: hashToken(token),
      createdAt: this.#now().toISOString(),
    }
    this.#credentials.set(credId, record)
    return { record, token }
  }

  list(): CredentialRecord[] {
    return [...this.#credentials.values()]
  }

  getById(id: string): CredentialRecord | undefined {
    return this.#credentials.get(id)
  }

  delete(idOrName: CredentialIdOrName): boolean {
    if (idOrName.id) return this.#credentials.delete(idOrName.id)
    if (!idOrName.name) return false
    const matchingIds = [...this.#credentials.entries()]
      .filter(([, record]) => record.name === idOrName.name)
      .map(([id]) => id)
    for (const id of matchingIds) this.#credentials.delete(id)
    return matchingIds.length > 0
  }
}
