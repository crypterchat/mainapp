import * as openpgp from 'openpgp';

/**
 * OpenPGP helpers for CrypterChat.
 *
 * Messages are encrypted (+ optionally signed) with OpenPGP. Only the SHA-256
 * of the armored ciphertext is submitted to ChatScan — never keys or plaintext.
 */

/** ChatScan protocol id for OpenPGP-armored ciphertext digests. */
export const PGP_PROTOCOL = 'PGP';

/**
 * @param {{ phone: string, displayName?: string, passphrase: string }} opts
 */
export async function generateUserKey({ phone, displayName, passphrase }) {
  const name = (displayName || phone).slice(0, 64);
  const email = `${phone.replace(/^\+/, '')}@users.crypterchat.local`;
  const { privateKey, publicKey, revocationCertificate } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name, email }],
    passphrase,
    format: 'armored',
  });
  const pub = await openpgp.readKey({ armoredKey: publicKey });
  return {
    publicArmored: publicKey,
    privateArmored: privateKey,
    fingerprint: pub.getFingerprint().toLowerCase(),
    revocationCertificate,
    createdAt: Date.now(),
  };
}

export async function readPublicKey(armored) {
  return openpgp.readKey({ armoredKey: armored });
}

export async function unlockPrivateKey(armoredPrivate, passphrase) {
  const privateKey = await openpgp.readPrivateKey({ armoredKey: armoredPrivate });
  if (privateKey.isDecrypted()) return privateKey;
  return openpgp.decryptKey({ privateKey, passphrase });
}

/**
 * Encrypt plaintext for one or more recipients and sign with the sender key.
 * @returns {Promise<string>} armored OpenPGP message
 */
export async function encryptAndSign({
  text,
  recipientPublicKeys,
  signingPrivateKey,
}) {
  const encryptionKeys = await Promise.all(
    recipientPublicKeys.map((k) => (typeof k === 'string' ? readPublicKey(k) : Promise.resolve(k))),
  );
  return openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    encryptionKeys,
    signingKeys: signingPrivateKey,
    format: 'armored',
  });
}

/**
 * Decrypt an armored OpenPGP message with the unlocked private key.
 * @returns {Promise<{ text: string, signatures: Array<{ keyID: string, valid: boolean|null }> }>}
 */
export async function decryptMessage({ armoredMessage, decryptionKey, verificationKeys = [] }) {
  const message = await openpgp.readMessage({ armoredMessage });
  const result = await openpgp.decrypt({
    message,
    decryptionKeys: decryptionKey,
    verificationKeys: verificationKeys.length ? verificationKeys : undefined,
  });
  const signatures = [];
  for (const sig of result.signatures || []) {
    let valid = null;
    try {
      await sig.verified;
      valid = true;
    } catch {
      valid = false;
    }
    signatures.push({
      keyID: sig.keyID?.toHex?.() || String(sig.keyID || ''),
      valid,
    });
  }
  return { text: String(result.data), signatures };
}

export function fingerprintShort(fp) {
  const clean = String(fp || '').replace(/\s+/g, '').toLowerCase();
  if (clean.length < 8) return clean;
  return clean.slice(-8);
}
