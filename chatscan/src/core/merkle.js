import { x11, x11Hex } from './x11.js';

const EMPTY_ROOT = x11Hex('chatscan:empty-merkle-root');

/**
 * Builds an X11 merkle root over record hashes. An odd node is paired with
 * itself, matching the convention used by most UTXO-style chains.
 * @param {string[]} hashes hex-encoded leaf hashes
 * @returns {string} hex-encoded root
 */
export function merkleRoot(hashes) {
  if (hashes.length === 0) return EMPTY_ROOT;

  let level = hashes.map((hash) => Buffer.from(hash, 'hex'));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(x11(Buffer.concat([left, right])));
    }
    level = next;
  }
  return level[0].toString('hex');
}

export { EMPTY_ROOT as EMPTY_MERKLE_ROOT };
