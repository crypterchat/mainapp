import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { ChatScanNode } from '../src/core/chain.js';
import { ChatScanStore } from '../src/store/store.js';
import { sampleSubmission, tempDataDir, testNode } from './helpers.js';

test('the chain log replays records and blocks after a restart', async () => {
  const dataDir = tempDataDir();
  const config = loadConfig({
    CHATSCAN_DATA_DIR: dataDir,
    CHATSCAN_SEALER_ENABLED: 'false',
    CHATSCAN_DIFFICULTY_NIBBLES: '1',
  });

  const store = new ChatScanStore({ chainLogPath: config.chainLogPath, persist: true }).replay();
  const node = new ChatScanNode({ store, config });
  node.ensureGenesis();
  const confirmedRecord = (await node.submit(sampleSubmission())).record;
  node.sealBlock();
  const pendingRecord = (await node.submit(sampleSubmission())).record;
  await store.flush();

  assert.ok(fs.existsSync(path.join(dataDir, 'chain.jsonl')));

  const restored = new ChatScanStore({ chainLogPath: config.chainLogPath, persist: true }).replay();

  assert.equal(restored.records.length, 2);
  assert.equal(restored.blocks.length, 2);
  assert.equal(restored.peekNextRecordId(), 3);
  assert.equal(restored.getRecord(confirmedRecord.hash, confirmedRecord.id).status, 'confirmed');
  assert.equal(restored.getRecord(pendingRecord.hash, pendingRecord.id).status, 'pending');
  assert.equal(restored.tip().hash, store.tip().hash);
});

test('a node with persistence off writes nothing to disk', async () => {
  const { store, node, config } = testNode();
  await node.submit(sampleSubmission());
  await store.flush();
  assert.equal(fs.existsSync(config.chainLogPath), false);
});

test('a corrupt chain log fails loudly instead of silently truncating', async () => {
  const dataDir = tempDataDir();
  const chainLogPath = path.join(dataDir, 'chain.jsonl');
  fs.writeFileSync(chainLogPath, '{"t":"record"}\nnot-json\n');

  assert.throws(() => new ChatScanStore({ chainLogPath, persist: true }).replay(), /Corrupt chain log/);
});

test('records are listed newest first and can be filtered', async () => {
  const { node, store } = testNode();
  const first = (await node.submit(sampleSubmission({ protocol: 'C7' }))).record;
  const second = (await node.submit(sampleSubmission({ protocol: 'ETH' }))).record;
  node.sealBlock();
  const third = (await node.submit(sampleSubmission({ protocol: 'C7' }))).record;

  const all = store.listRecords({ limit: 10 });
  assert.deepEqual(
    all.items.map((record) => record.id),
    [third.id, second.id, first.id],
  );
  assert.equal(all.total, 3);

  assert.deepEqual(
    store.listRecords({ status: 'pending' }).items.map((record) => record.id),
    [third.id],
  );
  assert.deepEqual(
    store.listRecords({ protocol: 'ETH' }).items.map((record) => record.id),
    [second.id],
  );
  assert.equal(store.listRecords({ limit: 1 }).items.length, 1);
  assert.equal(store.listRecords({ limit: 1, offset: 1 }).items[0].id, second.id);
});

test('lookups work by reference, hash and ID-number', async () => {
  const { node, store } = testNode();
  const record = (await node.submit(sampleSubmission())).record;

  assert.equal(store.getRecord(record.hash, record.id).ref, record.ref);
  assert.equal(store.getRecordById(record.id).ref, record.ref);
  assert.deepEqual(
    store.getRecordsByHash(record.hash).map((item) => item.ref),
    [record.ref],
  );
  assert.equal(store.getRecord(record.hash, 999), undefined);
});

test('stats summarise the chain', async () => {
  const { node, store } = testNode();
  const first = (await node.submit(sampleSubmission())).record;
  node.sealBlock();
  const second = (await node.submit(sampleSubmission())).record;

  const stats = store.stats();
  assert.equal(stats.records, 2);
  assert.equal(stats.confirmed, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.pendingBytes, second.size);
  assert.equal(stats.totalBytes, first.size + second.size);
  assert.equal(stats.blocks, 2);
  assert.equal(stats.height, 1);
  assert.equal(stats.last24hCount, 2);
  assert.ok(stats.tps > 0);
});
