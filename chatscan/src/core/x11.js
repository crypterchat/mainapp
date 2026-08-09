import { createHash, getHashes } from 'node:crypto';

/**
 * X11 chains eleven distinct hash functions, feeding each digest into the next.
 *
 * The slot order below is the one CDCI uses - see `HashX11` in
 * https://github.com/Centraldb/CDCI/blob/main/src/hash.h - so a record hash
 * produced here follows the same construction as the chain it is anchored to.
 *
 * CDCI computes the rounds with the reference sphlib primitives (blake512,
 * bmw512, groestl512, skein512, jh512, keccak512, luffa512, cubehash512,
 * shavite512, simd512, echo512), which Node's OpenSSL build does not ship. Each
 * slot is therefore bound to a stand-in digest, so this is *not* a consensus
 * hash: ChatScan never computes X11 proof of work. In `cdci` mode every block
 * hash comes from the CDCI node, which does the real thing in C, and anchor
 * transaction ids are SHA-256d exactly as CDCI computes them
 * (`src/chain/commitment.js`). This chain is only used to derive ChatScan's own
 * record hashes and the hashes of the local development chain.
 */
export const X11_ROUNDS = Object.freeze([
  { slot: 'blake', digest: 'blake2b512' },
  { slot: 'bmw', digest: 'sha3-512' },
  { slot: 'groestl', digest: 'sha512' },
  { slot: 'skein', digest: 'blake2s256' },
  { slot: 'jh', digest: 'sm3' },
  { slot: 'keccak', digest: 'sha3-256' },
  { slot: 'luffa', digest: 'sha384' },
  { slot: 'cubehash', digest: 'sha3-384' },
  { slot: 'shavite', digest: 'ripemd160' },
  { slot: 'simd', digest: 'sha512-256' },
  { slot: 'echo', digest: 'sha256' },
]);

/** Identifier recorded on every block so stored data stays interpretable. */
export const X11_ALGORITHM_ID = 'x11-chatscan-r11';

/** Digest length of {@link x11} output, in bytes. */
export const X11_DIGEST_BYTES = 32;

let verified = false;

function assertRoundsAvailable() {
  if (verified) return;
  const available = new Set(getHashes());
  const missing = X11_ROUNDS.filter((round) => !available.has(round.digest));
  if (missing.length > 0) {
    const names = missing.map((round) => `${round.slot} (${round.digest})`).join(', ');
    throw new Error(`X11 round digests unavailable in this Node build: ${names}`);
  }
  verified = true;
}

/**
 * Runs the eleven-round X11 chain over `input`.
 * @param {string | Buffer | Uint8Array} input
 * @returns {Buffer} 32-byte digest
 */
export function x11(input) {
  assertRoundsAvailable();
  let state = Buffer.isBuffer(input) ? input : Buffer.from(input);
  for (const round of X11_ROUNDS) {
    state = createHash(round.digest).update(state).digest();
  }
  return state;
}

/**
 * Hex-encoded {@link x11} digest.
 * @param {string | Buffer | Uint8Array} input
 * @returns {string}
 */
export function x11Hex(input) {
  return x11(input).toString('hex');
}

/**
 * Serialises a value so equal inputs always hash to the same digest, regardless
 * of key insertion order.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  const body = keys
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',');
  return `{${body}}`;
}

/**
 * Hashes a structured value through the X11 chain.
 * @param {unknown} value
 * @returns {string} hex digest
 */
export function x11Object(value) {
  return x11Hex(canonicalize(value));
}

/**
 * Counts leading zero nibbles of a hex digest - the explorer's proof-of-work
 * measure for a sealed block.
 * @param {string} hex
 * @returns {number}
 */
export function leadingZeroNibbles(hex) {
  let count = 0;
  for (const char of hex) {
    if (char !== '0') break;
    count += 1;
  }
  return count;
}

/**
 * @param {string} hex
 * @param {number} nibbles
 * @returns {boolean}
 */
export function meetsDifficulty(hex, nibbles) {
  return leadingZeroNibbles(hex) >= nibbles;
}
