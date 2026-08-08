import { createHash } from 'node:crypto';

/**
 * ChatScan anchors a message record on the CDCI chain by publishing a
 * commitment in an `OP_RETURN` output.
 *
 * The payload is the 3-byte marker `CS1` followed by a 32-byte commitment:
 *
 *   OP_RETURN <35 bytes: "CS1" || sha256d(preimage)>
 *
 *   preimage = "chatscan/1:" chainId "|" ciphertextHash "|" size "|" protocol
 *              "|" channelHash "|" nonce
 *
 * That is 37 bytes of script, well inside CDCI's `MAX_OP_RETURN_RELAY` of 83
 * (see src/script/standard.h in Centraldb/CDCI), so the anchor relays as a
 * standard data-carrier transaction.
 *
 * The preimage uses only fields the client already holds, so a CrypterChat
 * client can compute the commitment, publish the anchor, and submit the record
 * with its transaction id in one pass - it does not need to know the ID-number
 * the explorer will assign. Anyone can recompute the commitment from a record's
 * published metadata and check the chain themselves.
 *
 * The commitment reveals nothing about the message: it commits to a digest of
 * the ciphertext, which is not the ciphertext, and to metadata the explorer
 * publishes anyway.
 */

/** ASCII marker that identifies a ChatScan anchor output. */
export const ANCHOR_MARKER = 'CS1';

/** Domain separator, so a commitment cannot be replayed as another hash. */
const DOMAIN = 'chatscan/1:';

/** Byte length of the `OP_RETURN` payload. */
export const ANCHOR_PAYLOAD_BYTES = ANCHOR_MARKER.length + 32;

/** CDCI's `MAX_OP_RETURN_RELAY`, the largest standard data-carrier script. */
export const CDCI_MAX_OP_RETURN_SCRIPT_BYTES = 83;

/**
 * SHA-256d, the double SHA-256 CDCI uses for transaction ids.
 * @param {Buffer | string} input
 * @returns {Buffer}
 */
export function sha256d(input) {
  const first = createHash('sha256')
    .update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input)
    .digest();
  return createHash('sha256').update(first).digest();
}

/**
 * @typedef {object} AnchorSubject
 * @property {string} chainId
 * @property {string} ciphertextHash
 * @property {number} size
 * @property {string} protocol
 * @property {string | null} [channelHash]
 * @property {string} [nonce]
 */

/**
 * The exact string a commitment is taken over. Written out plainly so a client
 * in any language can reproduce it.
 * @param {AnchorSubject} subject
 * @returns {string}
 */
export function anchorPreimage(subject) {
  const parts = [
    subject.chainId,
    subject.ciphertextHash,
    String(subject.size),
    subject.protocol,
    subject.channelHash ?? '',
    subject.nonce ?? '',
  ];
  return `${DOMAIN}${parts.join('|')}`;
}

/**
 * The 32-byte commitment for one message record.
 * @param {AnchorSubject} subject
 * @returns {string} hex digest
 */
export function anchorCommitment(subject) {
  return sha256d(anchorPreimage(subject)).toString('hex');
}

/**
 * The `OP_RETURN` payload for a commitment, as hex.
 * @param {string} commitment 64 hex characters
 */
export function anchorPayloadHex(commitment) {
  return Buffer.concat([Buffer.from(ANCHOR_MARKER, 'ascii'), Buffer.from(commitment, 'hex')]).toString('hex');
}

/**
 * The full `scriptPubKey` for the anchor output, as hex:
 * `OP_RETURN` (0x6a) `PUSH35` (0x23) `<payload>`.
 * @param {string} commitment
 */
export function anchorScriptHex(commitment) {
  const payload = Buffer.from(anchorPayloadHex(commitment), 'hex');
  return Buffer.concat([Buffer.from([0x6a, payload.length]), payload]).toString('hex');
}

/**
 * True when a CDCI `scriptPubKey` hex carries this commitment. Accepts any push
 * encoding the node reports, so a client is free to build the output with
 * `OP_PUSHDATA1` instead of a direct push.
 * @param {string} scriptHex
 * @param {string} commitment
 */
export function scriptCarriesCommitment(scriptHex, commitment) {
  if (typeof scriptHex !== 'string') return false;
  const script = scriptHex.toLowerCase();
  if (!script.startsWith('6a')) return false;
  return script.includes(anchorPayloadHex(commitment));
}

/**
 * Finds the anchor output in a decoded CDCI transaction.
 * @param {{ vout?: { n?: number, scriptPubKey?: { hex?: string } }[] }} transaction
 * @param {string} commitment
 * @returns {{ n: number } | null}
 */
export function findAnchorOutput(transaction, commitment) {
  for (const [index, output] of (transaction?.vout ?? []).entries()) {
    if (scriptCarriesCommitment(output?.scriptPubKey?.hex ?? '', commitment)) {
      return { n: typeof output.n === 'number' ? output.n : index };
    }
  }
  return null;
}
