#!/usr/bin/env node
/**
 * Fills a running ChatScan node with demo traffic so the explorer has something
 * to show.
 *
 *   node scripts/seed.js [count] [delayMs]
 *
 * Each message is encrypted locally and only its ciphertext digest is submitted.
 * One duplicate is submitted on purpose so the explorer also shows a rejected
 * record.
 *
 * Seeding targets the local development chain. A CDCI-backed explorer expects
 * every record to carry an on-chain anchor, so use scripts/send-message.js with
 * CDCI_RPC_URL for that.
 */
import { randomBytes } from 'node:crypto';
import process from 'node:process';

import { channelHash, explorerStatus, scriptOptions, sealMessage, submitRecord } from './lib/client.js';

const count = Number.parseInt(process.argv[2] ?? '40', 10);
const delayMs = Number.parseInt(process.argv[3] ?? '25', 10);
const { baseUrl, ingestKey } = scriptOptions();

const status = await explorerStatus(baseUrl);
if (status.backend === 'cdci' && status.anchoring.required) {
  console.error('This explorer runs on CDCI and requires an on-chain anchor for every record,');
  console.error('which seeded traffic cannot produce. Use scripts/send-message.js with CDCI_RPC_URL,');
  console.error('or run the explorer with CHATSCAN_CHAIN_BACKEND=local. See docs/CDCI.md.');
  process.exit(1);
}

const protocols = ['C7', 'C7', 'C7', 'C7G', 'ETH', 'X11'];
const conversations = ['ops', 'design', 'devgroup', 'support', 'x11-core'];
const sample = [
  'shipping the x11 sealer today',
  'rotating the channel keys now',
  'ack',
  'the explorer only stores digests, confirmed',
  'meeting moved, see you in the dev group',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let accepted = 0;
let rejected = 0;
/** @type {object | null} */
let replayCandidate = null;

for (let i = 0; i < count; i += 1) {
  const plaintext = `${sample[i % sample.length]} #${i + 1}`;
  const sealed = sealMessage(plaintext);
  const record = {
    ciphertextHash: sealed.ciphertextHash,
    size: sealed.size + Math.floor(Math.random() * 4096),
    protocol: protocols[i % protocols.length],
    channelHash: channelHash(conversations[i % conversations.length]),
    nonce: randomBytes(16).toString('hex'),
    fee: Number((0.0001 + Math.random() * 0.0009).toFixed(8)),
    appVersion: 'cc-seed-1.0',
  };

  const response = await submitRecord({ baseUrl, ingestKey, record });
  if (response.status === 'rejected') rejected += 1;
  else accepted += 1;
  if (i === 0) replayCandidate = record;

  process.stdout.write(`\rseeded ${i + 1}/${count}`);
  if (delayMs > 0) await sleep(delayMs);
}

if (replayCandidate) {
  const response = await submitRecord({ baseUrl, ingestKey, record: replayCandidate });
  if (response.status === 'rejected') rejected += 1;
}

console.log(`\naccepted ${accepted}, rejected ${rejected}`);
console.log(`explorer ${baseUrl}`);
