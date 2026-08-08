import { ChatScanClient } from './client.js';
import { anchorInstructions } from './commitment.js';
import { channelHash, generateNonce, sealMessage } from './crypto.js';

/**
 * The high-level entry point for a chat app: one call per message.
 *
 * `send()` encrypts locally, derives the anchor commitment, publishes it on the
 * CDCI chain when a wallet is configured, and records the message on the
 * explorer - returning the reference and the URL you can show in the chat UI.
 *
 * The plaintext and the message key never leave this process.
 */
export class ChatSession {
  /**
   * @param {object} options
   * @param {ChatScanClient} options.client
   * @param {import('./cdci-wallet.js').CdciWallet} [options.wallet] required when the explorer requires anchors
   * @param {string} [options.appVersion] reported with each record
   * @param {number} [options.fee]
   */
  constructor({ client, wallet, appVersion, fee }) {
    this.client = client;
    this.wallet = wallet;
    this.appVersion = appVersion;
    this.fee = fee;
    /** @type {object | null} */
    this.status = null;
  }

  /**
   * Convenience constructor that also reads the explorer's status, so the
   * session knows the chain id to commit to and whether anchors are required.
   * @param {object} options
   * @param {string} options.baseUrl
   * @param {string} [options.ingestKey]
   * @param {import('./cdci-wallet.js').CdciWallet} [options.wallet]
   * @param {string} [options.appVersion]
   * @param {number} [options.fee]
   * @returns {Promise<ChatSession>}
   */
  static async connect({ baseUrl, ingestKey, wallet, appVersion, fee }) {
    const client = new ChatScanClient({ baseUrl, ingestKey });
    const session = new ChatSession({ client, wallet, appVersion, fee });
    await session.refresh();
    return session;
  }

  /** Re-reads the explorer's status. */
  async refresh() {
    this.status = await this.client.status();
    return this.status;
  }

  /** @returns {object} */
  #requireStatus() {
    if (!this.status) {
      throw new Error('Call refresh() (or use ChatSession.connect) before sending, so the chain id is known.');
    }
    return this.status;
  }

  /**
   * Encrypts, anchors and records one message.
   *
   * @param {string} plaintext
   * @param {object} [options]
   * @param {string} [options.conversation] a name hashed into an opaque channel id
   * @param {string} [options.channelHash] a channel id you derived yourself
   * @param {string} [options.protocol] defaults to `C7`
   * @param {string} [options.key] hex AES-256 key; generated when omitted
   * @param {string} [options.anchorTxid] an anchor you published yourself
   * @returns {Promise<{ ref: string, explorerUrl: string, status: string, rejectionReason: string | null, commitment: string, anchorTxid: string | null, anchorFee: number | null, key: string, envelope: Uint8Array, record: object }>}
   */
  async send(plaintext, options = {}) {
    const status = this.#requireStatus();
    const sealed = await sealMessage(plaintext, { key: options.key });

    const submission = {
      ciphertextHash: sealed.ciphertextHash,
      size: sealed.size,
      protocol: options.protocol ?? 'C7',
      channelHash: options.channelHash ?? (options.conversation ? await channelHash(options.conversation) : null),
      nonce: generateNonce(),
    };
    if (this.fee !== undefined) submission.fee = this.fee;
    if (this.appVersion) submission.appVersion = this.appVersion;

    const instructions = await anchorInstructions({ chainId: status.chainId, ...submission });

    let anchorTxid = options.anchorTxid ?? null;
    let anchorFee = null;
    if (!anchorTxid && this.wallet && status.backend === 'cdci') {
      const published = await this.wallet.publishAnchor(instructions.commitment);
      anchorTxid = published.txid;
      anchorFee = published.fee;
    }

    if (!anchorTxid && status.anchoring?.required) {
      throw new Error(
        'This explorer requires an on-chain anchor. Pass a CdciWallet to the session, or supply anchorTxid yourself.',
      );
    }

    const response = await this.client.submitRecord({
      ...submission,
      channelHash: submission.channelHash ?? undefined,
      ...(anchorTxid ? { anchorTxid } : {}),
    });

    return {
      ref: response.ref,
      explorerUrl: this.client.recordUrl(response.ref),
      status: response.status,
      rejectionReason: response.rejectionReason,
      commitment: instructions.commitment,
      anchorTxid,
      anchorFee,
      // Kept locally: the explorer never receives either of these.
      key: sealed.key,
      envelope: sealed.envelope,
      record: response.record,
    };
  }

  /**
   * The messages recorded for one conversation, newest first. Returns metadata
   * only - decrypt your own copy of the ciphertext with the key you kept.
   * @param {string} conversation
   * @param {{ limit?: number, offset?: number }} [query]
   */
  async history(conversation, query = {}) {
    const channel = await channelHash(conversation);
    return this.client.listRecords({ ...query, channel });
  }

  /**
   * Watches for new records, optionally filtered to one conversation.
   * @param {object} handlers
   * @param {(record: object) => void} handlers.onRecord
   * @param {string} [handlers.conversation]
   * @param {(error: unknown) => void} [handlers.onError]
   * @returns {Promise<{ close: () => void }>}
   */
  async watch({ onRecord, conversation, onError }) {
    const channel = conversation ? await channelHash(conversation) : null;
    return this.client.watch({
      onError,
      onRecord: (record) => {
        if (channel && record.channelHash !== channel) return;
        onRecord(record);
      },
    });
  }
}
