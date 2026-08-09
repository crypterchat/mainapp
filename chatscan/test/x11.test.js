import assert from 'node:assert/strict';
import test from 'node:test';

import {
  X11_DIGEST_BYTES,
  X11_ROUNDS,
  canonicalize,
  leadingZeroNibbles,
  meetsDifficulty,
  x11,
  x11Hex,
  x11Object,
} from '../src/core/x11.js';

test('the chain runs the eleven rounds in CDCI HashX11 order', () => {
  assert.equal(X11_ROUNDS.length, 11);
  // Mirrors HashX11 in https://github.com/Centraldb/CDCI/blob/main/src/hash.h
  assert.deepEqual(
    X11_ROUNDS.map((round) => round.slot),
    ['blake', 'bmw', 'groestl', 'skein', 'jh', 'keccak', 'luffa', 'cubehash', 'shavite', 'simd', 'echo'],
  );
});

test('digests are 32 bytes and deterministic', () => {
  const first = x11('crypterchat');
  const second = x11(Buffer.from('crypterchat'));
  assert.equal(first.length, X11_DIGEST_BYTES);
  assert.deepEqual(first, second);
  assert.match(x11Hex('crypterchat'), /^[0-9a-f]{64}$/);
});

test('different inputs produce different digests', () => {
  assert.notEqual(x11Hex('message-a'), x11Hex('message-b'));
});

test('canonicalize ignores key order', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
  assert.equal(x11Object({ id: 1, hash: 'ab' }), x11Object({ hash: 'ab', id: 1 }));
});

test('canonicalize distinguishes nested shapes', () => {
  assert.notEqual(canonicalize({ a: [1, 2] }), canonicalize({ a: [2, 1] }));
  assert.notEqual(canonicalize({ a: '1' }), canonicalize({ a: 1 }));
});

test('difficulty helpers count leading zero nibbles', () => {
  assert.equal(leadingZeroNibbles('00ab'), 2);
  assert.equal(leadingZeroNibbles('ab00'), 0);
  assert.ok(meetsDifficulty('000abc', 3));
  assert.ok(!meetsDifficulty('0abc', 2));
});
