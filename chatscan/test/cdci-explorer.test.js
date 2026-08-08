import assert from 'node:assert/strict';
import test from 'node:test';

import { AnchorWatcher } from '../src/chain/anchor-watcher.js';
import { CdciChain } from '../src/chain/cdci.js';
import { CdciRpc } from '../src/chain/cdci-rpc.js';
import { anchorCommitment } from '../src/chain/commitment.js';
import { normalizeSubmission } from '../src/core/records.js';
import { CdciStub, blockHash } from './support/cdci-stub.js';
import { sampleSubmission, startTestServer } from './helpers.js';

const CDCI_ENV = {
  CHATSCAN_CHAIN_BACKEND: 'cdci',
  CDCI_NETWORK: 'regtest',
  CDCI_ANCHOR_POLL_MS: '3600000',
};

/**
 * Boots the explorer against a stub CDCI node.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [env]
 * @param {ConstructorParameters<typeof CdciStub>[0]} [nodeOptions]
 */
async function explorerOnCdci(t, env = {}, nodeOptions = { tipHeight: 5, chain: 'regtest' }) {
  const node = await new CdciStub(nodeOptions).start();
  t.after(() => node.stop());

  const cdci = new CdciChain({
    rpc: new CdciRpc({ url: node.url }),
    network: nodeOptions?.chain ?? 'regtest',
    confirmationsForFinality: 6,
  });

  const app = await startTestServer({ ...CDCI_ENV, ...env }, { cdci });
  t.after(() => app.close());
  return { node, cdci, app };
}

/**
 * The commitment a CrypterChat client computes locally before publishing its
 * anchor - the same derivation `scripts/lib/client.js` uses.
 * @param {object} submission
 * @param {import('../src/config.js').Config} config
 */
function commitmentFor(submission, config) {
  const normalized = normalizeSubmission(submission, { maxCiphertextBytes: config.maxCiphertextBytes });
  return anchorCommitment({ chainId: config.chainId, ...normalized });
}

test('the explorer reports the CDCI chain as its network', async (t) => {
  const { app } = await explorerOnCdci(t);

  const status = await (await app.request('/api/v1/status')).json();
  assert.equal(status.backend, 'cdci');
  assert.equal(status.algorithm, 'x11');
  assert.equal(status.network, 'cdci-regtest');
  assert.equal(status.chainId, 'cdci:regtest');
  assert.equal(status.height, 5);
  assert.equal(status.tipHash, blockHash(5));
  assert.equal(status.status, 'online');
  assert.equal(status.chain.subversion, '/CentralDataBase Core:1.0.0/');
  assert.equal(status.anchoring.marker, 'CS1');
  assert.equal(status.anchoring.payloadBytes, 35);
  assert.deepEqual(status.mempool, { size: 4, bytes: 1200 });
});

test('blocks come from the CDCI node', async (t) => {
  const { app } = await explorerOnCdci(t);

  const listed = await (await app.request('/api/v1/blocks?limit=3')).json();
  assert.equal(listed.total, 6);
  assert.deepEqual(
    listed.blocks.map((block) => block.height),
    [5, 4, 3],
  );
  assert.equal(listed.blocks[0].source, 'cdci');
  assert.equal(listed.blocks[0].algorithm, 'x11');

  const one = await (await app.request('/api/v1/blocks/4')).json();
  assert.equal(one.block.hash, blockHash(4));
  assert.equal(one.block.chainlock, true);
  assert.deepEqual(one.records, []);

  assert.equal((await app.request('/api/v1/blocks/999')).status, 404);
});

test('a record anchored on CDCI is confirmed by its transaction', async (t) => {
  const { node, app } = await explorerOnCdci(t);
  const submission = sampleSubmission();
  const commitment = commitmentFor(submission, app.config);
  const txid = 'a1'.repeat(32);
  node.addAnchor({ txid, commitment, confirmations: 2, height: 4 });

  const response = await app.submit({ ...submission, anchorTxid: txid });
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.status, 'confirmed');
  assert.equal(body.commitment, commitment);
  assert.equal(body.ref, `${body.hash}/${body.id}`);
  assert.equal(body.anchor.txid, txid);
  assert.equal(body.anchor.confirmations, 2);
  assert.equal(body.anchor.blockHeight, 4);
  assert.equal(body.anchor.finality, 'confirmed');
  assert.equal(body.record.contentAvailable, false);

  // The record shows up under the CDCI block that carries its anchor.
  const block = await (await app.request('/api/v1/blocks/4')).json();
  assert.deepEqual(
    block.records.map((record) => record.ref),
    [body.ref],
  );
});

test('an anchor still in the mempool is admitted as pending', async (t) => {
  const { node, app } = await explorerOnCdci(t);
  const submission = sampleSubmission();
  const commitment = commitmentFor(submission, app.config);
  const txid = 'a2'.repeat(32);
  node.addAnchor({ txid, commitment, confirmations: 0 });

  const body = await (await app.submit({ ...submission, anchorTxid: txid })).json();
  assert.equal(body.status, 'pending');
  assert.equal(body.anchor.finality, 'mempool');
  assert.equal(body.anchor.blockHeight, null);
});

test('a record whose anchor commits to something else is rejected', async (t) => {
  const { node, app } = await explorerOnCdci(t);
  const submission = sampleSubmission();
  const txid = 'a3'.repeat(32);
  node.addMismatchedAnchor(txid, commitmentFor(sampleSubmission(), app.config));

  const response = await app.submit({ ...submission, anchorTxid: txid });
  assert.equal(response.status, 202);

  const body = await response.json();
  assert.equal(body.status, 'rejected');
  assert.equal(body.rejectionReason, 'anchor-mismatch');
});

test('a record whose anchor is unknown to the node is rejected', async (t) => {
  const { app } = await explorerOnCdci(t);

  const body = await (await app.submit({ ...sampleSubmission(), anchorTxid: 'a4'.repeat(32) })).json();
  assert.equal(body.status, 'rejected');
  assert.equal(body.rejectionReason, 'anchor-not-found');
});

test('an anchor is required by default in client mode', async (t) => {
  const { app } = await explorerOnCdci(t);

  const body = await (await app.submit(sampleSubmission())).json();
  assert.equal(body.status, 'rejected');
  assert.equal(body.rejectionReason, 'anchor-missing');
});

test('anchors can be made optional', async (t) => {
  const { app } = await explorerOnCdci(t, { CDCI_REQUIRE_ANCHOR: 'false' });

  const body = await (await app.submit(sampleSubmission())).json();
  assert.equal(body.status, 'pending');
  assert.equal(body.anchor, null);
});

test('the anchor endpoint publishes what a client must put on chain', async (t) => {
  const { app } = await explorerOnCdci(t, { CDCI_REQUIRE_ANCHOR: 'false' });
  const submission = sampleSubmission();
  const submitted = await (await app.submit(submission)).json();

  const anchor = await (await app.request(`/api/v1/records/${submitted.ref}/anchor`)).json();
  assert.equal(anchor.ref, submitted.ref);
  assert.equal(anchor.commitment, commitmentFor(submission, app.config));
  assert.equal(anchor.marker, 'CS1');
  assert.ok(anchor.opReturnScript.startsWith('6a23'));
  assert.ok(anchor.opReturnPayload.startsWith(Buffer.from('CS1').toString('hex')));
});

test('an unreachable node keeps the explorer up and reports itself offline', async (t) => {
  const { node, app } = await explorerOnCdci(t);
  await node.stop();

  const status = await (await app.request('/api/v1/status')).json();
  assert.equal(status.status, 'offline');
  assert.equal(status.chain.reachable, false);
  assert.match(status.chain.error, /unreachable|timed out/);

  const page = await app.request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /CDCI node is not answering/);
});

test('a submission is not rejected because the node is down', async (t) => {
  const { node, app } = await explorerOnCdci(t, { CDCI_REQUIRE_ANCHOR: 'true' });
  await node.stop();

  const body = await (await app.submit({ ...sampleSubmission(), anchorTxid: 'a5'.repeat(32) })).json();
  assert.equal(body.status, 'pending');
  assert.equal(body.anchor.finality, 'unknown');
});

test('the anchor watcher settles confirmations as the chain moves', async (t) => {
  const { node, cdci, app } = await explorerOnCdci(t);
  const submission = sampleSubmission();
  const commitment = commitmentFor(submission, app.config);
  const txid = 'a6'.repeat(32);
  node.addAnchor({ txid, commitment, confirmations: 0 });

  const { ref } = await (await app.submit({ ...submission, anchorTxid: txid })).json();
  assert.equal(app.store.recordsByRef.get(ref).status, 'pending');

  // The transaction gets mined, then ChainLocked.
  node.addAnchor({ txid, commitment, confirmations: 1, height: 5 });
  const watcher = new AnchorWatcher({ store: app.store, chain: cdci });

  let result = await watcher.tick();
  assert.equal(result.checked, 1);
  assert.equal(result.updated, 1);

  let record = app.store.recordsByRef.get(ref);
  assert.equal(record.status, 'confirmed');
  assert.equal(record.blockHeight, 5);
  assert.equal(record.anchor.finality, 'confirmed');

  node.addAnchor({ txid, commitment, confirmations: 2, height: 5, chainlock: true });
  result = await watcher.tick();
  assert.equal(result.updated, 1);

  record = app.store.recordsByRef.get(ref);
  assert.equal(record.anchor.chainlock, true);
  assert.equal(record.anchor.finality, 'chainlocked');

  // Final anchors are not re-checked.
  assert.deepEqual(await watcher.tick(), { checked: 0, updated: 0 });
});

test('anchor state survives a restart through the chain log', async (t) => {
  const { node, app } = await explorerOnCdci(t, { CHATSCAN_PERSIST: 'true' });
  const submission = sampleSubmission();
  const commitment = commitmentFor(submission, app.config);
  const txid = 'a7'.repeat(32);
  node.addAnchor({ txid, commitment, confirmations: 3, height: 3 });

  const { ref } = await (await app.submit({ ...submission, anchorTxid: txid })).json();
  await app.store.flush();

  const { ChatScanStore } = await import('../src/store/store.js');
  const restored = new ChatScanStore({ chainLogPath: app.config.chainLogPath, persist: true }).replay();
  const record = restored.recordsByRef.get(ref);

  assert.equal(record.status, 'confirmed');
  assert.equal(record.anchor.txid, txid);
  assert.equal(record.anchor.confirmations, 3);
  assert.equal(restored.recordsAnchoredInBlock(3).length, 1);
});

test('search resolves an anchor transaction id to its record', async (t) => {
  const { node, app } = await explorerOnCdci(t);
  const submission = sampleSubmission();
  const commitment = commitmentFor(submission, app.config);
  const txid = 'a8'.repeat(32);
  node.addAnchor({ txid, commitment, confirmations: 1, height: 4 });
  const { ref } = await (await app.submit({ ...submission, anchorTxid: txid })).json();

  const result = await (await app.request(`/api/v1/search?q=${txid}`)).json();
  assert.equal(result.kind, 'anchor-txid');
  assert.equal(result.results[0].record.ref, ref);
});

test('the record page shows the CDCI anchor and still hides content', async (t) => {
  const { node, app } = await explorerOnCdci(t);
  const submission = sampleSubmission();
  const commitment = commitmentFor(submission, app.config);
  const txid = 'a9'.repeat(32);
  node.addAnchor({ txid, commitment, confirmations: 6, height: 2, chainlock: true });
  const { ref } = await (await app.submit({ ...submission, anchorTxid: txid })).json();

  const body = await (await app.request(`/tx/${ref}`)).text();
  assert.match(body, /CDCI anchor/);
  assert.match(body, new RegExp(txid));
  assert.match(body, new RegExp(commitment));
  assert.match(body, /ChainLocked by the CDCI masternode quorum/);
  assert.match(body, /Content is not viewable/);
});

test('the dashboard shows CDCI node figures', async (t) => {
  const { app } = await explorerOnCdci(t);

  const body = await (await app.request('/')).text();
  assert.match(body, /CDCI Network/);
  assert.match(body, /CDCI regtest/);
  assert.match(body, /CentralDataBase Core:1\.0\.0/);
  assert.match(body, /anchored on the CDCI X11 chain/);
});
