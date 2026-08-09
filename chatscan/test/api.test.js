import assert from 'node:assert/strict';
import test from 'node:test';

import { sampleSubmission, startTestServer } from './helpers.js';

test('GET /healthz reports readiness', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await app.request('/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).status, 'ok');
});

test('GET /api/v1/status describes the network without leaking content', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const status = await (await app.request('/api/v1/status')).json();

  assert.equal(status.backend, 'local');
  assert.equal(status.network, 'x11-local');
  assert.equal(status.chainId, 'x11:local');
  assert.equal(status.algorithm, 'x11-chatscan-r11');
  assert.equal(status.algorithmRounds.length, 11);
  assert.equal(status.height, 0);
  assert.equal(status.privacy.contentIndexed, false);
  assert.ok(status.fee.estimateUsd > 0);
});

test('GET /api/v1/algorithm documents the eleven rounds', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const payload = await (await app.request('/api/v1/algorithm')).json();
  assert.equal(payload.rounds.length, 11);
  assert.equal(payload.rounds[0].slot, 'blake');
  assert.equal(payload.rounds.at(-1).order, 11);
});

test('POST /api/v1/records indexes a message as {HASH}/{ID-number}', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await app.submit(sampleSubmission());
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.id, 1);
  assert.match(body.hash, /^[0-9a-f]{64}$/);
  assert.equal(body.ref, `${body.hash}/1`);
  assert.equal(body.explorerUrl, `/tx/${body.ref}`);
  assert.equal(body.status, 'pending');
  assert.equal(body.record.contentAvailable, false);

  const fetched = await (await app.request(`/api/v1/records/${body.ref}`)).json();
  assert.equal(fetched.record.ref, body.ref);
  assert.equal(fetched.record.protocolLabel, 'Protocol C7');
});

test('POST /api/v1/records refuses message content', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await app.submit({ ...sampleSubmission(), content: 'meet me at noon' });
  assert.equal(response.status, 400);

  const body = await response.json();
  assert.equal(body.error.code, 'content_rejected');
  assert.equal(body.error.field, 'content');

  const listed = await (await app.request('/api/v1/records')).json();
  assert.equal(listed.total, 0);
});

test('POST /api/v1/records validates the envelope', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  assert.equal((await app.submit({})).status, 400);
  assert.equal((await app.submit({ ciphertextHash: 'short', size: 1 })).status, 400);
  assert.equal((await app.submit({ ...sampleSubmission(), protocol: 'BTC' })).status, 400);

  const badJson = await app.request('/api/v1/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, 'invalid_json');

  const wrongType = await app.request('/api/v1/records', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'hello',
  });
  assert.equal(wrongType.status, 400);
});

test('POST /api/v1/records caps the body size', async (t) => {
  const app = await startTestServer({ CHATSCAN_MAX_REQUEST_BYTES: '64' });
  t.after(() => app.close());

  const response = await app.submit({ ...sampleSubmission(), appVersion: 'v1' });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'payload_too_large');
});

test('a policy rejection is indexed with 202 and a reason', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const submission = sampleSubmission({ nonce: 'beef' });
  assert.equal((await app.submit(submission)).status, 201);

  const replay = await app.submit(submission);
  assert.equal(replay.status, 202);

  const body = await replay.json();
  assert.equal(body.status, 'rejected');
  assert.equal(body.rejectionReason, 'replay-detected');
});

test('ingest keys are enforced when configured', async (t) => {
  const app = await startTestServer({ CHATSCAN_INGEST_KEYS: 'key-one,key-two' });
  t.after(() => app.close());

  assert.equal((await app.submit(sampleSubmission())).status, 401);
  assert.equal(
    (await app.submit(sampleSubmission(), { headers: { authorization: 'Bearer wrong' } })).status,
    401,
  );
  assert.equal(
    (await app.submit(sampleSubmission(), { headers: { authorization: 'Bearer key-two' } })).status,
    201,
  );
  assert.equal((await app.submit(sampleSubmission(), { headers: { 'x-chatscan-key': 'key-one' } })).status, 201);
});

test('ingest is rate limited', async (t) => {
  const app = await startTestServer({ CHATSCAN_INGEST_RATE_PER_MINUTE: '2' });
  t.after(() => app.close());

  assert.equal((await app.submit(sampleSubmission())).status, 201);
  assert.equal((await app.submit(sampleSubmission())).status, 201);

  const limited = await app.submit(sampleSubmission());
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'rate_limited');
});

test('records can be listed, paged and filtered', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  await app.submit(sampleSubmission({ protocol: 'C7' }));
  await app.submit(sampleSubmission({ protocol: 'ETH' }));

  const all = await (await app.request('/api/v1/records?limit=1')).json();
  assert.equal(all.total, 2);
  assert.equal(all.records.length, 1);
  assert.equal(all.records[0].protocol, 'ETH');

  const filtered = await (await app.request('/api/v1/records?protocol=c7')).json();
  assert.equal(filtered.total, 1);

  const invalid = await app.request('/api/v1/records?status=weird');
  assert.equal(invalid.status, 400);
});

test('blocks expose their sealed records', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const submitted = await (await app.submit(sampleSubmission())).json();
  app.node.sealBlock();

  const byHeight = await (await app.request('/api/v1/blocks/1')).json();
  assert.equal(byHeight.block.height, 1);
  assert.equal(byHeight.records.length, 1);
  assert.equal(byHeight.records[0].ref, submitted.ref);
  assert.deepEqual(byHeight.block.recordRefs, [submitted.ref]);

  const byHash = await (await app.request(`/api/v1/blocks/${byHeight.block.hash}`)).json();
  assert.equal(byHash.block.height, 1);

  const list = await (await app.request('/api/v1/blocks')).json();
  assert.equal(list.total, 2);
  assert.equal(list.blocks[0].height, 1);
});

test('search resolves references, hashes and heights', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const submitted = await (await app.submit(sampleSubmission())).json();
  app.node.sealBlock();
  const tipHash = app.store.tip().hash;

  const byRef = await (await app.request(`/api/v1/search?q=${submitted.ref}`)).json();
  assert.equal(byRef.kind, 'record-ref');
  assert.equal(byRef.results[0].url, `/tx/${submitted.ref}`);

  const byHash = await (await app.request(`/api/v1/search?q=${submitted.hash}`)).json();
  assert.equal(byHash.kind, 'record-hash');
  assert.equal(byHash.results.length, 1);

  const byBlock = await (await app.request(`/api/v1/search?q=${tipHash}`)).json();
  assert.equal(byBlock.kind, 'block-hash');
  assert.equal(byBlock.results[0].url, '/block/1');

  const byNumber = await (await app.request('/api/v1/search?q=1')).json();
  assert.equal(byNumber.kind, 'number');
  assert.equal(byNumber.results.length, 2);

  const empty = await (await app.request('/api/v1/search?q=')).json();
  assert.equal(empty.kind, 'empty');

  const channel = 'c'.repeat(64);
  await app.submit(sampleSubmission({ channelHash: channel }));
  await app.submit(sampleSubmission({ channelHash: channel }));
  const byChannel = await (await app.request(`/api/v1/search?q=${channel}`)).json();
  assert.equal(byChannel.kind, 'channel');
  assert.equal(byChannel.results.length, 2);
  assert.ok(byChannel.results.every((result) => result.record.channelHash === channel));

  const unsupported = await (await app.request('/api/v1/search?q=hello%20world')).json();
  assert.equal(unsupported.kind, 'unsupported');
  assert.deepEqual(unsupported.results, []);
});

test('unknown records and blocks return 404 JSON', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const record = await app.request(`/api/v1/records/${'a'.repeat(64)}/9`);
  assert.equal(record.status, 404);
  assert.equal((await record.json()).error.code, 'not_found');

  const malformed = await app.request('/api/v1/records/zzz/9');
  assert.equal(malformed.status, 400);

  assert.equal((await app.request('/api/v1/blocks/9999')).status, 404);
});

test('responses carry hardening headers', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await app.request('/api/v1/status');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});

test('unsupported methods are refused', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  assert.equal((await app.request('/api/v1/status', { method: 'DELETE' })).status, 405);
  assert.equal((await app.request('/', { method: 'POST' })).status, 405);
});

test('the event stream announces new records', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const controller = new AbortController();
  t.after(() => controller.abort());

  const stream = await app.request('/api/v1/stream', { signal: controller.signal });
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value);
  assert.match(first, /^event: status/);

  await app.submit(sampleSubmission());

  let seen = '';
  while (!seen.includes('event: record')) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
  }
  assert.match(seen, /event: record/);
  assert.match(seen, /"contentAvailable": ?false/);
  await reader.cancel();
});
