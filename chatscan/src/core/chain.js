import { merkleRoot } from './merkle.js';
import {
  PROTOCOLS,
  RECORD_STATUS,
  applyAnchor,
  createRecord,
  normalizeSubmission,
} from './records.js';
import { X11_ALGORITHM_ID, meetsDifficulty, x11Object } from './x11.js';

export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

export const REJECTION_REASONS = Object.freeze({
  replay: 'replay-detected',
  protocolSize: 'protocol-size-exceeded',
  anchorMissing: 'anchor-missing',
  anchorNotFound: 'anchor-not-found',
  anchorMismatch: 'anchor-mismatch',
});

/**
 * The ChatScan node: admits message records to the mempool and seals them into
 * X11 blocks.
 */
export class ChatScanNode {
  /**
   * @param {object} options
   * @param {import('../store/store.js').ChatScanStore} options.store
   * @param {import('../config.js').Config} options.config
   * @param {((ref: string, txid: string) => Promise<object>) | null} [options.verifyAnchor]
   *   Set in cdci mode: resolves how a record's anchor transaction looks on the
   *   CDCI chain. Left null for the local development chain.
   * @param {boolean} [options.requireAnchor]
   */
  constructor({ store, config, verifyAnchor = null, requireAnchor = false }) {
    this.store = store;
    this.config = config;
    this.verifyAnchor = verifyAnchor;
    this.requireAnchor = requireAnchor;
    /** @type {NodeJS.Timeout | null} */
    this.timer = null;
  }

  /** Creates the genesis block if this node has no chain yet. */
  ensureGenesis(now = Date.now()) {
    if (this.store.blocks.length > 0) return this.store.blocks[0];

    const block = this.#sealHeader({
      height: 0,
      previousHash: GENESIS_PREVIOUS_HASH,
      recordRefs: [],
      records: [],
      timestamp: now,
    });
    return this.store.addBlock(block);
  }

  /** Starts the periodic sealer. */
  start() {
    this.ensureGenesis();
    if (!this.config.sealerEnabled || this.timer) return this;
    this.timer = setInterval(() => {
      try {
        this.sealBlock();
      } catch (error) {
        process.emitWarning(`ChatScan sealer failed: ${error.message}`);
      }
    }, this.config.blockIntervalMs);
    this.timer.unref?.();
    return this;
  }

  /** Stops the periodic sealer. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this;
  }

  /**
   * Admits one encrypted message record.
   *
   * Structurally invalid submissions throw and are never indexed. Submissions
   * that are well formed but violate chain policy are indexed with status
   * `rejected` so they stay auditable in the explorer.
   *
   * In cdci mode the record's anchor transaction is checked against the CDCI
   * chain before the record is indexed, so a record is only ever stored with
   * its verdict already attached.
   *
   * @param {unknown} body
   * @param {{ now?: number }} [options]
   * @returns {Promise<{ record: object, accepted: boolean }>}
   */
  async submit(body, { now = Date.now() } = {}) {
    const submission = normalizeSubmission(body, {
      maxCiphertextBytes: this.config.maxCiphertextBytes,
    });

    let rejectionReason = this.#policyRejection(submission);
    const record = createRecord({
      // Reserved up front: the ID-number is part of the reference, and the
      // reference is what the CDCI anchor commits to.
      id: this.store.reserveRecordId(),
      submission,
      chainId: this.config.chainId,
      receivedAt: now,
      status: rejectionReason ? RECORD_STATUS.rejected : RECORD_STATUS.pending,
      rejectionReason,
    });

    if (!rejectionReason && this.verifyAnchor) {
      rejectionReason = await this.#settleAnchor(record, now);
      if (rejectionReason) {
        record.status = RECORD_STATUS.rejected;
        record.rejectionReason = rejectionReason;
      }
    }

    this.store.addRecord(record);

    if (!rejectionReason && !this.verifyAnchor) {
      if (this.store.mempool(this.config.maxRecordsPerBlock).length >= this.config.maxRecordsPerBlock) {
        this.sealBlock({ now });
      }
    }

    return { record: this.store.getRecord(record.hash, record.id) ?? record, accepted: !rejectionReason };
  }

  /**
   * Checks a record's CDCI anchor and attaches what the chain says.
   * @param {object} record
   * @param {number} now
   * @returns {Promise<string | null>} a rejection reason, or null
   */
  async #settleAnchor(record, now) {
    if (!record.anchor?.txid) {
      return this.requireAnchor ? REJECTION_REASONS.anchorMissing : null;
    }

    let anchor;
    try {
      anchor = await this.verifyAnchor(record.commitment, record.anchor.txid);
    } catch (error) {
      // The node being unreachable is not the client's fault: keep the record
      // pending and let the anchor watcher settle it later.
      process.emitWarning(`ChatScan could not verify anchor ${record.anchor.txid}: ${error.message}`);
      return null;
    }

    if (!anchor.found) return REJECTION_REASONS.anchorNotFound;
    if (!anchor.matched) return REJECTION_REASONS.anchorMismatch;

    applyAnchor(record, anchor, now);
    return null;
  }

  /**
   * @param {ReturnType<typeof normalizeSubmission>} submission
   * @returns {string | null}
   */
  #policyRejection(submission) {
    if (this.store.findByCiphertext(submission.ciphertextHash, submission.nonce)) {
      return REJECTION_REASONS.replay;
    }
    const protocol = PROTOCOLS[submission.protocol];
    if (protocol && submission.size > protocol.maxCiphertextBytes) {
      return REJECTION_REASONS.protocolSize;
    }
    return null;
  }

  /**
   * Seals up to `maxRecordsPerBlock` pending records into the next block.
   * @param {{ now?: number, allowEmpty?: boolean }} [options]
   * @returns {object | null} the sealed block, or null when there was nothing to seal
   */
  sealBlock({ now = Date.now(), allowEmpty = false } = {}) {
    this.ensureGenesis(now);
    const records = this.store.mempool(this.config.maxRecordsPerBlock);
    if (records.length === 0 && !allowEmpty) return null;

    const previous = this.store.tip();
    const block = this.#sealHeader({
      height: previous.height + 1,
      previousHash: previous.hash,
      recordRefs: records.map((record) => record.ref),
      records,
      timestamp: Math.max(now, previous.timestamp + 1),
    });
    return this.store.addBlock(block);
  }

  /**
   * Builds a block header and searches for a nonce that meets the difficulty
   * target under X11.
   * @param {{ height: number, previousHash: string, recordRefs: string[], records: object[], timestamp: number }} args
   */
  #sealHeader({ height, previousHash, recordRefs, records, timestamp }) {
    const header = {
      chainId: this.config.chainId,
      network: this.config.networkName,
      height,
      previousHash,
      merkleRoot: merkleRoot(records.map((record) => record.hash)),
      timestamp,
      algorithm: X11_ALGORITHM_ID,
      difficulty: this.config.difficultyNibbles,
      txCount: recordRefs.length,
      sizeBytes: records.reduce((total, record) => total + record.size, 0),
      totalFees: Number(records.reduce((total, record) => total + record.fee, 0).toFixed(8)),
      sealedBy: this.config.sealedBy,
    };

    let nonce = 0;
    let hash = x11Object({ ...header, nonce });
    while (!meetsDifficulty(hash, this.config.difficultyNibbles)) {
      nonce += 1;
      hash = x11Object({ ...header, nonce });
    }

    return { ...header, nonce, hash, recordRefs };
  }
}
