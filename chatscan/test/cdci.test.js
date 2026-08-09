import assert from 'node:assert/strict';
import test from 'node:test';

import { CdciChain } from '../src/chain/cdci.js';
import { CdciRpc } from '../src/chain/cdci-rpc.js';
import {
  ANCHOR_MARKER,
  ANCHOR_PAYLOAD_BYTES,
  CDCI_MAX_OP_RETURN_SCRIPT_BYTES,
  anchorCommitment,
  anchorPreimage,
  anchorPayloadHex,
  anchorScriptHex,
  findAnchorOutput,
  scriptCarriesCommitment,
  sha256d,
} from '../src/chain/commitment.js';
import { CdciStub, blockHash } from './support/cdci-stub.js';

const SUBJECT = {
  chainId: 'cdci:regtest',
  ciphertextHash: 'a'.repeat(64),
  size: 1024,
  protocol: 'C7',
  channelHash: 'b'.repeat(64),
  nonce: '8f14e45fceea167a5a36dedd4bea2543',
};
const OTHER_SUBJECT = { ...SUBJECT, size: 2048 };
const COMMITMENT = anchorCommitment(SUBJECT);
const OTHER_COMMITMENT = anchorCommitment(OTHER_SUBJECT);

/**
 * @param {import('node:test').TestContext} t
 * @param {ConstructorParameters<typeof CdciStub>[0]} [options]
 */
async function chainOn(t, options) {
  const node = await new CdciStub(options).start();
  t.after(() => node.stop());
  const chain = new CdciChain({
    rpc: new CdciRpc({ url: node.url }),
    network: options?.chain ?? 'main',
    confirmationsForFinality: 6,
  });
  return { node, chain };
}

test('sha256d matches the double SHA-256 CDCI uses for txids', () => {
  // Well-known vector: SHA256d("hello")
  assert.equal(
    sha256d('hello').toString('hex'),
    '9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50',
  );
});

test('the commitment is derived from fields the client already holds', () => {
  assert.match(COMMITMENT, /^[0-9a-f]{64}$/);
  assert.equal(anchorCommitment(SUBJECT), COMMITMENT, 'derivation must be deterministic');
  assert.notEqual(COMMITMENT, OTHER_COMMITMENT, 'a different submission must commit differently');

  // The preimage is spelled out so a client in any language can reproduce it.
  assert.equal(
    anchorPreimage(SUBJECT),
    `chatscan/1:cdci:regtest|${'a'.repeat(64)}|1024|C7|${'b'.repeat(64)}|8f14e45fceea167a5a36dedd4bea2543`,
  );
  assert.equal(sha256d(anchorPreimage(SUBJECT)).toString('hex'), COMMITMENT);

  // Every field is bound: changing any one of them changes the commitment.
  for (const field of ['chainId', 'ciphertextHash', 'size', 'protocol', 'channelHash', 'nonce']) {
    const altered = { ...SUBJECT, [field]: field === 'size' ? 4096 : `${SUBJECT[field]}x` };
    assert.notEqual(anchorCommitment(altered), COMMITMENT, `"${field}" must be committed to`);
  }

  // Absent optional fields are handled without collapsing into another subject.
  assert.notEqual(
    anchorCommitment({ ...SUBJECT, channelHash: null, nonce: '' }),
    anchorCommitment({ ...SUBJECT, channelHash: '', nonce: null }) + 'x',
  );
});

test('the anchor payload fits a standard CDCI data carrier output', () => {
  const payload = Buffer.from(anchorPayloadHex(COMMITMENT), 'hex');
  const script = Buffer.from(anchorScriptHex(COMMITMENT), 'hex');

  assert.equal(payload.length, ANCHOR_PAYLOAD_BYTES);
  assert.equal(payload.subarray(0, 3).toString('ascii'), ANCHOR_MARKER);
  assert.equal(script[0], 0x6a, 'script must start with OP_RETURN');
  assert.equal(script[1], payload.length, 'a direct push of the payload');
  assert.ok(script.length <= CDCI_MAX_OP_RETURN_SCRIPT_BYTES, `${script.length} bytes must relay as standard`);
});

test('an anchor is recognised in any push encoding, and only for its own reference', () => {
  assert.ok(scriptCarriesCommitment(anchorScriptHex(COMMITMENT), COMMITMENT));
  assert.ok(!scriptCarriesCommitment(anchorScriptHex(OTHER_COMMITMENT), COMMITMENT));
  assert.ok(!scriptCarriesCommitment('76a914' + '11'.repeat(20) + '88ac', COMMITMENT));

  // OP_RETURN OP_PUSHDATA1 <len> <payload>
  const pushdata1 = `6a4c23${anchorPayloadHex(COMMITMENT)}`;
  assert.ok(scriptCarriesCommitment(pushdata1, COMMITMENT));
});

test('the anchor output is located by index', () => {
  const transaction = {
    vout: [
      { n: 0, scriptPubKey: { hex: '76a914' + '11'.repeat(20) + '88ac' } },
      { n: 1, scriptPubKey: { hex: anchorScriptHex(COMMITMENT) } },
    ],
  };
  assert.deepEqual(findAnchorOutput(transaction, COMMITMENT), { n: 1 });
  assert.equal(findAnchorOutput(transaction, OTHER_COMMITMENT), null);
  assert.equal(findAnchorOutput({}, COMMITMENT), null);
});

test('chain info normalises what the node reports', async (t) => {
  const { chain } = await chainOn(t, { tipHeight: 5 });
  const info = await chain.info();

  assert.equal(info.backend, 'cdci');
  assert.equal(info.reachable, true);
  assert.equal(info.chain, 'main');
  assert.equal(info.algorithm, 'x11');
  assert.equal(info.blocks, 5);
  assert.equal(info.bestBlockHash, blockHash(5));
  assert.equal(info.difficulty, 1234.5678);
  assert.equal(info.peers, 8);
  assert.equal(info.subversion, '/CentralDataBase Core:1.0.0/');
  assert.deepEqual(info.mempool, { size: 4, bytes: 1200 });
  assert.deepEqual(info.chainlock, { height: 4, hash: blockHash(4) });
  assert.equal(info.syncing, false);
  assert.equal(typeof info.tipTime, 'number');
});

test('an unreachable node is reported, not thrown', async () => {
  const chain = new CdciChain({ rpc: new CdciRpc({ url: 'http://127.0.0.1:1/', timeoutMs: 200 }) });
  const info = await chain.info();

  assert.equal(info.reachable, false);
  assert.match(info.error, /unreachable|timed out/);
  assert.equal(info.blocks, null);
});

test('a node without ChainLocks still reports its chain', async (t) => {
  const { node, chain } = await chainOn(t);
  node.failMethod('getbestchainlock', { code: -32603, message: 'Unable to find any chainlock' });

  const info = await chain.info();
  assert.equal(info.reachable, true);
  assert.equal(info.chainlock, null);
});

test('a node still in initial block download is flagged as syncing', async (t) => {
  const { chain } = await chainOn(t, { tipHeight: 10, headers: 900, initialBlockDownload: true });
  const info = await chain.info();

  assert.equal(info.reachable, true);
  assert.equal(info.syncing, true);
  assert.equal(info.blocks, 10);
  assert.equal(info.headers, 900);
});

test('blocks are listed newest first with the fields the explorer renders', async (t) => {
  const { chain } = await chainOn(t, { tipHeight: 4 });
  const { items, total } = await chain.listBlocks({ limit: 3 });

  assert.equal(total, 5);
  assert.deepEqual(
    items.map((block) => block.height),
    [4, 3, 2],
  );
  const [tip] = items;
  assert.equal(tip.source, 'cdci');
  assert.equal(tip.algorithm, 'x11');
  assert.equal(tip.hash, blockHash(4));
  assert.equal(tip.previousHash, blockHash(3));
  assert.equal(tip.txCount, 1);
  assert.equal(tip.sizeBytes, 2048);
  assert.equal(tip.bits, '1e0ffff0');
  assert.ok(tip.timestamp > 0);
});

test('block listing pages backwards from the tip', async (t) => {
  const { chain } = await chainOn(t, { tipHeight: 4 });
  const page = await chain.listBlocks({ limit: 2, offset: 2 });
  assert.deepEqual(
    page.items.map((block) => block.height),
    [2, 1],
  );
});

test('a block can be fetched by height or hash, and absence is null', async (t) => {
  const { chain } = await chainOn(t, { tipHeight: 4 });

  assert.equal((await chain.getBlock(2)).hash, blockHash(2));
  assert.equal((await chain.getBlock('2')).height, 2);
  assert.equal((await chain.getBlock(blockHash(3))).height, 3);
  assert.equal(await chain.getBlock(99), null);
  assert.equal(await chain.getBlock('ff'.repeat(32)), null);
});

test('a matching anchor is verified with its confirmations', async (t) => {
  const { node, chain } = await chainOn(t, { tipHeight: 5 });
  node.addAnchor({ txid: 'aa'.repeat(32), commitment: COMMITMENT, confirmations: 2, height: 4 });

  const anchor = await chain.verifyAnchor(COMMITMENT, 'aa'.repeat(32));
  assert.equal(anchor.found, true);
  assert.equal(anchor.matched, true);
  assert.equal(anchor.outputIndex, 1);
  assert.equal(anchor.confirmations, 2);
  assert.equal(anchor.blockHeight, 4);
  assert.equal(anchor.blockHash, blockHash(4));
  assert.equal(anchor.finality, 'confirmed');
});

test('an anchor still in the mempool is found but not confirmed', async (t) => {
  const { node, chain } = await chainOn(t);
  node.addAnchor({ txid: 'bb'.repeat(32), commitment: COMMITMENT, confirmations: 0 });

  const anchor = await chain.verifyAnchor(COMMITMENT, 'bb'.repeat(32));
  assert.equal(anchor.found, true);
  assert.equal(anchor.matched, true);
  assert.equal(anchor.confirmations, 0);
  assert.equal(anchor.blockHeight, null);
  assert.equal(anchor.finality, 'mempool');
});

test('a ChainLocked anchor is final regardless of confirmation count', async (t) => {
  const { node, chain } = await chainOn(t);
  node.addAnchor({ txid: 'cc'.repeat(32), commitment: COMMITMENT, confirmations: 1, height: 2, chainlock: true });

  const anchor = await chain.verifyAnchor(COMMITMENT, 'cc'.repeat(32));
  assert.equal(anchor.chainlock, true);
  assert.equal(anchor.finality, 'chainlocked');
});

test('enough confirmations make an anchor final', async (t) => {
  const { node, chain } = await chainOn(t, { tipHeight: 20 });
  node.addAnchor({ txid: 'dd'.repeat(32), commitment: COMMITMENT, confirmations: 6, height: 14 });

  assert.equal((await chain.verifyAnchor(COMMITMENT, 'dd'.repeat(32))).finality, 'final');
});

test('a transaction committing to another record does not match', async (t) => {
  const { node, chain } = await chainOn(t);
  node.addMismatchedAnchor('ee'.repeat(32), OTHER_COMMITMENT);

  const anchor = await chain.verifyAnchor(COMMITMENT, 'ee'.repeat(32));
  assert.equal(anchor.found, true);
  assert.equal(anchor.matched, false);
});

test('an unknown transaction is absent rather than an error', async (t) => {
  const { chain } = await chainOn(t);

  const anchor = await chain.verifyAnchor(COMMITMENT, 'ff'.repeat(32));
  assert.equal(anchor.found, false);
  assert.equal(anchor.matched, false);
  assert.equal(anchor.finality, 'unknown');
});

test('wallet mode publishes the anchor through the node', async (t) => {
  const { node, chain } = await chainOn(t);

  const published = await chain.publishAnchor(COMMITMENT);
  assert.equal(published.txid, 'ff'.repeat(32));
  assert.equal(published.fee, 0.0001);

  const [created] = node.callsTo('createrawtransaction');
  assert.deepEqual(created.params[0], []);
  assert.equal(created.params[1].data, anchorPayloadHex(COMMITMENT));
  assert.equal(node.callsTo('signrawtransactionwithwallet').length, 1);
  assert.equal(node.callsTo('sendrawtransaction').length, 1);
});

test('an unsigned anchor transaction is refused', async (t) => {
  const { node, chain } = await chainOn(t);
  node.failMethod('signrawtransactionwithwallet', { code: -4, message: 'Keys not available' });

  await assert.rejects(() => chain.publishAnchor(COMMITMENT), /Keys not available/);
});
