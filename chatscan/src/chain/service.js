import { ChatScanNode } from '../core/chain.js';
import { AnchorWatcher } from './anchor-watcher.js';
import { CdciChain } from './cdci.js';
import { CdciRpc, CdciRpcError } from './cdci-rpc.js';

/** How long a CDCI chain snapshot is reused before the node is asked again. */
const CHAIN_INFO_TTL_MS = 2000;

/**
 * The chain the explorer indexes against, behind one interface.
 *
 * Two backends exist:
 *
 * - `cdci`  - the CDCI X11 blockchain (github.com/Centraldb/CDCI). Blocks are
 *   read from `centraldatabased`, and each message record is bound to a CDCI
 *   transaction carrying its `OP_RETURN` commitment.
 * - `local` - a self-contained development chain with its own sealer, so the
 *   explorer can be run and tested without a CDCI node.
 *
 * Pages and the API only ever talk to this service, so both backends render
 * through exactly the same views.
 */
export class ChainService {
  /**
   * @param {object} options
   * @param {import('../store/store.js').ChatScanStore} options.store
   * @param {import('../config.js').Config} options.config
   * @param {CdciChain} [options.cdci] injected in tests
   */
  constructor({ store, config, cdci }) {
    this.store = store;
    this.config = config;
    this.mode = config.backend;
    /** @type {{ at: number, info: object } | null} */
    this.cache = null;
    /** @type {Promise<object> | null} */
    this.inFlight = null;

    if (this.mode === 'cdci') {
      this.cdci =
        cdci ??
        new CdciChain({
          rpc: new CdciRpc({
            url: config.cdci.rpcUrl,
            user: config.cdci.rpcUser || undefined,
            password: config.cdci.rpcPassword || undefined,
            cookieFile: config.cdci.rpcCookieFile || undefined,
            timeoutMs: config.cdci.rpcTimeoutMs,
          }),
          network: config.cdci.network,
          confirmationsForFinality: config.cdci.confirmationsForFinality,
        });

      this.node = new ChatScanNode({
        store,
        config,
        verifyAnchor: (commitment, txid) => this.cdci.verifyAnchor(commitment, txid),
        requireAnchor: config.cdci.requireAnchor && config.cdci.anchorMode === 'client',
      });

      this.watcher = new AnchorWatcher({
        store,
        chain: this.cdci,
        intervalMs: config.cdci.anchorPollMs,
      });
    } else {
      this.cdci = null;
      this.watcher = null;
      this.node = new ChatScanNode({ store, config });
      this.node.ensureGenesis();
    }
  }

  /** Starts whatever the backend needs running in the background. */
  start() {
    if (this.mode === 'cdci') this.watcher?.start();
    else this.node.start();
    return this;
  }

  stop() {
    this.watcher?.stop();
    this.node.stop();
    return this;
  }

  /**
   * Admits one message record.
   * @param {unknown} body
   */
  submit(body) {
    return this.node.submit(body);
  }

  /**
   * In wallet mode ChatScan publishes the anchor itself.
   * @param {string} commitment
   */
  publishAnchor(commitment) {
    if (this.mode !== 'cdci') throw new Error('Anchors are only published in cdci mode.');
    return this.cdci.publishAnchor(commitment);
  }

  /**
   * Chain state for the explorer header, normalised across backends.
   *
   * Cached briefly: a dashboard render plus the event stream would otherwise ask
   * the node for the same figures several times a second.
   * @param {{ now?: number }} [options]
   * @returns {Promise<object>}
   */
  async chainInfo({ now = Date.now() } = {}) {
    if (this.mode === 'cdci') {
      if (this.cache && now - this.cache.at < CHAIN_INFO_TTL_MS) return this.cache.info;
      if (this.inFlight) return this.inFlight;

      this.inFlight = this.#freshChainInfo()
        .then((info) => {
          this.cache = { at: Date.now(), info };
          return info;
        })
        .finally(() => {
          this.inFlight = null;
        });
      return this.inFlight;
    }

    return this.#localChainInfo();
  }

  async #freshChainInfo() {
    const info = await this.cdci.info();
    return {
      ...info,
      anchorMode: this.config.cdci.anchorMode,
      confirmationsForFinality: this.config.cdci.confirmationsForFinality,
      rpcUrl: redactUrl(this.config.cdci.rpcUrl),
    };
  }

  #localChainInfo() {
    const tip = this.store.tip();
    return {
      backend: 'local',
      reachable: true,
      error: null,
      chain: this.config.cdci.network === 'main' ? 'local' : this.config.cdci.network,
      algorithm: 'x11-structured',
      blocks: tip ? tip.height : null,
      headers: tip ? tip.height : null,
      bestBlockHash: tip ? tip.hash : null,
      difficulty: this.config.difficultyNibbles,
      chainwork: null,
      medianTime: tip ? Math.round(tip.timestamp / 1000) : null,
      verificationProgress: 1,
      initialBlockDownload: false,
      syncing: false,
      mempool: { size: this.store.mempool().length, bytes: this.store.stats().pendingBytes },
      peers: null,
      subversion: null,
      protocolVersion: null,
      chainlock: null,
      genesisMatches: null,
      anchorMode: 'none',
      confirmationsForFinality: 1,
      rpcUrl: null,
    };
  }

  /**
   * Newest-first blocks, from the CDCI node or the local chain.
   *
   * `tolerant` is used by the pages: an unreachable node leaves the block list
   * empty rather than failing the render, since the status card already says the
   * node is offline. The API is not tolerant, so a client gets a 502 instead of
   * an empty list it might mistake for an empty chain.
   *
   * @param {{ limit?: number, offset?: number, tolerant?: boolean }} [query]
   * @returns {Promise<{ items: object[], total: number, offline?: boolean }>}
   */
  async listBlocks({ limit = 10, offset = 0, tolerant = false } = {}) {
    if (this.mode === 'cdci') {
      try {
        return await this.cdci.listBlocks({ limit, offset });
      } catch (error) {
        if (tolerant && error instanceof CdciRpcError) return { items: [], total: 0, offline: true };
        throw asHttpError(error);
      }
    }

    const { items, total } = this.store.listBlocks({ limit, offset });
    return { items: items.map((block) => this.#normalizeLocalBlock(block)), total };
  }

  /**
   * One block by height or hash, or null when it is not on the chain.
   * @param {string | number} heightOrHash
   * @param {{ tolerant?: boolean }} [options]
   * @returns {Promise<object | null>}
   */
  async getBlock(heightOrHash, { tolerant = false } = {}) {
    if (this.mode === 'cdci') {
      try {
        return await this.cdci.getBlock(heightOrHash);
      } catch (error) {
        if (tolerant && error instanceof CdciRpcError) return null;
        throw asHttpError(error);
      }
    }

    const value = String(heightOrHash).toLowerCase();
    const block = /^\d{1,15}$/.test(value)
      ? this.store.getBlockByHeight(Number.parseInt(value, 10))
      : this.store.getBlockByHash(value);
    return block ? this.#normalizeLocalBlock(block) : null;
  }

  /**
   * The message records carried by one block: anchored in it on CDCI, sealed
   * into it on the local chain.
   * @param {object} block
   */
  recordsInBlock(block) {
    if (this.mode === 'cdci') return this.store.recordsAnchoredInBlock(block.height);
    return block.recordRefs.map((ref) => this.store.recordsByRef.get(ref)).filter(Boolean);
  }

  /**
   * @param {object} block
   */
  #normalizeLocalBlock(block) {
    const tip = this.store.tip();
    return {
      source: 'local',
      height: block.height,
      hash: block.hash,
      previousHash: block.previousHash,
      nextHash: tip && block.height < tip.height ? (this.store.getBlockByHeight(block.height + 1)?.hash ?? null) : null,
      merkleRoot: block.merkleRoot,
      timestamp: block.timestamp,
      algorithm: block.algorithm,
      difficulty: block.difficulty,
      chainwork: null,
      nonce: block.nonce,
      bits: null,
      version: null,
      txCount: block.txCount,
      sizeBytes: block.sizeBytes,
      totalFees: block.totalFees,
      sealedBy: block.sealedBy,
      confirmations: tip ? tip.height - block.height + 1 : null,
      chainlock: false,
      transactionIds: [],
      recordRefs: block.recordRefs,
    };
  }
}

/**
 * A node failure is an upstream problem, so API callers see 502 rather than a
 * generic 500.
 * @param {unknown} error
 */
function asHttpError(error) {
  return error instanceof CdciRpcError ? error.toHttpError() : error;
}

/**
 * Keeps RPC credentials out of anything the explorer publishes.
 * @param {string} url
 */
function redactUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return null;
  }
}
