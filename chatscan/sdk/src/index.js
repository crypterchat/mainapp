/**
 * ChatScan SDK - connect a chat app to the CDCI X11 blockchain and a ChatScan
 * explorer.
 *
 * The shape of the integration:
 *
 *   encrypt locally  ->  commit  ->  anchor on CDCI  ->  record on the explorer
 *
 * Message content and keys never leave the client. The explorer only ever
 * receives a digest of the ciphertext, its length, and opaque routing metadata.
 *
 * @example
 * import { ChatSession, CdciWallet } from '@crypterchat/chatscan-sdk';
 *
 * const session = await ChatSession.connect({
 *   baseUrl: 'http://localhost:3000',
 *   wallet: new CdciWallet({ network: 'main', user: 'rpcuser', password: '...' }),
 *   appVersion: 'my-chat-1.0',
 * });
 *
 * const sent = await session.send('hello', { conversation: 'devgroup' });
 * console.log(sent.ref, sent.explorerUrl);
 */

export { ChatScanClient } from './client.js';
export { ChatSession } from './session.js';
export { CdciWallet, CdciWalletError, CDCI_RPC_PORTS } from './cdci-wallet.js';
export { ChatScanError } from './errors.js';

export {
  ANCHOR_MARKER,
  ANCHOR_PAYLOAD_BYTES,
  CDCI_MAX_OP_RETURN_SCRIPT_BYTES,
  anchorCommitment,
  anchorInstructions,
  anchorPayloadHex,
  anchorPreimage,
  anchorScriptHex,
  fromHex,
  sha256d,
  toHex,
} from './commitment.js';

export {
  channelHash,
  digestCiphertext,
  generateMessageKey,
  generateNonce,
  openMessage,
  sealMessage,
} from './crypto.js';

/** SDK version, kept in step with package.json. */
export const VERSION = '0.1.0';
