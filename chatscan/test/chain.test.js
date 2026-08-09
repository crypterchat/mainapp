import assert from 'node:assert/strict';
import test from 'node:test';

import { GENESIS_PREVIOUS_HASH, REJECTION_REASONS } from '../src/core/chain.js';
import { merkleRoot } from '../src/core/merkle.js';
import { meetsDifficulty } from '../src/core/x11.js';
import { sampleSubmission, testNode } from './helpers.js';

test('a fresh node starts at a genesis block', async () => {
  const { store } = testNode();
  const genesis = store.getBlockByHeight(0);

  assert.equal(store.blocks.length, 1);
  assert.equal(genesis.height, 0);
  assert.equal(genesis.previousHash, GENESIS_PREVIOUS_HASH);
  assert.equal(genesis.txCount, 0);
  assert.match(genesis.hash, /^[0-9a-f]{64}$/);
});

test('genesis is created once', async () => {
  const { store, node } = testNode();
  node.ensureGenesis();
  node.ensureGenesis();
  assert.equal(store.blocks.length, 1);
});

test('submitted records enter the mempool as pending and get sequential IDs', async () => {
  const { node, store } = testNode();

  const first = (await node.submit(sampleSubmission())).record;
  const second = (await node.submit(sampleSubmission())).record;

  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.equal(first.status, 'pending');
  assert.equal(first.ref, `${first.hash}/1`);
  assert.equal(store.mempool().length, 2);
  assert.equal(store.stats().pending, 2);
});

test('sealing a block confirms its records and links them back', async () => {
  const { node, store } = testNode();
  const first = (await node.submit(sampleSubmission())).record;
  const second = (await node.submit(sampleSubmission())).record;

  const block = node.sealBlock();

  assert.equal(block.height, 1);
  assert.equal(block.previousHash, store.getBlockByHeight(0).hash);
  assert.equal(block.txCount, 2);
  assert.equal(block.merkleRoot, merkleRoot([first.hash, second.hash]));
  assert.ok(meetsDifficulty(block.hash, block.difficulty));
  assert.equal(block.sizeBytes, first.size + second.size);

  const confirmed = store.getRecord(first.hash, first.id);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.blockHeight, 1);
  assert.equal(confirmed.blockHash, block.hash);
  assert.equal(confirmed.indexInBlock, 0);
  assert.equal(store.getRecord(second.hash, second.id).indexInBlock, 1);
  assert.equal(store.mempool().length, 0);
});

test('sealing an empty mempool does nothing unless forced', async () => {
  const { node, store } = testNode();
  assert.equal(node.sealBlock(), null);
  assert.equal(store.blocks.length, 1);

  const forced = node.sealBlock({ allowEmpty: true });
  assert.equal(forced.height, 1);
  assert.equal(forced.txCount, 0);
});

test('a replayed ciphertext digest is recorded as rejected', async () => {
  const { node, store } = testNode();
  const submission = sampleSubmission({ nonce: 'ab12' });

  const first = await node.submit(submission);
  const second = await node.submit(submission);

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.record.status, 'rejected');
  assert.equal(second.record.rejectionReason, REJECTION_REASONS.replay);
  assert.equal(store.stats().rejected, 1);

  // Rejected records never occupy the mempool or a block.
  assert.equal(store.mempool().length, 1);
  const block = node.sealBlock();
  assert.equal(block.txCount, 1);
  assert.equal(store.getRecord(second.record.hash, second.record.id).status, 'rejected');
});

test('the same digest with a different nonce is accepted', async () => {
  const { node } = testNode();
  const digest = 'c'.repeat(64);

  assert.equal((await node.submit({ ciphertextHash: digest, size: 10, nonce: 'aa' })).accepted, true);
  assert.equal((await node.submit({ ciphertextHash: digest, size: 10, nonce: 'bb' })).accepted, true);
});

test('a record above its protocol ceiling is recorded as rejected', async () => {
  const { node } = testNode();
  const result = await node.submit(sampleSubmission({ protocol: 'ETH', size: 256 * 1024 }));

  assert.equal(result.accepted, false);
  assert.equal(result.record.rejectionReason, REJECTION_REASONS.protocolSize);
});

test('a client can resubmit a ciphertext that was rejected on policy', async () => {
  const { node } = testNode();
  const submission = sampleSubmission({ protocol: 'ETH', size: 256 * 1024, nonce: 'f00d' });

  const rejected = await node.submit(submission);
  assert.equal(rejected.accepted, false);

  // The same ciphertext under a protocol that allows the size must not be
  // mistaken for a replay of the rejected record.
  const retried = await node.submit({ ...submission, protocol: 'C7G' });
  assert.equal(retried.accepted, true);
  assert.equal(retried.record.status, 'pending');
});

test('a full mempool seals immediately', async () => {
  const { node, store } = testNode({ CHATSCAN_MAX_RECORDS_PER_BLOCK: '3' });

  for (let i = 0; i < 3; i += 1) await node.submit(sampleSubmission());

  assert.equal(store.blocks.length, 2);
  assert.equal(store.tip().txCount, 3);
  assert.equal(store.stats().pending, 0);
});

test('blocks form a chain with increasing timestamps', async () => {
  const { node, store } = testNode();
  await node.submit(sampleSubmission());
  const first = node.sealBlock({ now: 1000 });
  await node.submit(sampleSubmission());
  const second = node.sealBlock({ now: 500 });

  assert.equal(second.previousHash, first.hash);
  assert.ok(second.timestamp > first.timestamp);
  assert.equal(store.tip().height, 2);
});
