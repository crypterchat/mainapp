import { assertHex, fromHex, toHex } from './commitment.js';

/**
 * Message encryption helpers.
 *
 * These run entirely on the client. **The key never leaves this process**: it is
 * not part of a message record, it is not sent to the explorer, and there is no
 * field in the ChatScan API that could carry it. What ChatScan receives is a
 * digest of the ciphertext and its length.
 *
 * A chat app is free to ignore this module and use its own scheme - the only
 * thing ChatScan needs is a 32-byte digest of whatever ciphertext the app
 * produced, plus its byte length.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** @returns {SubtleCrypto} */
function subtle() {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error('WebCrypto is unavailable: globalThis.crypto.subtle is required.');
  return value;
}

/**
 * A fresh AES-256-GCM message key, hex encoded. Store or exchange it with your
 * own key agreement - ChatScan has no opinion about that.
 * @returns {string}
 */
export function generateMessageKey() {
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  return toHex(key);
}

/** A random 16-byte nonce, hex encoded, for distinguishing repeat sends. */
export function generateNonce() {
  const nonce = new Uint8Array(16);
  globalThis.crypto.getRandomValues(nonce);
  return toHex(nonce);
}

/**
 * Encrypts a message and returns exactly what ChatScan needs.
 *
 * The envelope is `iv || tag || ciphertext`, and `ciphertextHash` is its
 * SHA-256. Keep the envelope in your own transport or storage; hand ChatScan
 * only `ciphertextHash` and `size`.
 *
 * @param {string} plaintext
 * @param {object} [options]
 * @param {string} [options.key] hex AES-256 key; generated when omitted
 * @returns {Promise<{ key: string, envelope: Uint8Array, ciphertextHash: string, size: number }>}
 */
export async function sealMessage(plaintext, { key = generateMessageKey() } = {}) {
  assertHex(key, 64, 'key');
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);

  const cryptoKey = await subtle().importKey('raw', fromHex(key), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 },
      cryptoKey,
      new TextEncoder().encode(plaintext),
    ),
  );

  // WebCrypto appends the tag; move it next to the iv so the envelope layout is
  // explicit and the same in every language.
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const envelope = new Uint8Array(iv.length + tag.length + ciphertext.length);
  envelope.set(iv, 0);
  envelope.set(tag, iv.length);
  envelope.set(ciphertext, iv.length + tag.length);

  return {
    key,
    envelope,
    ciphertextHash: toHex(new Uint8Array(await subtle().digest('SHA-256', envelope))),
    size: envelope.length,
  };
}

/**
 * Decrypts an envelope produced by {@link sealMessage}.
 * @param {Uint8Array} envelope
 * @param {string} key hex AES-256 key
 * @returns {Promise<string>}
 */
export async function openMessage(envelope, key) {
  assertHex(key, 64, 'key');
  if (!(envelope instanceof Uint8Array) || envelope.length <= IV_BYTES + TAG_BYTES) {
    throw new TypeError('"envelope" must be a Uint8Array of iv || tag || ciphertext.');
  }

  const iv = envelope.subarray(0, IV_BYTES);
  const tag = envelope.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(IV_BYTES + TAG_BYTES);

  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext, 0);
  sealed.set(tag, ciphertext.length);

  const cryptoKey = await subtle().importKey('raw', fromHex(key), 'AES-GCM', false, ['decrypt']);
  const plaintext = await subtle().decrypt({ name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 }, cryptoKey, sealed);
  return new TextDecoder().decode(plaintext);
}

/**
 * An opaque conversation identifier. ChatScan only ever sees this digest, never
 * the conversation name, so pick a name your users cannot be enumerated from -
 * a shared secret or a random room id rather than "alice+bob".
 * @param {string} conversation
 * @returns {Promise<string>}
 */
export async function channelHash(conversation) {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(`chatscan:channel:${conversation}`));
  return toHex(new Uint8Array(digest));
}

/**
 * The SHA-256 of an already-encrypted payload, for apps that bring their own
 * encryption.
 * @param {Uint8Array} envelope
 * @returns {Promise<{ ciphertextHash: string, size: number }>}
 */
export async function digestCiphertext(envelope) {
  if (!(envelope instanceof Uint8Array)) throw new TypeError('"envelope" must be a Uint8Array.');
  const digest = await subtle().digest('SHA-256', envelope);
  return { ciphertextHash: toHex(new Uint8Array(digest)), size: envelope.length };
}
