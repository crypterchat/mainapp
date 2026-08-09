import { CDCI_GENESIS_HASH, CdciRpc, CdciRpcError } from './cdci-rpc.js';
import { anchorPayloadHex, findAnchorOutput } from './commitment.js';

/** RPC error code the daemon returns for an unknown transaction or block. */
const RPC_INVALID_ADDRESS_OR_KEY = -5;

/**
 * The CDCI X11 blockchain, as seen by ChatScan.
 *
 * ChatScan is an explorer, so it reads consensus data rather than recomputing
 * it: block hashes and proof of work come from `centraldatabased`, which runs
 * the real X11 rounds in C. ChatScan's own job is to bind each encrypted
 * message record to a CDCI transaction and report its confirmations.
 */
export class CdciChain {
  /**
   * @param {object} options
   * @param {CdciRpc} options.rpc
   * @param {string} [options.network]
   * @param {number} [options.confirmationsForFinality]
   */
  constructor({ rpc, network = 'main', confirmationsForFinality = 6 }) {
    this.rpc = rpc;
    this.network = network;
    this.confirmationsForFinality = confirmationsForFinality;
  }

  /**
   * Normalised view of the node's chain state. Never throws: an unreachable
   * node is reported rather than failing the page, so the explorer stays up
   * while the daemon restarts.
   * @returns {Promise<object>}
   */
  async info() {
    try {
      const [chainInfo, networkInfo, mempoolInfo] = await this.rpc.batch([
        { method: 'getblockchaininfo' },
        { method: 'getnetworkinfo' },
        { method: 'getmempoolinfo' },
      ]);

      const [chainlock, tipHeader] = await Promise.all([
        this.#bestChainLock(),
        this.#tipHeader(chainInfo?.bestblockhash),
      ]);
      const expectedGenesis = CDCI_GENESIS_HASH[this.network];

      return {
        backend: 'cdci',
        reachable: true,
        error: null,
        chain: chainInfo?.chain ?? this.network,
        algorithm: 'x11',
        blocks: chainInfo?.blocks ?? null,
        headers: chainInfo?.headers ?? null,
        bestBlockHash: chainInfo?.bestblockhash ?? null,
        tipTime: tipHeader?.time ? tipHeader.time * 1000 : null,
        difficulty: chainInfo?.difficulty ?? null,
        chainwork: chainInfo?.chainwork ?? null,
        medianTime: chainInfo?.mediantime ?? null,
        verificationProgress: chainInfo?.verificationprogress ?? null,
        initialBlockDownload: chainInfo?.initialblockdownload ?? null,
        syncing: isSyncing(chainInfo),
        mempool: { size: mempoolInfo?.size ?? 0, bytes: mempoolInfo?.bytes ?? 0 },
        peers: networkInfo?.connections ?? null,
        subversion: networkInfo?.subversion ?? null,
        protocolVersion: networkInfo?.protocolversion ?? null,
        chainlock,
        genesisMatches: expectedGenesis ? chainInfo?.bestblockhash !== undefined : null,
      };
    } catch (error) {
      const message = error instanceof CdciRpcError ? error.message : String(error);
      return {
        backend: 'cdci',
        reachable: false,
        error: message,
        chain: this.network,
        algorithm: 'x11',
        blocks: null,
        headers: null,
        bestBlockHash: null,
        tipTime: null,
        difficulty: null,
        chainwork: null,
        medianTime: null,
        verificationProgress: null,
        initialBlockDownload: null,
        syncing: null,
        mempool: { size: 0, bytes: 0 },
        peers: null,
        subversion: null,
        protocolVersion: null,
        chainlock: null,
        genesisMatches: null,
      };
    }
  }

  /** ChainLocks give CDCI blocks finality ahead of the confirmation count. */
  async #bestChainLock() {
    try {
      const lock = await this.rpc.call('getbestchainlock');
      return lock ? { height: lock.height ?? null, hash: lock.blockhash ?? null } : null;
    } catch (error) {
      // Older or LLMQ-less nodes simply do not offer the method.
      if (error instanceof CdciRpcError) return null;
      throw error;
    }
  }

  /**
   * The tip's header, for reporting how long ago CDCI last found a block.
   * @param {string | undefined} bestBlockHash
   */
  async #tipHeader(bestBlockHash) {
    if (!bestBlockHash) return null;
    try {
      return await this.rpc.call('getblockheader', [bestBlockHash]);
    } catch (error) {
      if (error instanceof CdciRpcError) return null;
      throw error;
    }
  }

  /**
   * The node's genesis hash, for confirming it is on the chain we expect.
   * @returns {Promise<string | null>}
   */
  async genesisHash() {
    const hash = await this.rpc.callAllowingAbsent('getblockhash', [0]);
    return hash ?? null;
  }

  /**
   * Newest-first window of CDCI blocks.
   * @param {{ limit?: number, offset?: number }} [query]
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async listBlocks({ limit = 10, offset = 0 } = {}) {
    const tip = await this.rpc.call('getblockcount');
    const total = Number(tip) + 1;

    const heights = [];
    for (let height = Number(tip) - offset; height >= 0 && heights.length < limit; height -= 1) {
      heights.push(height);
    }
    if (heights.length === 0) return { items: [], total };

    const hashes = await this.rpc.batch(heights.map((height) => ({ method: 'getblockhash', params: [height] })));
    const blocks = await this.rpc.batch(hashes.map((hash) => ({ method: 'getblock', params: [hash] })));

    return { items: blocks.map((block) => normalizeBlock(block)), total };
  }

  /**
   * One block, by height or hash.
   * @param {number | string} heightOrHash
   * @returns {Promise<object | null>}
   */
  async getBlock(heightOrHash) {
    let hash = heightOrHash;
    if (typeof heightOrHash === 'number' || /^\d{1,10}$/.test(String(heightOrHash))) {
      hash = await this.rpc.callAllowingAbsent('getblockhash', [Number(heightOrHash)]);
      if (!hash) return null;
    }
    const block = await this.rpc.callAllowingAbsent('getblock', [hash]);
    return block ? normalizeBlock(block) : null;
  }

  /**
   * Checks that `txid` is a CDCI transaction carrying this record's anchor
   * commitment, and reports how settled it is.
   *
   * `found: false` also covers a node without `-txindex=1` that has pruned the
   * transaction from its view, which is why the daemon needs that flag.
   *
   * @param {string} commitment the 32-byte commitment the anchor must carry
   * @param {string} txid
   * @returns {Promise<{ found: boolean, matched: boolean, txid: string, outputIndex: number | null, blockHash: string | null, blockHeight: number | null, confirmations: number, chainlock: boolean, finality: string, time: number | null }>}
   */
  async verifyAnchor(commitment, txid) {
    let transaction;
    try {
      transaction = await this.rpc.call('getrawtransaction', [txid, 1]);
    } catch (error) {
      if (error instanceof CdciRpcError && Number(error.code) === RPC_INVALID_ADDRESS_OR_KEY) {
        return absentAnchor(txid);
      }
      throw error;
    }
    if (!transaction) return absentAnchor(txid);

    const output = findAnchorOutput(transaction, commitment);
    const confirmations = Number(transaction.confirmations ?? 0);
    const chainlock = Boolean(transaction.chainlock);

    return {
      found: true,
      matched: output !== null,
      txid: transaction.txid ?? txid,
      outputIndex: output ? output.n : null,
      blockHash: transaction.blockhash ?? null,
      blockHeight: typeof transaction.height === 'number' && transaction.height >= 0 ? transaction.height : null,
      confirmations,
      chainlock,
      finality: this.finalityOf({ confirmations, chainlock }),
      time: transaction.time ? transaction.time * 1000 : null,
    };
  }

  /**
   * How settled an anchor is: in the mempool, confirmed in a block, or final
   * because a ChainLock or enough confirmations cover it.
   * @param {{ confirmations: number, chainlock: boolean }} anchor
   */
  finalityOf({ confirmations, chainlock }) {
    if (chainlock) return 'chainlocked';
    if (confirmations >= this.confirmationsForFinality) return 'final';
    if (confirmations >= 1) return 'confirmed';
    return 'mempool';
  }

  /**
   * Publishes an anchor from the node's own wallet. Off by default: it spends
   * coins, so it is only used when CDCI_ANCHOR_MODE=wallet.
   * @param {string} commitment
   * @returns {Promise<{ txid: string, fee: number | null }>}
   */
  async publishAnchor(commitment) {
    const unfunded = await this.rpc.call('createrawtransaction', [[], { data: anchorPayloadHex(commitment) }]);
    const funded = await this.rpc.call('fundrawtransaction', [unfunded]);
    const signed = await this.rpc.call('signrawtransactionwithwallet', [funded.hex]);
    if (!signed?.complete) {
      throw new CdciRpcError('The CDCI wallet could not fully sign the anchor transaction.', {
        method: 'signrawtransactionwithwallet',
      });
    }
    const txid = await this.rpc.call('sendrawtransaction', [signed.hex]);
    return { txid, fee: funded.fee ?? null };
  }
}

/** @param {string} txid */
function absentAnchor(txid) {
  return {
    found: false,
    matched: false,
    txid,
    outputIndex: null,
    blockHash: null,
    blockHeight: null,
    confirmations: 0,
    chainlock: false,
    finality: 'unknown',
    time: null,
  };
}

/** @param {any} chainInfo */
function isSyncing(chainInfo) {
  if (chainInfo?.initialblockdownload !== undefined) return Boolean(chainInfo.initialblockdownload);
  if (typeof chainInfo?.blocks === 'number' && typeof chainInfo?.headers === 'number') {
    return chainInfo.blocks < chainInfo.headers;
  }
  return null;
}

/**
 * Maps a CDCI `getblock` result onto the shape the explorer renders.
 * @param {any} block
 */
export function normalizeBlock(block) {
  return {
    source: 'cdci',
    height: block.height,
    hash: block.hash,
    previousHash: block.previousblockhash ?? '0'.repeat(64),
    nextHash: block.nextblockhash ?? null,
    merkleRoot: block.merkleroot,
    timestamp: (block.time ?? 0) * 1000,
    algorithm: 'x11',
    difficulty: block.difficulty ?? null,
    chainwork: block.chainwork ?? null,
    nonce: block.nonce ?? 0,
    bits: block.bits ?? null,
    version: block.version ?? null,
    txCount: Array.isArray(block.tx) ? block.tx.length : (block.nTx ?? 0),
    sizeBytes: block.size ?? 0,
    confirmations: block.confirmations ?? null,
    chainlock: Boolean(block.chainlock),
    transactionIds: Array.isArray(block.tx) ? block.tx : [],
  };
}
