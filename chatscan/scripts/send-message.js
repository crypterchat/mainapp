#!/usr/bin/env node
/**
 * Sends one encrypted message record to a running ChatScan node.
 *
 *   node scripts/send-message.js "hello from crypterchat" [conversation] [protocol]
 *
 * The message is encrypted in this process; ChatScan only receives the
 * ciphertext digest and its byte length.
 *
 * When the explorer runs on CDCI and CDCI_RPC_URL points at a node with a funded
 * wallet, the anchor commitment is published on chain first and the resulting
 * transaction id is submitted with the record.
 */
import { randomBytes } from 'node:crypto';
import process from 'node:process';

import { channelHash, explorerStatus, publishAnchor, scriptOptions, sealMessage, submitRecord } from './lib/client.js';

const [text = 'hello from crypterchat', conversation = 'demo', protocol = 'C7'] = process.argv.slice(2);
const { baseUrl, ingestKey, cdci } = scriptOptions();

const status = await explorerStatus(baseUrl);
const sealed = sealMessage(text);
const record = {
  ciphertextHash: sealed.ciphertextHash,
  size: sealed.size,
  protocol,
  channelHash: channelHash(conversation),
  nonce: randomBytes(16).toString('hex'),
  fee: 0.00042,
  appVersion: 'cc-demo-1.0',
};

if (status.backend === 'cdci' && cdci) {
  const anchor = await publishAnchor({ record, chainId: status.chainId, rpc: cdci });
  record.anchorTxid = anchor.txid;
  console.log(`anchored  ${anchor.txid}`);
  console.log(`commitment ${anchor.commitment}`);
} else if (status.backend === 'cdci' && status.anchoring.required) {
  console.error('This explorer runs on CDCI and requires an anchor.');
  console.error('Set CDCI_RPC_URL (plus credentials) so this client can publish one, or start ChatScan with');
  console.error('CDCI_REQUIRE_ANCHOR=false. See docs/CDCI.md.');
  process.exit(1);
}

const response = await submitRecord({ baseUrl, ingestKey, record });

console.log(`recorded  ${response.ref}`);
console.log(`status    ${response.status}${response.rejectionReason ? ` (${response.rejectionReason})` : ''}`);
console.log(`explorer  ${new URL(response.explorerUrl, baseUrl).href}`);
