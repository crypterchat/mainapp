import assert from 'node:assert/strict';
import test from 'node:test';

import { CdciChain } from '../../src/chain/cdci.js';
import { CdciRpc } from '../../src/chain/cdci-rpc.js';
import { startTestServer } from '../../test/helpers.js';
import { CdciStub } from '../../test/support/cdci-stub.js';
import { CdciWallet, CdciWalletError, ChatSession, anchorCommitment, openMessage } from '../src/index.js';

/**
 * A CDCI-backed explorer, a stub node, and an SDK wallet pointed at that node -
 * the full shape of a chat app talking to the chain and the explorer.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [env]
 */
async function chatStack(t, env = {}) {
  const node = await new CdciStub({ chain: 'regtest', tipHeight: 8 }).start();
  t.after(() => node.stop());

  const cdci = new CdciChain({
    rpc: new CdciRpc({ url: node.url }),
    network: 'regtest',
    confirmationsForFinality: 6,
  });

  const app = await startTestServer(
    {
      CHATSCAN_CHAIN_BACKEND: 'cdci',
      CDCI_NETWORK: 'regtest',
      CDCI_ANCHOR_POLL_MS: '3600000',
      ...env,
    },
    { cdci },
  );
  t.after(() => app.close());

  const wallet = new CdciWallet({ url: node.url });
  return { node, cdci, app, wallet };
}

/**
 * The stub node accepts anchor transactions but does not mine them, so mirror
 * what a real node would do once the transaction is broadcast.
 * @param {CdciStub} node
 * @param {string} commitment
 * @param {string} txid
 * @param {{ confirmations?: number, height?: number, chainlock?: boolean }} [state]
 */
function mineAnchor(node, commitment, txid, state = {}) {
  node.addAnchor({ txid, commitment, confirmations: 1, height: 7, ...state });
}

test('the wallet publishes an anchor the explorer accepts', async (t) => {
  const { node, app, wallet } = await chatStack(t);
  const session = await ChatSession.connect({ baseUrl: app.baseUrl, wallet, appVersion: 'chat-1.0' });

  assert.equal(session.status.backend, 'cdci');
  assert.equal(session.status.anchoring.required, true);

  // Publish first so the stub knows the transaction, exactly as a real node
  // would after sendrawtransaction.
  const sealedCommitment = await anchorCommitment({
    chainId: session.status.chainId,
    ciphertextHash: 'a'.repeat(64),
    size: 100,
    protocol: 'C7',
  });
  const published = await wallet.publishAnchor(sealedCommitment);
  assert.match(published.txid, /^[0-9a-f]{64}$/);

  const [created] = node.callsTo('createrawtransaction');
  assert.deepEqual(created.params[0], []);
  assert.ok(created.params[1].data.startsWith(Buffer.from('CS1').toString('hex')));
});

test('a chat app sends an anchored message end to end', async (t) => {
  const { node, app, wallet } = await chatStack(t);
  const session = await ChatSession.connect({ baseUrl: app.baseUrl, wallet, appVersion: 'chat-1.0' });

  // The wallet stub returns a fixed txid; register it as mined for the exact
  // commitment the session will compute.
  const originalPublish = wallet.publishAnchor.bind(wallet);
  wallet.publishAnchor = async (commitment) => {
    const published = await originalPublish(commitment);
    mineAnchor(node, commitment, published.txid, { confirmations: 2, height: 7 });
    return published;
  };

  const sent = await session.send('rotating the channel keys now', { conversation: 'x11-core' });

  assert.equal(sent.status, 'confirmed');
  assert.match(sent.anchorTxid, /^[0-9a-f]{64}$/);
  assert.equal(sent.record.anchor.confirmations, 2);
  assert.equal(sent.record.anchor.blockHeight, 7);
  assert.equal(sent.record.anchor.finality, 'confirmed');
  assert.equal(sent.explorerUrl, `${app.baseUrl}/tx/${sent.ref}`);

  // The plaintext is still only available locally.
  assert.equal(await openMessage(sent.envelope, sent.key), 'rotating the channel keys now');
  const stored = await session.client.getRecord(sent.ref);
  assert.equal(stored.contentAvailable, false);
  assert.ok(!JSON.stringify(stored).includes('rotating the channel keys'));

  // And it appears under the CDCI block that carries its anchor.
  const block = await session.client.getBlock(7);
  assert.deepEqual(
    block.records.map((record) => record.ref),
    [sent.ref],
  );
});

test('a ChainLocked anchor is reported as final', async (t) => {
  const { node, app, wallet } = await chatStack(t);
  const session = await ChatSession.connect({ baseUrl: app.baseUrl, wallet });

  const originalPublish = wallet.publishAnchor.bind(wallet);
  wallet.publishAnchor = async (commitment) => {
    const published = await originalPublish(commitment);
    mineAnchor(node, commitment, published.txid, { confirmations: 1, height: 6, chainlock: true });
    return published;
  };

  const sent = await session.send('ack', { conversation: 'ops' });
  assert.equal(sent.record.anchor.chainlock, true);
  assert.equal(sent.record.anchor.finality, 'chainlocked');
});

test('an anchor the node has never seen is rejected, and the app can tell why', async (t) => {
  const { app, wallet } = await chatStack(t);
  const session = await ChatSession.connect({ baseUrl: app.baseUrl, wallet });

  // The wallet "publishes" but the stub never learns about the transaction,
  // which is what a client without -txindex on its node would see.
  const sent = await session.send('lost anchor', { conversation: 'ops' });

  assert.equal(sent.status, 'rejected');
  assert.equal(sent.rejectionReason, 'anchor-not-found');
});

test('a client-published anchor can be supplied directly', async (t) => {
  const { node, app } = await chatStack(t);
  const session = await ChatSession.connect({ baseUrl: app.baseUrl });
  const wallet = new CdciWallet({ url: node.url });

  // Derive the commitment for a fixed submission, publish it, then send with the
  // txid - the flow for an app whose wallet lives elsewhere.
  const submission = { ciphertextHash: 'b'.repeat(64), size: 512, protocol: 'C7', nonce: 'cafe' };
  const commitment = await anchorCommitment({ chainId: session.status.chainId, ...submission });
  const published = await wallet.publishAnchor(commitment);
  mineAnchor(node, commitment, published.txid, { confirmations: 3, height: 5 });

  const submitted = await session.client.submitRecord({ ...submission, anchorTxid: published.txid });
  assert.equal(submitted.status, 'confirmed');
  assert.equal(submitted.commitment, commitment);
  assert.equal(submitted.anchor.confirmations, 3);
});

test('the wallet reports node state and surfaces RPC failures', async (t) => {
  const { node, wallet } = await chatStack(t);

  const info = await wallet.info();
  assert.equal(info.chain, 'regtest');
  assert.equal(info.blocks, 8);

  node.failMethod('fundrawtransaction', { code: -6, message: 'Insufficient funds' });
  await assert.rejects(
    () => wallet.publishAnchor('c'.repeat(64)),
    (error) => {
      assert.ok(error instanceof CdciWalletError);
      assert.equal(error.code, -6);
      assert.match(error.message, /Insufficient funds/);
      return true;
    },
  );
});

test('an unreachable node is reported clearly', async () => {
  const wallet = new CdciWallet({ url: 'http://127.0.0.1:1/', timeoutMs: 300 });
  await assert.rejects(() => wallet.info(), /is unreachable/);
});

test('the default RPC endpoint follows the CDCI network', () => {
  assert.equal(new CdciWallet().url, 'http://127.0.0.1:13431/');
  assert.equal(new CdciWallet({ network: 'test' }).url, 'http://127.0.0.1:23431/');
  assert.equal(new CdciWallet({ network: 'regtest' }).url, 'http://127.0.0.1:19898/');
});
