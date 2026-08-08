import { applyAnchor } from '../core/records.js';

/**
 * Keeps anchored records in step with the CDCI chain.
 *
 * A record is admitted as soon as its anchor transaction is seen, which is
 * usually while the transaction is still in the mempool. This watcher re-asks
 * the node about every anchor that is not yet final, so confirmations, the block
 * it landed in, and its ChainLock status stay current.
 */
export class AnchorWatcher {
  /**
   * @param {object} options
   * @param {import('../store/store.js').ChatScanStore} options.store
   * @param {import('./cdci.js').CdciChain} options.chain
   * @param {number} [options.intervalMs]
   * @param {number} [options.batchSize]
   */
  constructor({ store, chain, intervalMs = 30_000, batchSize = 50 }) {
    this.store = store;
    this.chain = chain;
    this.intervalMs = intervalMs;
    this.batchSize = batchSize;
    /** @type {NodeJS.Timeout | null} */
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        process.emitWarning(`ChatScan anchor watcher failed: ${error.message}`);
      });
    }, this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this;
  }

  /**
   * Re-checks one batch of unsettled anchors.
   * @returns {Promise<{ checked: number, updated: number }>}
   */
  async tick() {
    if (this.running) return { checked: 0, updated: 0 };
    this.running = true;
    let checked = 0;
    let updated = 0;

    try {
      for (const record of this.store.unsettledAnchors(this.batchSize)) {
        checked += 1;
        let anchor;
        try {
          anchor = await this.chain.verifyAnchor(record.commitment, record.anchor.txid);
        } catch (error) {
          // Leave the record as it is; the next tick tries again.
          process.emitWarning(`ChatScan anchor re-check failed for ${record.ref}: ${error.message}`);
          continue;
        }

        if (!anchor.found || !anchor.matched) continue;
        if (
          anchor.confirmations === record.anchor.confirmations &&
          anchor.chainlock === record.anchor.chainlock &&
          anchor.finality === record.anchor.finality
        ) {
          continue;
        }

        applyAnchor(record, anchor);
        this.store.updateRecord(record);
        updated += 1;
      }
    } finally {
      this.running = false;
    }

    return { checked, updated };
  }
}
