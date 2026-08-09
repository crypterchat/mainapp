import http from 'node:http';

import { anchorScriptHex } from '../../src/chain/commitment.js';

/**
 * A stand-in for `centraldatabased`'s JSON-RPC interface.
 *
 * Responses copy the field names and shapes of the real daemon (Dash-derived,
 * see src/rpc/blockchain.cpp and src/rpc/rawtransaction.cpp in Centraldb/CDCI)
 * so the client and adapter are exercised against realistic payloads.
 */
export class CdciStub {
  /**
   * @param {object} [options]
   * @param {string} [options.chain]
   * @param {number} [options.tipHeight]
   * @param {{ user: string, password: string }} [options.auth]
   */
  constructor({ chain = 'main', tipHeight = 3, auth, headers, initialBlockDownload = false } = {}) {
    this.chain = chain;
    this.tipHeight = tipHeight;
    this.auth = auth;
    /** Headers ahead of blocks is how the daemon reports a sync in progress. */
    this.headers = headers ?? tipHeight;
    this.initialBlockDownload = initialBlockDownload;
    /** @type {Map<string, object>} */
    this.transactions = new Map();
    /** @type {{ height: number, blockhash: string } | null} */
    this.chainLock = { height: tipHeight - 1, blockhash: blockHash(tipHeight - 1) };
    /** @type {{ method: string, params: unknown[] }[]} */
    this.calls = [];
    /** @type {Map<string, { code: number, message: string }>} */
    this.errors = new Map();
    this.mempool = { size: 4, bytes: 1200 };
    /** @type {http.Server | null} */
    this.server = null;
    this.url = '';
  }

  /** Starts the stub on an ephemeral port. */
  async start() {
    this.server = http.createServer((req, res) => this.#handle(req, res));
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = /** @type {import('node:net').AddressInfo} */ (this.server.address());
    this.url = `http://127.0.0.1:${port}/`;
    return this;
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  /**
   * Registers a transaction that carries an anchor commitment.
   * @param {object} args
   * @param {string} args.txid
   * @param {string} args.commitment the commitment published in the OP_RETURN
   * @param {number} [args.confirmations]
   * @param {number | null} [args.height]
   * @param {boolean} [args.chainlock]
   */
  addAnchor({ txid, commitment, confirmations = 1, height = 2, chainlock = false }) {
    this.transactions.set(txid, {
      txid,
      confirmations,
      height: confirmations > 0 ? height : -1,
      blockhash: confirmations > 0 ? blockHash(height) : undefined,
      chainlock,
      time: 1_700_000_000,
      vout: [
        { n: 0, value: 0, scriptPubKey: { hex: '76a914' + '11'.repeat(20) + '88ac', type: 'pubkeyhash' } },
        { n: 1, value: 0, scriptPubKey: { hex: anchorScriptHex(commitment), type: 'nulldata' } },
      ],
    });
    return this;
  }

  /**
   * Registers a transaction whose `OP_RETURN` commits to something else.
   * @param {string} txid
   * @param {string} otherCommitment
   */
  addMismatchedAnchor(txid, otherCommitment) {
    this.addAnchor({ txid, commitment: otherCommitment, confirmations: 3 });
    return this;
  }

  /**
   * Makes one RPC method fail, the way the daemon reports errors.
   * @param {string} method
   * @param {{ code: number, message: string }} error
   */
  failMethod(method, error) {
    this.errors.set(method, error);
    return this;
  }

  /** @param {string} method */
  callsTo(method) {
    return this.calls.filter((call) => call.method === method);
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  #handle(req, res) {
    if (this.auth) {
      const header = String(req.headers.authorization ?? '');
      const expected = `Basic ${Buffer.from(`${this.auth.user}:${this.auth.password}`).toString('base64')}`;
      if (header !== expected) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('401 Unauthorized\n');
        return;
      }
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Parse error\n');
        return;
      }

      const single = !Array.isArray(payload);
      const requests = single ? [payload] : payload;
      const responses = requests.map((request) => {
        this.calls.push({ method: request.method, params: request.params ?? [] });
        const failure = this.errors.get(request.method);
        if (failure) return { result: null, error: failure, id: request.id };
        try {
          return { result: this.#dispatch(request.method, request.params ?? []), error: null, id: request.id };
        } catch (error) {
          return {
            result: null,
            error: { code: error.rpcCode ?? -1, message: error.message },
            id: request.id,
          };
        }
      });

      const body = JSON.stringify(single ? responses[0] : responses);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  }

  /**
   * @param {string} method
   * @param {any[]} params
   */
  #dispatch(method, params) {
    switch (method) {
      case 'getblockchaininfo':
        return {
          chain: this.chain,
          blocks: this.tipHeight,
          headers: this.headers,
          bestblockhash: blockHash(this.tipHeight),
          difficulty: 1234.5678,
          mediantime: 1_700_000_000,
          verificationprogress: 0.9999,
          initialblockdownload: this.initialBlockDownload,
          chainwork: '00000000000000000000000000000000000000000000000000000000000f4240',
          size_on_disk: 123456,
        };
      case 'getnetworkinfo':
        return {
          version: 1000000,
          subversion: '/CentralDataBase Core:1.0.0/',
          protocolversion: 70219,
          connections: 8,
        };
      case 'getmempoolinfo':
        return { size: this.mempool.size, bytes: this.mempool.bytes, usage: this.mempool.bytes * 2 };
      case 'getbestchainlock':
        if (!this.chainLock) throw rpcError(-32603, 'Unable to find any chainlock', -32603);
        return { blockhash: this.chainLock.blockhash, height: this.chainLock.height, signature: 'ab'.repeat(48) };
      case 'getblockcount':
        return this.tipHeight;
      case 'getblockhash': {
        const height = Number(params[0]);
        if (!Number.isInteger(height) || height < 0 || height > this.tipHeight) {
          throw rpcError(-8, 'Block height out of range');
        }
        return blockHash(height);
      }
      case 'getblockheader': {
        const height = heightOf(params[0]);
        if (height === null) throw rpcError(-5, 'Block not found');
        return { hash: params[0], height, time: 1_700_000_000 + height * 150 };
      }
      case 'getblock': {
        const height = heightOf(params[0]);
        if (height === null) throw rpcError(-5, 'Block not found');
        return {
          hash: blockHash(height),
          confirmations: this.tipHeight - height + 1,
          size: 2048,
          height,
          version: 536870912,
          merkleroot: 'cc'.repeat(32),
          tx: [`${'ab'.repeat(31)}${height.toString(16).padStart(2, '0')}`],
          time: 1_700_000_000 + height * 150,
          mediantime: 1_700_000_000,
          nonce: 42 + height,
          bits: '1e0ffff0',
          difficulty: 1234.5678,
          chainwork: '00000000000000000000000000000000000000000000000000000000000f4240',
          previousblockhash: height > 0 ? blockHash(height - 1) : undefined,
          nextblockhash: height < this.tipHeight ? blockHash(height + 1) : undefined,
          chainlock: this.chainLock ? height <= this.chainLock.height : false,
        };
      }
      case 'getrawtransaction': {
        const transaction = this.transactions.get(String(params[0]));
        if (!transaction) {
          throw rpcError(
            -5,
            'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.',
          );
        }
        return transaction;
      }
      case 'createrawtransaction':
        return `0100000000010000000000000000${String(params[1]?.data ?? '')}00000000`;
      case 'fundrawtransaction':
        return { hex: `${params[0]}ff`, fee: 0.0001, changepos: 1 };
      case 'signrawtransactionwithwallet':
        return { hex: `${params[0]}aa`, complete: true };
      case 'sendrawtransaction':
        return 'ff'.repeat(32);
      default:
        throw rpcError(-32601, `Method not found: ${method}`);
    }
  }
}

/**
 * Deterministic block hash for a height, so tests can assert on it.
 * @param {number} height
 */
export function blockHash(height) {
  return `0000${height.toString(16).padStart(4, '0')}${'ab'.repeat(28)}`;
}

/**
 * @param {string} hash
 * @returns {number | null}
 */
function heightOf(hash) {
  const match = /^0000([0-9a-f]{4})(ab)+$/.exec(String(hash));
  return match ? Number.parseInt(match[1], 16) : null;
}

/**
 * @param {number} code
 * @param {string} message
 */
function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}
