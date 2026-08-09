import { anchorPayloadHex } from './commitment.js';

/** Default RPC ports, from CDCI's `src/chainparamsbase.cpp`. */
export const CDCI_RPC_PORTS = Object.freeze({
  main: 13431,
  test: 23431,
  devnet: 19798,
  regtest: 19898,
});

/** Raised when the CDCI node refuses or cannot be reached. */
export class CdciWalletError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: number, method?: string, cause?: unknown }} [details]
   */
  constructor(message, { code, method, cause } = {}) {
    super(message);
    this.name = 'CdciWalletError';
    this.code = code ?? null;
    this.method = method ?? null;
    this.cause = cause;
  }
}

/**
 * Publishes anchors from a CDCI wallet.
 *
 * This is the part of a chat app that spends coins, so it belongs on a server or
 * in a desktop client next to the wallet - never in a page where the RPC
 * credentials would be exposed. A browser app should either use a relay of your
 * own or run the explorer with `CDCI_ANCHOR_MODE=wallet`.
 *
 * Requires a `centraldatabased` node with a funded, unlocked wallet.
 */
export class CdciWallet {
  /**
   * @param {object} options
   * @param {string} [options.url] defaults to the network's RPC port on localhost
   * @param {string} [options.network] `main`, `test`, `devnet` or `regtest`
   * @param {string} [options.user]
   * @param {string} [options.password]
   * @param {number} [options.timeoutMs]
   * @param {typeof fetch} [options.fetch]
   */
  constructor({
    url,
    network = 'main',
    user,
    password,
    timeoutMs = 10_000,
    fetch: fetchImpl = globalThis.fetch,
  } = {}) {
    this.url = url ?? `http://127.0.0.1:${CDCI_RPC_PORTS[network] ?? CDCI_RPC_PORTS.main}/`;
    this.network = network;
    this.user = user;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.requestId = 0;
  }

  /**
   * Calls one JSON-RPC method on the node.
   * @param {string} method
   * @param {unknown[]} [params]
   * @returns {Promise<any>}
   */
  async call(method, params = []) {
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json' };
    if (this.user) {
      headers.authorization = `Basic ${base64(`${this.user}:${this.password ?? ''}`)}`;
    }

    let response;
    try {
      response = await this.fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '1.0', id: (this.requestId += 1), method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new CdciWalletError(`The CDCI node at ${this.url} is unreachable.`, { method, cause: error });
    }

    if (response.status === 401) {
      throw new CdciWalletError(`The CDCI node at ${this.url} rejected the RPC credentials.`, { method });
    }

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new CdciWalletError(`The CDCI node returned a non-JSON response (HTTP ${response.status}).`, {
        method,
        cause: error,
      });
    }
    if (body?.error) {
      throw new CdciWalletError(`CDCI RPC ${method} failed: ${body.error.message}`, {
        method,
        code: body.error.code,
      });
    }
    return body?.result;
  }

  /** Chain height, tip and node version - handy for a health display. */
  async info() {
    const info = await this.call('getblockchaininfo');
    return {
      chain: info?.chain ?? null,
      blocks: info?.blocks ?? null,
      bestBlockHash: info?.bestblockhash ?? null,
      difficulty: info?.difficulty ?? null,
    };
  }

  /**
   * Publishes one anchor commitment in an `OP_RETURN` output and returns the
   * transaction id to submit to the explorer as `anchorTxid`.
   * @param {string} commitment 64 hex characters
   * @returns {Promise<{ txid: string, fee: number | null }>}
   */
  async publishAnchor(commitment) {
    const unfunded = await this.call('createrawtransaction', [[], { data: anchorPayloadHex(commitment) }]);
    const funded = await this.call('fundrawtransaction', [unfunded]);
    const signed = await this.call('signrawtransactionwithwallet', [funded.hex]);
    if (!signed?.complete) {
      throw new CdciWalletError('The CDCI wallet could not fully sign the anchor transaction.', {
        method: 'signrawtransactionwithwallet',
      });
    }
    const txid = await this.call('sendrawtransaction', [signed.hex]);
    return { txid, fee: funded.fee ?? null };
  }
}

/** @param {string} value */
function base64(value) {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(value);
  return Buffer.from(value).toString('base64');
}
