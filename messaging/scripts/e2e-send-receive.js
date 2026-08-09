#!/usr/bin/env node
/**
 * End-to-end: two phone users send/receive through ChatScan.
 *
 *   node scripts/e2e-send-receive.js
 *
 * Requires messaging on :8787 and ChatScan on :3000.
 */
const base = process.env.MESSAGING_URL || 'http://127.0.0.1:8787';

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error || res.status}`);
  return data;
}

async function login(phone, displayName) {
  await api('/api/auth/request-otp', {
    method: 'POST',
    body: { phone, displayName },
  });
  const verified = await api('/api/auth/verify-otp', {
    method: 'POST',
    body: { phone, displayName, code: process.env.DEMO_OTP || '123456' },
  });
  return verified.token;
}

const alice = '+15550001111';
const bob = '+15550002222';

console.log('health…');
const health = await api('/api/health');
console.log('  chain', health.chatscan.chainId, 'height', health.chatscan.height);

console.log('login alice & bob…');
const aliceToken = await login(alice, 'Alice');
const bobToken = await login(bob, 'Bob');

const text = `hello from alice at ${new Date().toISOString()}`;
console.log('alice sends…');
const sent = await api('/api/messages/send', {
  method: 'POST',
  token: aliceToken,
  body: { to: bob, text },
});
console.log('  ref', sent.message.ref);
console.log('  explorer', sent.message.explorerUrl);
console.log('  chain contentAvailable', sent.chainRecord.contentAvailable);

if (sent.chainRecord.contentAvailable !== false) {
  throw new Error('ChatScan unexpectedly reports contentAvailable=true');
}

console.log('bob mailbox…');
const inbox = await api(
  `/api/messages?conversationId=${encodeURIComponent(sent.message.conversationId)}`,
  { token: bobToken },
);
const found = inbox.messages.find((m) => m.ref === sent.message.ref);
if (!found) throw new Error('Bob did not receive the envelope');
if (found.plaintext !== text) throw new Error(`Plaintext mismatch: ${found.plaintext}`);
console.log('  bob decrypted:', found.plaintext);

console.log('chain history…');
const history = await api(
  `/api/chain/history?conversationId=${encodeURIComponent(sent.message.conversationId)}`,
  { token: aliceToken },
);
const onChain = history.records.find((r) => r.ref === sent.message.ref);
if (!onChain) throw new Error('Message missing from ChatScan history');
if (onChain.contentAvailable !== false) throw new Error('History leaked contentAvailable');
console.log('  on-chain hash', onChain.ciphertextHash);
console.log('OK');
