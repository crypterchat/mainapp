import { EventEmitter } from 'node:events';

import { RECORD_STATUS, formatRef } from '../core/records.js';
import { ChainLog } from './chain-log.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TPS_WINDOW_MS = 60 * 1000;

/**
 * In-memory index of the ChatScan chain, durable through an append-only log.
 *
 * The index holds ciphertext metadata only - there is no field anywhere in this
 * class that could hold message content.
 */
export class ChatScanStore extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.chainLogPath
   * @param {boolean} [options.persist]
   */
  constructor({ chainLogPath, persist = true }) {
    super();
    this.log = new ChainLog({ filePath: chainLogPath, enabled: persist });

    /** @type {import('../core/records.js').createRecord extends (...a:any)=>infer R ? R[] : never} */
    this.records = [];
    /** @type {Map<string, object>} keyed by `${hash}/${id}` */
    this.recordsByRef = new Map();
    /** @type {Map<number, object>} keyed by ID-number */
    this.recordsById = new Map();
    /** @type {Map<string, object>} keyed by `${ciphertextHash}:${nonce}` */
    this.recordsByCiphertext = new Map();
    /** @type {object[]} */
    this.blocks = [];
    /** @type {Map<string, object>} */
    this.blocksByHash = new Map();
    this.nextRecordId = 1;
  }

  /** Rebuilds state from the append-only log. */
  replay() {
    for (const event of this.log.read()) {
      if (event.t === 'record') this.#indexRecord(event.record);
      else if (event.t === 'block') this.#indexBlock(event.block);
      else if (event.t === 'record-update') this.#applyUpdate(event.record);
    }
    return this;
  }

  /**
   * Replaces an indexed record with a newer snapshot of itself, which is how an
   * anchor gaining confirmations is replayed.
   * @param {object} snapshot
   */
  #applyUpdate(snapshot) {
    const existing = this.recordsByRef.get(snapshot.ref);
    if (!existing) {
      this.#indexRecord(snapshot);
      return;
    }
    Object.assign(existing, snapshot);
  }

  /** @param {object} record */
  #indexRecord(record) {
    this.records.push(record);
    this.recordsByRef.set(record.ref, record);
    this.recordsById.set(record.id, record);
    // Rejected records are deliberately left out of the replay index: a client
    // that fixes a policy violation must be able to resubmit the same ciphertext.
    if (record.status !== RECORD_STATUS.rejected) {
      this.recordsByCiphertext.set(ciphertextKey(record.ciphertextHash, record.nonce), record);
    }
    if (record.id >= this.nextRecordId) this.nextRecordId = record.id + 1;
  }

  /** @param {object} block */
  #indexBlock(block) {
    this.blocks.push(block);
    this.blocksByHash.set(block.hash, block);
    for (const [index, ref] of block.recordRefs.entries()) {
      const record = this.recordsByRef.get(ref);
      if (!record) continue;
      record.status = RECORD_STATUS.confirmed;
      record.confirmedAt = block.timestamp;
      record.blockHeight = block.height;
      record.blockHash = block.hash;
      record.indexInBlock = index;
    }
  }

  /** @returns {number} the ID-number the next record will receive */
  peekNextRecordId() {
    return this.nextRecordId;
  }

  /**
   * Claims the next ID-number. Reserving before the record is built lets the
   * node compute the record's reference - and therefore its anchor commitment -
   * before it decides whether to admit it.
   * @returns {number}
   */
  reserveRecordId() {
    const id = this.nextRecordId;
    this.nextRecordId = id + 1;
    return id;
  }

  /**
   * Appends a record and emits it to live subscribers.
   * @param {object} record
   */
  addRecord(record) {
    this.#indexRecord(record);
    this.log.append({ t: 'record', record });
    this.emit('record', record);
    return record;
  }

  /**
   * Persists a record that was mutated in place - an anchor gaining
   * confirmations, or a record being rejected after a chain check.
   * @param {object} record
   */
  updateRecord(record) {
    const key = ciphertextKey(record.ciphertextHash, record.nonce);
    if (record.status === RECORD_STATUS.rejected) this.recordsByCiphertext.delete(key);
    else this.recordsByCiphertext.set(key, record);

    this.log.append({ t: 'record-update', record });
    this.emit('record', record);
    return record;
  }

  /**
   * Records whose anchor is not yet final, oldest first. The anchor watcher
   * re-checks these against the chain.
   * @param {number} [limit]
   */
  unsettledAnchors(limit = 100) {
    const pending = [];
    for (const record of this.records) {
      if (record.status === RECORD_STATUS.rejected) continue;
      if (!record.anchor) continue;
      if (record.anchor.finality === 'chainlocked' || record.anchor.finality === 'final') continue;
      pending.push(record);
      if (pending.length >= limit) break;
    }
    return pending;
  }

  /**
   * Records anchored in one CDCI block.
   * @param {number} height
   */
  recordsAnchoredInBlock(height) {
    return this.records.filter((record) => record.anchor?.blockHeight === height);
  }

  /**
   * Appends a sealed block, confirming the records it contains.
   * @param {object} block
   */
  addBlock(block) {
    this.#indexBlock(block);
    this.log.append({ t: 'block', block });
    this.emit('block', block);
    return block;
  }

  /**
   * @param {string} ciphertextHash
   * @param {string} nonce
   * @returns {object | undefined}
   */
  findByCiphertext(ciphertextHash, nonce) {
    return this.recordsByCiphertext.get(ciphertextKey(ciphertextHash, nonce));
  }

  /**
   * @param {string} hash
   * @param {number} id
   * @returns {object | undefined}
   */
  getRecord(hash, id) {
    return this.recordsByRef.get(formatRef(hash, id));
  }

  /**
   * @param {string} hash
   * @returns {object[]} every record sharing a hash (one, in practice)
   */
  getRecordsByHash(hash) {
    return this.records.filter((record) => record.hash === hash);
  }

  /** @param {number} id */
  getRecordById(id) {
    return this.recordsById.get(id);
  }

  /**
   * Newest-first record listing.
   * @param {{ limit?: number, offset?: number, status?: string, protocol?: string, channelHash?: string }} [query]
   */
  listRecords({ limit = 25, offset = 0, status, protocol, channelHash } = {}) {
    let items = this.records;
    if (status) items = items.filter((record) => record.status === status);
    if (protocol) items = items.filter((record) => record.protocol === protocol);
    if (channelHash) items = items.filter((record) => record.channelHash === channelHash);
    const total = items.length;
    const page = items.slice().reverse().slice(offset, offset + limit);
    return { items: page, total };
  }

  /** Records awaiting confirmation, oldest first. @param {number} [limit] */
  mempool(limit = Number.POSITIVE_INFINITY) {
    const pending = [];
    for (const record of this.records) {
      if (record.status !== RECORD_STATUS.pending) continue;
      pending.push(record);
      if (pending.length >= limit) break;
    }
    return pending;
  }

  /** @param {{ limit?: number, offset?: number }} [query] */
  listBlocks({ limit = 10, offset = 0 } = {}) {
    const total = this.blocks.length;
    const page = this.blocks.slice().reverse().slice(offset, offset + limit);
    return { items: page, total };
  }

  /** @param {number} height */
  getBlockByHeight(height) {
    return this.blocks[height];
  }

  /** @param {string} hash */
  getBlockByHash(hash) {
    return this.blocksByHash.get(hash);
  }

  /** @returns {object | undefined} */
  tip() {
    return this.blocks.at(-1);
  }

  /**
   * Aggregate counters for the explorer header and API.
   * @param {number} [now]
   */
  stats(now = Date.now()) {
    let confirmed = 0;
    let pending = 0;
    let rejected = 0;
    let anchored = 0;
    let chainlocked = 0;
    let pendingBytes = 0;
    let totalBytes = 0;
    let last24hCount = 0;
    let last24hBytes = 0;
    let last24hFees = 0;
    let recentCount = 0;

    for (const record of this.records) {
      totalBytes += record.size;
      if (record.status === RECORD_STATUS.confirmed) confirmed += 1;
      else if (record.status === RECORD_STATUS.pending) {
        pending += 1;
        pendingBytes += record.size;
      } else if (record.status === RECORD_STATUS.rejected) rejected += 1;

      if (record.anchor && record.status !== RECORD_STATUS.rejected) {
        anchored += 1;
        if (record.anchor.chainlock) chainlocked += 1;
      }

      if (now - record.receivedAt <= DAY_MS) {
        last24hCount += 1;
        last24hBytes += record.size;
        last24hFees += record.fee;
      }
      if (now - record.receivedAt <= TPS_WINDOW_MS) recentCount += 1;
    }

    const tip = this.tip();
    return {
      records: this.records.length,
      confirmed,
      pending,
      rejected,
      anchored,
      chainlocked,
      pendingBytes,
      totalBytes,
      blocks: this.blocks.length,
      height: tip ? tip.height : null,
      tipHash: tip ? tip.hash : null,
      tipTimestamp: tip ? tip.timestamp : null,
      last24hCount,
      last24hBytes,
      last24hFees,
      tps: recentCount / (TPS_WINDOW_MS / 1000),
      averageSize: this.records.length > 0 ? Math.round(totalBytes / this.records.length) : 0,
    };
  }

  /** Flushes pending log writes. */
  flush() {
    return this.log.flush();
  }
}

/**
 * @param {string} ciphertextHash
 * @param {string} nonce
 */
function ciphertextKey(ciphertextHash, nonce) {
  return `${ciphertextHash}:${nonce ?? ''}`;
}
