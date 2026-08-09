/**
 * Privacy tools that work with CrypterChat + ChatScan.
 *
 * Active tools are implemented in this server / app.
 * Compatible tools are supported via BYO ciphertext digests or deployment
 * choices (e.g. Tor for the chat-server URL).
 */
export const PRIVACY_TOOLS = [
  {
    id: 'pgp',
    name: 'OpenPGP',
    status: 'active',
    role: 'Encrypt and sign chat messages (Curve25519)',
    protocol: 'PGP',
    worksWith: ['chatscan', 'self-host'],
  },
  {
    id: 'chatscan',
    name: 'ChatScan X11',
    status: 'active',
    role: 'Immutable public ledger of ciphertext hashes only',
    protocol: 'x11-hash',
    worksWith: ['pgp', 'aes-gcm', 'age', 'self-host'],
  },
  {
    id: 'aes-gcm',
    name: 'AES-256-GCM (ChatScan C7)',
    status: 'active',
    role: 'SDK envelope crypto when OpenPGP is not selected',
    protocol: 'C7',
    worksWith: ['chatscan', 'self-host'],
  },
  {
    id: 'self-host',
    name: 'Self-hosted chat server',
    status: 'active',
    role: 'Keep encrypted mailboxes on your own machine',
    protocol: null,
    worksWith: ['pgp', 'chatscan', 'tor'],
  },
  {
    id: 'age',
    name: 'age encryption',
    status: 'compatible',
    role: 'Bring-your-own ciphertext → ChatScan digestCiphertext / recordSealed',
    protocol: 'age',
    worksWith: ['chatscan', 'self-host'],
  },
  {
    id: 'tor',
    name: 'Tor onion service',
    status: 'compatible',
    role: 'Publish PUBLIC_URL as an .onion; paste into CrypterChat Server settings',
    protocol: null,
    worksWith: ['self-host', 'pgp', 'chatscan'],
  },
  {
    id: 'minisign',
    name: 'Minisign / signify',
    status: 'compatible',
    role: 'Detached signatures over artifacts; hash still seals on ChatScan',
    protocol: 'minisign',
    worksWith: ['chatscan'],
  },
];

export function privacyToolsPayload({ defaultTool = 'pgp' } = {}) {
  return {
    defaultTool,
    tools: PRIVACY_TOOLS,
    stack: [
      'Client / chat server encrypts with OpenPGP (or AES-GCM / BYO)',
      'Encrypted envelope stays on your chat server',
      'SHA-256 of ciphertext seals on shared ChatScan X11',
    ],
  };
}
