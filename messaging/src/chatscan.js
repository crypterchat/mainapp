import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sdkEntry = pathToFileURL(path.join(root, 'chatscan/sdk/src/index.js')).href;

const {
  ChatSession,
  ChatScanClient,
  openMessage,
  sealMessage,
  channelHash,
  digestCiphertext,
} = await import(sdkEntry);

/**
 * Thin bridge to the vendored ChatScan SDK / local X11 explorer.
 * Message content is never submitted to ChatScan — only digests and metadata.
 */
export class ChatScanBridge {
  /**
   * @param {{ baseUrl: string, ingestKey?: string, appVersion: string }} options
   */
  constructor({ baseUrl, ingestKey, appVersion }) {
    this.baseUrl = baseUrl;
    this.ingestKey = ingestKey;
    this.appVersion = appVersion;
    /** @type {ChatSession | null} */
    this.session = null;
  }

  async connect() {
    this.session = await ChatSession.connect({
      baseUrl: this.baseUrl,
      ingestKey: this.ingestKey || undefined,
      appVersion: this.appVersion,
    });
    return this.session.status;
  }

  async status() {
    if (!this.session) await this.connect();
    return this.session.refresh();
  }

  async conversationChannel(conversationId) {
    return channelHash(conversationId);
  }

  /**
   * Encrypt locally (process-local), record hash on ChatScan, return envelope+key
   * for private delivery. ChatScan never receives plaintext, envelope, or key.
   */
  async sendEncrypted(plaintext, conversationId) {
    if (!this.session) await this.connect();
    const sent = await this.session.send(plaintext, { conversation: conversationId });
    const record = sent.record ?? (await this.session.client.getRecord(sent.ref));
    return {
      ref: sent.ref,
      explorerUrl: sent.explorerUrl,
      status: sent.status,
      rejectionReason: sent.rejectionReason,
      commitment: sent.commitment ?? record.commitment,
      anchorTxid: sent.anchorTxid,
      keyHex: sent.key,
      envelopeHex: Buffer.from(sent.envelope).toString('hex'),
      ciphertextHash: record.ciphertextHash,
      size: record.size ?? sent.envelope.byteLength,
      protocol: record.protocol ?? 'C7',
      nonce: null,
      channelHash: record.channelHash,
      record,
    };
  }

  /**
   * Accept a client-sealed envelope and submit only the digest to ChatScan.
   */
  async recordSealed({
    ciphertextHash,
    size,
    protocol = 'C7',
    conversationId,
    nonce,
    channelHash: givenChannel,
  }) {
    if (!this.session) await this.connect();
    const ch = givenChannel || (await channelHash(conversationId));
    const response = await this.session.client.submitRecord({
      ciphertextHash,
      size,
      protocol,
      channelHash: ch,
      nonce,
      appVersion: this.appVersion,
    });
    return {
      ...response,
      explorerUrl: this.session.client.recordUrl(response.ref),
      channelHash: ch,
    };
  }

  async history(conversationId, { limit = 50 } = {}) {
    if (!this.session) await this.connect();
    return this.session.history(conversationId, { limit });
  }

  async getRecord(ref) {
    if (!this.session) await this.connect();
    return this.session.client.getRecord(ref);
  }

  async openLocal(envelopeHex, keyHex) {
    return openMessage(Buffer.from(envelopeHex, 'hex'), keyHex);
  }

  async sealLocal(plaintext) {
    return sealMessage(plaintext);
  }

  /**
   * Hash an already-encrypted payload (e.g. OpenPGP armor) and record on ChatScan.
   */
  async recordCiphertext(envelopeBytes, { conversationId, protocol, nonce }) {
    const { ciphertextHash, size } = await digestCiphertext(envelopeBytes);
    const sealed = await this.recordSealed({
      ciphertextHash,
      size,
      protocol,
      conversationId,
      nonce,
    });
    return { ciphertextHash, size, ...sealed };
  }
}

export { ChatScanClient, openMessage, sealMessage, channelHash, digestCiphertext };
