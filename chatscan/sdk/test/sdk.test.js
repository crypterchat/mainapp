import assert from 'node:assert/strict';
import test from 'node:test';

import { anchorCommitment as serverCommitment } from '../../src/chain/commitment.js';
import { createRecord, normalizeSubmission } from '../../src/core/records.js';
import { startTestServer } from '../../test/helpers.js';
import {
  ANCHOR_MARKER,
  ANCHOR_PAYLOAD_BYTES,
  CDCI_MAX_OP_RETURN_SCRIPT_BYTES,
  ChatScanClient,
  ChatScanError,
  ChatSession,
  anchorCommitment,
  anchorInstructions,
  anchorPayloadHex,
  anchorPreimage,
  anchorScriptHex,
  channelHash,
  digestCiphertext,
  fromHex,
  generateMessageKey,
  generateNonce,
  openMessage,
  sealMessage,
  sha256d,
  toHex,
} from '../src/index.js';

const SUBJECT = {
  chainId: 'cdci:regtest',
  ciphertextHash: 'a'.repeat(64),
  size: 1024,
  protocol: 'C7',
  channelHash: 'b'.repeat(64),
  nonce: '8f14e45fceea167a5a36dedd4bea2543',
};

/**
 * A ChatScan explorer on an ephemeral port, plus an SDK client pointed at it.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [env]
 */
async function explorer(t, env = {}) {
  const app = await startTestServer(env);
  t.after(() => app.close());
  const client = new ChatScanClient({ baseUrl: app.baseUrl });
  return { app, client };
}

test('the SDK derives the same commitment as the explorer', async () => {
  const fromSdk = await anchorCommitment(SUBJECT);
  const fromServer = serverCommitment(SUBJECT);

  assert.equal(fromSdk, fromServer, 'a client that computes its own commitment must match the explorer');
  assert.match(fromSdk, /^[0-9a-f]{64}$/);
  assert.equal(await sha256d(anchorPreimage(SUBJECT)).then(toHex), fromSdk);
});

test('the commitment binds every field, and defaults match the explorer', async () => {
  const baseline = await anchorCommitment(SUBJECT);
  for (const field of ['chainId', 'ciphertextHash', 'size', 'protocol', 'channelHash', 'nonce']) {
    const altered = { ...SUBJECT, [field]: field === 'size' ? 2048 : `${SUBJECT[field]}x` };
    assert.notEqual(await anchorCommitment(altered), baseline, `"${field}" must be committed to`);
  }

  // Omitted protocol/channel/nonce must normalise exactly as the server does.
  const sparse = { chainId: SUBJECT.chainId, ciphertextHash: SUBJECT.ciphertextHash, size: 10 };
  assert.equal(
    await anchorCommitment(sparse),
    serverCommitment({ ...sparse, protocol: 'C7', channelHash: null, nonce: '' }),
  );
});

test('the anchor payload is a standard CDCI data carrier output', async () => {
  const { commitment, opReturnPayload, opReturnScript, marker } = await anchorInstructions(SUBJECT);

  assert.equal(marker, ANCHOR_MARKER);
  assert.equal(fromHex(opReturnPayload).length, ANCHOR_PAYLOAD_BYTES);
  assert.equal(new TextDecoder().decode(fromHex(opReturnPayload).subarray(0, 3)), 'CS1');
  assert.equal(opReturnPayload, anchorPayloadHex(commitment));
  assert.equal(opReturnScript, anchorScriptHex(commitment));
  assert.equal(opReturnScript.slice(0, 4), '6a23');
  assert.ok(fromHex(opReturnScript).length <= CDCI_MAX_OP_RETURN_SCRIPT_BYTES);
});

test('malformed commitments are refused before they reach a wallet', () => {
  assert.throws(() => anchorPayloadHex('nope'), /must be 64 hex characters/);
  assert.throws(() => anchorScriptHex('a'.repeat(63)), /must be 64 hex characters/);
});

test('sealMessage round-trips and reports what the explorer needs', async () => {
  const sealed = await sealMessage('meet me at noon');

  assert.match(sealed.key, /^[0-9a-f]{64}$/);
  assert.equal(sealed.size, sealed.envelope.length);
  assert.match(sealed.ciphertextHash, /^[0-9a-f]{64}$/);
  assert.equal(await openMessage(sealed.envelope, sealed.key), 'meet me at noon');

  // The digest is a plain SHA-256 of the envelope, so any client can reproduce it.
  assert.deepEqual(await digestCiphertext(sealed.envelope), {
    ciphertextHash: sealed.ciphertextHash,
    size: sealed.size,
  });
});

test('the envelope is not the plaintext, and the wrong key fails', async () => {
  const sealed = await sealMessage('secret words', { key: generateMessageKey() });
  const asText = new TextDecoder().decode(sealed.envelope);

  assert.ok(!asText.includes('secret words'));
  await assert.rejects(() => openMessage(sealed.envelope, generateMessageKey()));
  await assert.rejects(() => openMessage(sealed.envelope.subarray(0, 8), sealed.key), /must be a Uint8Array/);
});

test('the same message under the same key still produces a distinct envelope', async () => {
  const key = generateMessageKey();
  const first = await sealMessage('ack', { key });
  const second = await sealMessage('ack', { key });

  assert.notEqual(first.ciphertextHash, second.ciphertextHash, 'a fresh IV must be used per message');
});

test('channel hashes are opaque and stable', async () => {
  const hash = await channelHash('devgroup');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await channelHash('devgroup'));
  assert.notEqual(hash, await channelHash('devgroup '));
  assert.ok(!hash.includes('devgroup'));
});

test('nonces are unique per call', () => {
  const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
  assert.equal(nonces.size, 50);
});

test('the client reads status, algorithm and chain state', async (t) => {
  const { client } = await explorer(t);

  const status = await client.status();
  assert.equal(status.backend, 'local');
  assert.equal(typeof status.chainId, 'string');
  assert.equal(status.anchoring.marker, 'CS1');

  assert.equal((await client.algorithm()).rounds.length, 11);
  assert.equal((await client.chain()).backend, 'local');
});

test('the client records a message and reads it back', async (t) => {
  const { client } = await explorer(t);
  const status = await client.status();
  const sealed = await sealMessage('hello from the sdk');
  const submission = {
    ciphertextHash: sealed.ciphertextHash,
    size: sealed.size,
    protocol: 'C7',
    nonce: generateNonce(),
  };

  const submitted = await client.submitRecord(submission);

  assert.equal(submitted.ref, `${submitted.hash}/${submitted.id}`);
  assert.equal(submitted.status, 'pending');
  assert.equal(submitted.record.contentAvailable, false);
  assert.equal(
    submitted.commitment,
    await anchorCommitment({ chainId: status.chainId, ...submission }),
    'the commitment the explorer recorded must be the one a client can derive',
  );

  const fetched = await client.getRecord(submitted.ref);
  assert.equal(fetched.ref, submitted.ref);
  assert.equal(fetched.ciphertextHash, sealed.ciphertextHash);
  assert.equal(client.recordUrl(submitted.ref), `${client.baseUrl}/tx/${submitted.ref}`);
});

test('the explorer and the SDK agree on the anchor payload for a record', async (t) => {
  const { client } = await explorer(t);
  const status = await client.status();
  const submission = { ciphertextHash: 'd'.repeat(64), size: 321, protocol: 'C7', nonce: 'ab12' };

  const fromExplorer = await client.anchorPayload(submission);
  const fromSdk = await anchorInstructions({ chainId: status.chainId, ...submission });

  assert.equal(fromExplorer.commitment, fromSdk.commitment);
  assert.equal(fromExplorer.opReturnScript, fromSdk.opReturnScript);
  assert.equal(fromExplorer.preimage, fromSdk.preimage);
});

test('message content is refused, and the SDK surfaces the reason', async (t) => {
  const { client } = await explorer(t);

  await assert.rejects(
    () => client.submitRecord({ ciphertextHash: 'e'.repeat(64), size: 10, content: 'meet me at noon' }),
    (error) => {
      assert.ok(error instanceof ChatScanError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'content_rejected');
      assert.equal(error.details.field, 'content');
      assert.equal(error.clientFault, true);
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test('a rate limit is reported as retryable', async (t) => {
  const { client } = await explorer(t, { CHATSCAN_INGEST_RATE_PER_MINUTE: '1' });

  await client.submitRecord({ ciphertextHash: 'f'.repeat(64), size: 10 });
  await assert.rejects(
    () => client.submitRecord({ ciphertextHash: '1'.repeat(64), size: 10 }),
    (error) => {
      assert.equal(error.code, 'rate_limited');
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test('an unreachable explorer is a network error, not a crash', async () => {
  const client = new ChatScanClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 });

  await assert.rejects(
    () => client.status(),
    (error) => {
      assert.ok(error instanceof ChatScanError);
      assert.equal(error.code, 'network_error');
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test('an ingest key is presented as a bearer token', async (t) => {
  const app = await startTestServer({ CHATSCAN_INGEST_KEYS: 'sdk-key' });
  t.after(() => app.close());

  const anonymous = new ChatScanClient({ baseUrl: app.baseUrl });
  await assert.rejects(() => anonymous.submitRecord({ ciphertextHash: '2'.repeat(64), size: 10 }), {
    code: 'unauthorized',
  });

  const authenticated = new ChatScanClient({ baseUrl: app.baseUrl, ingestKey: 'sdk-key' });
  const submitted = await authenticated.submitRecord({ ciphertextHash: '3'.repeat(64), size: 10 });
  assert.equal(submitted.status, 'pending');
});

test('blocks and search are reachable through the client', async (t) => {
  const { app, client } = await explorer(t);
  const submitted = await client.submitRecord({ ciphertextHash: '4'.repeat(64), size: 10 });
  app.node.sealBlock();

  const blocks = await client.listBlocks({ limit: 2 });
  assert.equal(blocks.blocks[0].height, 1);

  const block = await client.getBlock(1);
  assert.equal(block.records[0].ref, submitted.ref);

  const found = await client.search(submitted.ref);
  assert.equal(found.kind, 'record-ref');
  assert.equal(found.results[0].record.ref, submitted.ref);
});

test('watch() delivers records over the live stream', async (t) => {
  const { client } = await explorer(t);

  const seen = [];
  const received = new Promise((resolve) => {
    const handle = client.watch({
      onRecord: (record) => {
        seen.push(record);
        handle.close();
        resolve(record);
      },
    });
    t.after(() => handle.close());
  });

  // Give the stream a moment to attach before producing an event.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const submitted = await client.submitRecord({ ciphertextHash: '5'.repeat(64), size: 10 });

  const record = await received;
  assert.equal(record.ref, submitted.ref);
  assert.equal(record.contentAvailable, false);
  assert.equal(seen.length, 1);
});

test('a session sends a message end to end and keeps the key local', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const session = await ChatSession.connect({ baseUrl: app.baseUrl, appVersion: 'sdk-test-1.0' });
  const sent = await session.send('the sealer runs every 15 seconds', { conversation: 'devgroup' });

  assert.equal(sent.status, 'pending');
  assert.equal(sent.explorerUrl, `${app.baseUrl}/tx/${sent.ref}`);
  assert.match(sent.key, /^[0-9a-f]{64}$/);
  assert.equal(await openMessage(sent.envelope, sent.key), 'the sealer runs every 15 seconds');

  // What the explorer stored: metadata, and a channel that hides the name.
  const stored = await session.client.getRecord(sent.ref);
  assert.equal(stored.appVersion, 'sdk-test-1.0');
  assert.equal(stored.channelHash, await channelHash('devgroup'));
  assert.equal(stored.size, sent.envelope.length);
  assert.equal(stored.contentAvailable, false);
  assert.ok(!JSON.stringify(stored).includes('sealer runs'));

  // The commitment the session computed is the one the explorer recorded.
  assert.equal(stored.commitment, sent.commitment);
});

test('session history is scoped to one conversation', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());
  const session = await ChatSession.connect({ baseUrl: app.baseUrl });

  await session.send('one', { conversation: 'ops' });
  await session.send('two', { conversation: 'ops' });
  await session.send('elsewhere', { conversation: 'design' });

  const ops = await session.history('ops');
  assert.equal(ops.total, 2);
  assert.equal((await session.history('design')).total, 1);
  assert.equal((await session.history('nobody')).total, 0);
});

test('a session refuses to send without an anchor when the explorer requires one', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());
  const session = await ChatSession.connect({ baseUrl: app.baseUrl });

  // Pretend the explorer is CDCI-backed and demands anchors.
  session.status = { ...session.status, backend: 'cdci', anchoring: { ...session.status.anchoring, required: true } };

  await assert.rejects(() => session.send('hello'), /requires an on-chain anchor/);
});

test('a session must know the chain before sending', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const session = new ChatSession({ client: new ChatScanClient({ baseUrl: app.baseUrl }) });
  await assert.rejects(() => session.send('hello'), /before sending/);
});

test('a record hash still refers to the record the explorer created', async (t) => {
  const { app, client } = await explorer(t);
  const submission = { ciphertextHash: '6'.repeat(64), size: 77, protocol: 'C7' };
  const submitted = await client.submitRecord(submission);

  // Rebuilding the record locally with the explorer's own code reproduces the
  // reference, which is what makes {HASH}/{ID-number} verifiable.
  const rebuilt = createRecord({
    id: submitted.id,
    submission: normalizeSubmission(submission, { maxCiphertextBytes: app.config.maxCiphertextBytes }),
    chainId: app.config.chainId,
    receivedAt: Date.parse(submitted.record.receivedAt),
  });
  assert.equal(rebuilt.ref, submitted.ref);
});
