import assert from 'node:assert/strict';
import test from 'node:test';

import { feeEstimate, networkSnapshot } from '../src/core/network.js';
import { sampleSubmission, testNode } from './helpers.js';

test('a fresh node reports itself online at height 0', async () => {
  const { store, config, chain } = testNode({ CHATSCAN_SEALER_ENABLED: 'true' });
  const snapshot = await networkSnapshot({ store, config, chain });

  assert.equal(snapshot.status, 'online');
  assert.equal(snapshot.height, 0);
  assert.equal(snapshot.blocks, 1);
  assert.equal(snapshot.privacy.contentIndexed, false);
  assert.equal(snapshot.algorithmRounds.length, 11);
});

test('an idle chain stays online even once its tip is old', async () => {
  const { store, node, config, chain } = testNode({
    CHATSCAN_SEALER_ENABLED: 'true',
    CHATSCAN_BLOCK_INTERVAL_MS: '1000',
  });
  await node.submit(sampleSubmission());
  const block = node.sealBlock({ now: 1_000_000 });

  // Far beyond three block intervals, but nothing is waiting to be sealed.
  const snapshot = await networkSnapshot({ store, config, chain, now: block.timestamp + 60_000 });
  assert.equal(snapshot.status, 'online');
  assert.equal(snapshot.unconfirmed.count, 0);
  assert.ok(snapshot.tipAgeMs >= 60_000);
});

test('a backed-up mempool with a stale tip reports degraded', async () => {
  const { store, node, config, chain } = testNode({
    CHATSCAN_SEALER_ENABLED: 'true',
    CHATSCAN_BLOCK_INTERVAL_MS: '1000',
  });
  await node.submit(sampleSubmission());
  const block = node.sealBlock({ now: 1_000_000 });
  await node.submit(sampleSubmission({ nonce: 'aa' }));

  assert.equal((await networkSnapshot({ store, config, chain, now: block.timestamp + 500 })).status, 'online');
  assert.equal((await networkSnapshot({ store, config, chain, now: block.timestamp + 60_000 })).status, 'degraded');
});

test('a disabled sealer reports paused', async () => {
  const { store, config, chain } = testNode({ CHATSCAN_SEALER_ENABLED: 'false' });
  assert.equal((await networkSnapshot({ store, config, chain })).status, 'paused');
});

test('the fee estimate rises with mempool pressure', async () => {
  const config = { feeQuoteUsd: 20, maxRecordsPerBlock: 10 };

  const idle = feeEstimate({ pending: 0 }, config);
  assert.equal(idle.baseUsd, 20);
  assert.equal(idle.estimateUsd, 20);
  assert.equal(idle.pressure, 0);

  const busy = feeEstimate({ pending: 20 }, config);
  assert.equal(busy.pressure, 2);
  assert.equal(busy.estimateUsd, 30);

  // Pressure is capped so a flooded mempool cannot quote an absurd fee.
  assert.equal(feeEstimate({ pending: 10_000 }, config).pressure, 4);
});

test('the snapshot counts 24-hour activity and per-record averages', async () => {
  const { store, node, config, chain } = testNode();
  const first = (await node.submit(sampleSubmission())).record;
  const second = (await node.submit(sampleSubmission())).record;
  node.sealBlock();

  const snapshot = await networkSnapshot({ store, config, chain });
  assert.equal(snapshot.last24h.records, 2);
  assert.equal(snapshot.last24h.bytes, first.size + second.size);
  assert.equal(snapshot.last24h.blocks, 2);
  assert.equal(snapshot.perRecord.confirmed, 2);
  assert.equal(snapshot.perRecord.averageSizeBytes, Math.round((first.size + second.size) / 2));
  assert.equal(snapshot.throughput.records, 2);
});
