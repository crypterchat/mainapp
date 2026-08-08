#!/usr/bin/env node
/**
 * A minimal chat app on ChatScan.
 *
 *   node sdk/examples/chat-app.mjs [conversation]
 *
 * It encrypts three messages locally, records them on the explorer, watches the
 * live stream, reads the conversation back, and then proves the point: the
 * explorer holds no content, and the plaintext is only recoverable with the key
 * this process kept.
 *
 * Environment:
 *   CHATSCAN_URL          explorer base URL          (default http://127.0.0.1:3000)
 *   CHATSCAN_INGEST_KEY   ingest key, if required
 *   CDCI_RPC_URL          CDCI node RPC, to publish anchors
 *   CDCI_RPC_USER/_PASSWORD
 *   CDCI_NETWORK          main | test | devnet | regtest (default main)
 */
import process from 'node:process';

import { CdciWallet, ChatSession, openMessage } from '../src/index.js';

const conversation = process.argv[2] ?? 'devgroup';
const baseUrl = process.env.CHATSCAN_URL ?? 'http://127.0.0.1:3000';

const wallet = process.env.CDCI_RPC_URL
  ? new CdciWallet({
      url: process.env.CDCI_RPC_URL,
      network: process.env.CDCI_NETWORK ?? 'main',
      user: process.env.CDCI_RPC_USER,
      password: process.env.CDCI_RPC_PASSWORD,
    })
  : undefined;

const session = await ChatSession.connect({
  baseUrl,
  ingestKey: process.env.CHATSCAN_INGEST_KEY,
  wallet,
  appVersion: 'example-chat-1.0',
});

const { backend, chainId, height, anchoring } = session.status;
console.log(`explorer  ${baseUrl}`);
console.log(`chain     ${chainId} (${backend}) at height ${height}`);
console.log(`anchors   ${anchoring.mode}, required=${anchoring.required}${wallet ? ', wallet configured' : ''}`);
if (backend === 'cdci' && anchoring.required && !wallet) {
  console.error('\nThis explorer requires an on-chain anchor. Set CDCI_RPC_URL so the app can publish one.');
  process.exit(1);
}

// Watch the conversation while we send, the way a chat UI would.
const seen = [];
const watcher = await session.watch({
  conversation,
  onRecord: (record) => seen.push(record.ref),
  onError: (error) => console.warn(`stream: ${error.message ?? error}`),
});

console.log(`\nsending to "${conversation}"`);
const sent = [];
for (const text of [
  'shipping the x11 sealer today',
  'rotating the channel keys now',
  'ack - see you in the dev group',
]) {
  const message = await session.send(text, { conversation });
  sent.push({ ...message, text });
  console.log(`  ${message.ref}`);
  console.log(`    status ${message.status}${message.anchorTxid ? `, anchored in ${message.anchorTxid}` : ''}`);
  console.log(`    ${message.explorerUrl}`);
}

// Give the live stream a moment to deliver.
await new Promise((resolve) => setTimeout(resolve, 500));
watcher.close();
console.log(`\nlive stream delivered ${seen.length} of ${sent.length} records`);

const history = await session.history(conversation, { limit: 10 });
console.log(`history for this conversation: ${history.total} records`);
for (const record of history.records) {
  const settled = record.anchor ? `${record.anchor.finality}` : record.status;
  console.log(`  ${record.ref}  ${record.protocolLabel}  ${record.size} B  ${settled}`);
}

// What the explorer will and will not tell you.
const [newest] = history.records;
const stored = await session.client.getRecord(newest.ref);
console.log('\nwhat the explorer stores for the newest message:');
console.log(`  ciphertext digest ${stored.ciphertextHash}`);
console.log(`  size              ${stored.size} bytes`);
console.log(`  channel           ${stored.channelHash} (an opaque hash of "${conversation}")`);
console.log(`  content available ${stored.contentAvailable}`);

const original = sent.at(-1);
console.log('\nand what only this process can do, with the key it kept:');
console.log(`  ${await openMessage(original.envelope, original.key)}`);

console.log(`\nbrowse the conversation: ${baseUrl}/search?q=${stored.channelHash}`);
