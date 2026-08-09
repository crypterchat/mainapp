import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import { CdciRpc } from '../../src/chain/cdci-rpc.js';
import { anchorCommitment, anchorPayloadHex } from '../../src/chain/commitment.js';

/**
 * Minimal stand-in for the CrypterChat client side of the flow.
 *
 * The plaintext is encrypted locally and only the ciphertext digest and its
 * length are ever handed to ChatScan. Neither the plaintext nor the ciphertext
 * leaves this process.
 *
 * @param {string} plaintext
 * @returns {{ ciphertextHash: string, size: number }}
 */
export function sealMessage(plaintext) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

  return {
    ciphertextHash: createHash('sha256').update(envelope).digest('hex'),
    size: envelope.length,
  };
}

/**
 * Derives an opaque channel identifier from a conversation name.
 * @param {string} conversation
 */
export function channelHash(conversation) {
  return createHash('sha256').update(`chatscan:channel:${conversation}`).digest('hex');
}

/**
 * Posts one message record to a ChatScan node.
 * @param {object} args
 * @param {string} args.baseUrl
 * @param {object} args.record
 * @param {string} [args.ingestKey]
 */
export async function submitRecord({ baseUrl, record, ingestKey }) {
  const response = await fetch(new URL('/api/v1/records', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(ingestKey ? { authorization: `Bearer ${ingestKey}` } : {}),
    },
    body: JSON.stringify(record),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`ChatScan rejected the record: ${message}`);
  }
  return payload;
}

/**
 * Publishes a record's anchor commitment on the CDCI chain and returns the
 * transaction id, which is what the explorer then verifies.
 *
 * This is the client half of `CDCI_ANCHOR_MODE=client`: the wallet that pays for
 * the anchor belongs to the client, not to ChatScan. It needs a CDCI node with a
 * funded, unlocked wallet.
 *
 * @param {object} args
 * @param {object} args.record the submission about to be sent to ChatScan
 * @param {string} args.chainId the explorer's chain id, from /api/v1/status
 * @param {{ url: string, user?: string, password?: string, cookieFile?: string }} args.rpc
 * @returns {Promise<{ txid: string, commitment: string }>}
 */
export async function publishAnchor({ record, chainId, rpc }) {
  const commitment = anchorCommitment({
    chainId,
    ciphertextHash: record.ciphertextHash,
    size: record.size,
    protocol: record.protocol ?? 'C7',
    channelHash: record.channelHash ?? null,
    nonce: record.nonce ?? '',
  });

  const client = new CdciRpc(rpc);
  const unfunded = await client.call('createrawtransaction', [[], { data: anchorPayloadHex(commitment) }]);
  const funded = await client.call('fundrawtransaction', [unfunded]);
  const signed = await client.call('signrawtransactionwithwallet', [funded.hex]);
  if (!signed?.complete) throw new Error('The CDCI wallet could not sign the anchor transaction.');
  const txid = await client.call('sendrawtransaction', [signed.hex]);

  return { txid, commitment };
}

/** Reads the shared CLI options for the demo scripts. */
export function scriptOptions(env = process.env) {
  return {
    baseUrl: env.CHATSCAN_URL ?? 'http://127.0.0.1:3000',
    ingestKey: env.CHATSCAN_INGEST_KEY,
    cdci: env.CDCI_RPC_URL
      ? {
          url: env.CDCI_RPC_URL,
          user: env.CDCI_RPC_USER || undefined,
          password: env.CDCI_RPC_PASSWORD || undefined,
          cookieFile: env.CDCI_RPC_COOKIE_FILE || undefined,
        }
      : null,
  };
}

/**
 * Reads the explorer's own view of its chain, so a client knows the chain id to
 * commit to and whether anchors are required.
 * @param {string} baseUrl
 */
export async function explorerStatus(baseUrl) {
  const response = await fetch(new URL('/api/v1/status', baseUrl));
  if (!response.ok) throw new Error(`ChatScan status failed: HTTP ${response.status}`);
  return response.json();
}
