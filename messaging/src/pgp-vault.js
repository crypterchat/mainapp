/**
 * In-memory unlocked OpenPGP private keys keyed by session token.
 * Never persisted to disk.
 */
export class PgpVault {
  constructor() {
    /** @type {Map<string, { phone: string, privateKey: import('openpgp').PrivateKey, unlockedAt: number }>} */
    this.byToken = new Map();
  }

  set(token, phone, privateKey) {
    this.byToken.set(token, { phone, privateKey, unlockedAt: Date.now() });
  }

  get(token) {
    return this.byToken.get(token) || null;
  }

  clear(token) {
    this.byToken.delete(token);
  }

  clearPhone(phone) {
    for (const [token, entry] of this.byToken) {
      if (entry.phone === phone) this.byToken.delete(token);
    }
  }
}
