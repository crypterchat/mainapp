import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_SUBMISSION_FIELDS,
  createRecord,
  formatRef,
  normalizeSubmission,
  parseRef,
  publicRecord,
} from '../src/core/records.js';

const limits = { maxCiphertextBytes: 4 * 1024 * 1024 };
const digest = 'a'.repeat(64);

const validSubmission = () => ({ ciphertextHash: digest, size: 512, protocol: 'C7' });

test('a valid submission is normalised with defaults', () => {
  const normalized = normalizeSubmission(validSubmission(), limits);
  assert.deepEqual(normalized, {
    ciphertextHash: digest,
    size: 512,
    protocol: 'C7',
    channelHash: null,
    nonce: '',
    fee: 0,
    appVersion: null,
    anchorTxid: null,
  });
});

test('hashes and protocols are case-insensitive', () => {
  const normalized = normalizeSubmission(
    { ciphertextHash: digest.toUpperCase(), size: 1, protocol: 'eth' },
    limits,
  );
  assert.equal(normalized.ciphertextHash, digest);
  assert.equal(normalized.protocol, 'ETH');
});

test('message content is refused by field name', () => {
  for (const field of ['content', 'body', 'text', 'message', 'plaintext', 'payload', 'ciphertext', 'attachments']) {
    const submission = { ...validSubmission(), [field]: 'hello' };
    assert.throws(
      () => normalizeSubmission(submission, limits),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.code, 'content_rejected');
        assert.equal(error.details.field, field);
        return true;
      },
      `expected "${field}" to be refused`,
    );
  }
});

test('unknown fields are refused so nothing sneaks into the index', () => {
  assert.throws(() => normalizeSubmission({ ...validSubmission(), senderPhone: '+123' }, limits), {
    code: 'unknown_field',
  });
});

test('only the documented fields are accepted', () => {
  assert.deepEqual(ALLOWED_SUBMISSION_FIELDS, [
    'ciphertextHash',
    'size',
    'protocol',
    'channelHash',
    'nonce',
    'fee',
    'appVersion',
    'anchorTxid',
  ]);
});

test('malformed submissions are rejected', () => {
  assert.throws(() => normalizeSubmission(null, limits), { code: 'invalid_body' });
  assert.throws(() => normalizeSubmission([], limits), { code: 'invalid_body' });
  assert.throws(() => normalizeSubmission({ size: 1 }, limits), { code: 'missing_field' });
  assert.throws(() => normalizeSubmission({ ciphertextHash: 'nope', size: 1 }, limits), { code: 'invalid_hash' });
  assert.throws(() => normalizeSubmission({ ciphertextHash: digest }, limits), { code: 'invalid_size' });
  assert.throws(() => normalizeSubmission({ ciphertextHash: digest, size: 0 }, limits), { code: 'invalid_size' });
  assert.throws(() => normalizeSubmission({ ciphertextHash: digest, size: 1.5 }, limits), { code: 'invalid_size' });
  assert.throws(() => normalizeSubmission({ ciphertextHash: digest, size: 1e12 }, limits), { code: 'invalid_size' });
  assert.throws(() => normalizeSubmission({ ...validSubmission(), protocol: 'BTC' }, limits), {
    code: 'unknown_protocol',
  });
  assert.throws(() => normalizeSubmission({ ...validSubmission(), nonce: 'zz' }, limits), { code: 'invalid_nonce' });
  assert.throws(() => normalizeSubmission({ ...validSubmission(), fee: -1 }, limits), { code: 'invalid_fee' });
  assert.throws(() => normalizeSubmission({ ...validSubmission(), appVersion: 'a'.repeat(64) }, limits), {
    code: 'invalid_app_version',
  });
});

test('records are addressed as {HASH}/{ID-number}', () => {
  const record = createRecord({
    id: 42,
    submission: normalizeSubmission(validSubmission(), limits),
    chainId: 'x11:test',
    receivedAt: 1_700_000_000_000,
  });

  assert.match(record.hash, /^[0-9a-f]{64}$/);
  assert.equal(record.ref, `${record.hash}/42`);
  assert.equal(record.ref, formatRef(record.hash, record.id));
  assert.deepEqual(parseRef(record.ref), { hash: record.hash, id: 42 });
});

test('the record hash is derived from the submission, not the clock alone', () => {
  const submission = normalizeSubmission(validSubmission(), limits);
  const base = { id: 1, submission, chainId: 'x11:test', receivedAt: 1_700_000_000_000 };

  assert.equal(createRecord(base).hash, createRecord(base).hash);
  assert.notEqual(createRecord(base).hash, createRecord({ ...base, id: 2 }).hash);
  assert.notEqual(createRecord(base).hash, createRecord({ ...base, receivedAt: 1 }).hash);
  assert.notEqual(createRecord(base).hash, createRecord({ ...base, chainId: 'x11:other' }).hash);
});

test('references are validated strictly', () => {
  assert.equal(parseRef(''), null);
  assert.equal(parseRef('deadbeef/1'), null);
  assert.equal(parseRef(`${digest}/0`), null);
  assert.equal(parseRef(`${digest}/-1`), null);
  assert.equal(parseRef(`${digest}/abc`), null);
  assert.equal(parseRef(`${digest}`), null);
  assert.deepEqual(parseRef(`${digest.toUpperCase()}/7`), { hash: digest, id: 7 });
});

test('the public projection exposes no content fields', () => {
  const record = createRecord({
    id: 1,
    submission: normalizeSubmission(validSubmission(), limits),
    chainId: 'x11:test',
    receivedAt: Date.now(),
  });
  const view = publicRecord(record);

  assert.equal(view.contentAvailable, false);
  assert.equal(view.encrypted, true);
  for (const key of ['content', 'body', 'text', 'message', 'plaintext', 'payload', 'ciphertext']) {
    assert.ok(!(key in view), `public record must not expose "${key}"`);
  }
});
