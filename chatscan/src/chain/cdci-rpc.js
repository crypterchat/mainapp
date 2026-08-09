import fs from 'node:fs';

import { HttpError } from '../util/errors.js';

/** Default RPC ports from CDCI's `CreateBaseChainParams` (src/chainparamsbase.cpp). */
export const CDCI_RPC_PORTS = Object.freeze({
  main: 13431,
  test: 23431,
  devnet: 19798,
  regtest: 19898,
});

/** Default P2P ports, for documentation and diagnostics. */
export const CDCI_P2P_PORTS = Object.freeze({
  main: 13432,
  test: 23432,
  devnet: 19799,
  regtest: 19899,
});

/** CDCI mainnet genesis hash, used to confirm a node is on the expected chain. */
export const CDCI_GENESIS_HASH = Object.freeze({
  main: '00000a34128e4769e9ccc6ed6ae234555421b305d62ecb3ce0477a80f4686fb1',
});

/** Raised when the CDCI node is unreachable, unauthenticated, or errors. */
export class CdciRpcError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: number, method?: string, cause?: unknown }} [details]
   */
  constructor(message, { code, method, cause } = {}) {
    super(message);
    this.name = 'CdciRpcError';
    this.code = code ?? null;
    this.method = method ?? null;
    this.cause = cause;
  }

  /** The node being down is an upstream failure, not a client mistake. */
  toHttpError() {
    return new HttpError(502, 'cdci_unavailable', this.message, {
      rpcMethod: this.method,
      rpcCode: this.code,
    });
  }
}

/**
 * JSON-RPC client for `centraldatabased`.
 *
 * Authentication follows the daemon's own conventions: either an explicit
 * `rpcuser`/`rpcpassword`, or the `__cookie__` credentials the node writes to
 * `<datadir>/.cookie` (see COOKIEAUTH_USER in src/rpc/protocol.cpp). The cookie
 * is re-read on each call, so a node restart that rotates it is picked up
 * without restarting ChatScan.
 */
export class CdciRpc {
  /**
   * @param {object} options
   * @param {string} options.url
   * @param {string} [options.user]
   * @param {string} [options.password]
   * @param {string} [options.cookieFile]
   * @param {number} [options.timeoutMs]
   * @param {typeof fetch} [options.fetchImpl]
   */
  constructor({ url, user, password, cookieFile, timeoutMs = 5000, fetchImpl = fetch }) {
    this.url = url;
    this.user = user;
    this.password = password;
    this.cookieFile = cookieFile;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.requestId = 0;
  }

  /** @returns {string | null} `user:password`, or null when unauthenticated. */
  #credentials() {
    if (this.user) return `${this.user}:${this.password ?? ''}`;
    if (!this.cookieFile) return null;
    try {
      return fs.readFileSync(this.cookieFile, 'utf8').trim();
    } catch (error) {
      throw new CdciRpcError(
        `Could not read the CDCI cookie file at ${this.cookieFile}. Start centraldatabased first, or set CDCI_RPC_USER and CDCI_RPC_PASSWORD.`,
        { cause: error },
      );
    }
  }

  /**
   * Calls one RPC method.
   * @param {string} method
   * @param {unknown[]} [params]
   * @returns {Promise<any>}
   */
  async call(method, params = []) {
    const [result] = await this.batch([{ method, params }]);
    return result;
  }

  /**
   * Calls several RPC methods in one HTTP round trip, the way the daemon's own
   * batching works. Rejects if any member of the batch failed.
   * @param {{ method: string, params?: unknown[] }[]} calls
   * @returns {Promise<any[]>}
   */
  async batch(calls) {
    if (calls.length === 0) return [];

    const payload = calls.map((call) => ({
      jsonrpc: '1.0',
      id: (this.requestId += 1),
      method: call.method,
      params: call.params ?? [],
    }));

    const headers = { 'content-type': 'application/json' };
    const credentials = this.#credentials();
    if (credentials) headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;

    let response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload.length === 1 ? payload[0] : payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'is unreachable';
      throw new CdciRpcError(`The CDCI node at ${this.url} ${reason}.`, {
        method: calls[0].method,
        cause: error,
      });
    }

    if (response.status === 401) {
      throw new CdciRpcError(
        `The CDCI node at ${this.url} rejected the RPC credentials. Check CDCI_RPC_USER / CDCI_RPC_PASSWORD or the cookie file path.`,
        { method: calls[0].method },
      );
    }

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new CdciRpcError(`The CDCI node returned a non-JSON response (HTTP ${response.status}).`, {
        method: calls[0].method,
        cause: error,
      });
    }

    const entries = Array.isArray(body) ? body : [body];
    // The daemon answers a batch in request order, but sort by id so a node that
    // reorders cannot silently mismatch a result with the wrong call.
    if (entries.length > 1) entries.sort((a, b) => Number(a?.id ?? 0) - Number(b?.id ?? 0));

    return entries.map((entry, index) => {
      if (entry?.error) {
        throw new CdciRpcError(`CDCI RPC ${payload[index]?.method ?? 'call'} failed: ${entry.error.message}`, {
          code: entry.error.code,
          method: payload[index]?.method,
        });
      }
      return entry?.result;
    });
  }

  /**
   * Calls one method, returning `null` for the "not found" RPC error codes
   * instead of throwing. Used for lookups where absence is a normal answer.
   * @param {string} method
   * @param {unknown[]} params
   * @param {number[]} [absentCodes] defaults to invalid address/key (-5) and invalid parameter (-8)
   */
  async callAllowingAbsent(method, params, absentCodes = [-5, -8]) {
    try {
      return await this.call(method, params);
    } catch (error) {
      if (error instanceof CdciRpcError && absentCodes.includes(Number(error.code))) return null;
      throw error;
    }
  }
}

/**
 * Builds the RPC URL for a network when one is not configured explicitly.
 * @param {string} network
 * @param {string} [host]
 */
export function defaultRpcUrl(network, host = '127.0.0.1') {
  const port = CDCI_RPC_PORTS[network] ?? CDCI_RPC_PORTS.main;
  return `http://${host}:${port}/`;
}
