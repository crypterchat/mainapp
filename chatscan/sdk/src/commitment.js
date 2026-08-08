/**
 * The ChatScan anchor commitment, derived exactly as the explorer derives it.
 *
 *   OP_RETURN <35 bytes: "CS1" || sha256d(preimage)>
 *
 *   preimage = "chatscan/1:" chainId "|" ciphertextHash "|" size "|" protocol
 *              "|" channelHash "|" nonce
 *
 * Everything here runs on WebCrypto, so the same code works in a browser, in
 * React Native and in Node. `sha256d` is the double SHA-256 CDCI uses for
 * transaction ids.
 *
 * The commitment depends only on values a chat app already holds, so it can be
 * computed and published on chain *before* the record is submitted - the client
 * never has to wait to learn the ID-number the explorer will assign.
 */

/** ASCII marker identifying a ChatScan anchor output. */
export const ANCHOR_MARKER = 'CS1';

/** Domain separator, so a commitment cannot be replayed as another hash. */
const DOMAIN = 'chatscan/1:';

/** Byte length of the `OP_RETURN` payload. */
export const ANCHOR_PAYLOAD_BYTES = 35;

/** CDCI's `MAX_OP_RETURN_RELAY`: the largest standard data-carrier script. */
export const CDCI_MAX_OP_RETURN_SCRIPT_BYTES = 83;

/**
 * @typedef {object} AnchorSubject
 * @property {string} chainId the explorer's chain id, from `client.status()`
 * @property {string} ciphertextHash 64 lowercase hex characters
 * @property {number} size ciphertext length in bytes
 * @property {string} [protocol] defaults to `C7`
 * @property {string | null} [channelHash]
 * @property {string} [nonce]
 */

/**
 * @param {Uint8Array | string} input
 * @returns {Promise<Uint8Array>}
 */
export async function sha256d(input) {
  const subtle = getSubtle();
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const first = await subtle.digest('SHA-256', bytes);
  const second = await subtle.digest('SHA-256', first);
  return new Uint8Array(second);
}

/**
 * The exact string the commitment is taken over.
 * @param {AnchorSubject} subject
 * @returns {string}
 */
export function anchorPreimage(subject) {
  const parts = [
    subject.chainId,
    subject.ciphertextHash,
    String(subject.size),
    subject.protocol ?? 'C7',
    subject.channelHash ?? '',
    subject.nonce ?? '',
  ];
  return `${DOMAIN}${parts.join('|')}`;
}

/**
 * The 32-byte commitment for one message, hex encoded.
 * @param {AnchorSubject} subject
 * @returns {Promise<string>}
 */
export async function anchorCommitment(subject) {
  return toHex(await sha256d(anchorPreimage(subject)));
}

/**
 * The `OP_RETURN` payload for a commitment, hex encoded. Pass this as the
 * `data` output when building the anchor transaction.
 * @param {string} commitment
 * @returns {string}
 */
export function anchorPayloadHex(commitment) {
  assertHex(commitment, 64, 'commitment');
  return toHex(new TextEncoder().encode(ANCHOR_MARKER)) + commitment.toLowerCase();
}

/**
 * The full anchor `scriptPubKey`, hex encoded: `OP_RETURN` `PUSH35` `<payload>`.
 * @param {string} commitment
 * @returns {string}
 */
export function anchorScriptHex(commitment) {
  const payload = anchorPayloadHex(commitment);
  return `6a${(payload.length / 2).toString(16).padStart(2, '0')}${payload}`;
}

/**
 * Everything needed to publish one anchor.
 * @param {AnchorSubject} subject
 */
export async function anchorInstructions(subject) {
  const commitment = await anchorCommitment(subject);
  return {
    commitment,
    marker: ANCHOR_MARKER,
    preimage: anchorPreimage(subject),
    opReturnPayload: anchorPayloadHex(commitment),
    opReturnScript: anchorScriptHex(commitment),
  };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toHex(bytes) {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function fromHex(hex) {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * @param {string} value
 * @param {number} length
 * @param {string} field
 */
export function assertHex(value, length, field) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value)) {
    throw new TypeError(`"${field}" must be ${length} hex characters.`);
  }
}

/** @returns {SubtleCrypto} */
function getSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'WebCrypto is unavailable. The ChatScan SDK needs globalThis.crypto.subtle (Node 20+, or a secure browser context).',
    );
  }
  return subtle;
}
