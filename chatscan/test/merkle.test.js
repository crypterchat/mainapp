import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_MERKLE_ROOT, merkleRoot } from '../src/core/merkle.js';
import { x11Hex } from '../src/core/x11.js';

const leaf = (value) => x11Hex(value);

test('an empty block has the sentinel root', () => {
  assert.equal(merkleRoot([]), EMPTY_MERKLE_ROOT);
  assert.match(EMPTY_MERKLE_ROOT, /^[0-9a-f]{64}$/);
});

test('a single record is its own root', () => {
  const only = leaf('record-1');
  assert.equal(merkleRoot([only]), only);
});

test('roots depend on leaf order', () => {
  const a = leaf('a');
  const b = leaf('b');
  assert.notEqual(merkleRoot([a, b]), merkleRoot([b, a]));
});

test('an odd leaf count pairs the last leaf with itself', () => {
  const a = leaf('a');
  const b = leaf('b');
  const c = leaf('c');
  assert.equal(merkleRoot([a, b, c]), merkleRoot([a, b, c, c]));
});

test('roots are stable across calls', () => {
  const leaves = ['a', 'b', 'c', 'd', 'e'].map(leaf);
  assert.equal(merkleRoot(leaves), merkleRoot(leaves));
  assert.match(merkleRoot(leaves), /^[0-9a-f]{64}$/);
});
