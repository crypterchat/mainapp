#!/usr/bin/env node
/**
 * End-to-end OpenPGP + ChatScan check.
 *
 *   node scripts/e2e-pgp.js
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
  return api('/api/auth/verify-otp', {
    method: 'POST',
    body: { phone, displayName, code: process.env.DEMO_OTP || '123456' },
  });
}

const alicePhone = '+15557001111';
const bobPhone = '+15557002222';

console.log('privacy tools…');
const tools = await api('/api/privacy/tools');
if (!tools.tools.some((t) => t.id === 'pgp' && t.status === 'active')) {
  throw new Error('PGP tool not active');
}
console.log('  default', tools.defaultTool);

console.log('login…');
const alice = await login(alicePhone, 'Alice PGP');
const bob = await login(bobPhone, 'Bob PGP');
console.log('  alice fp', alice.pgp.fingerprint);
console.log('  bob fp', bob.pgp.fingerprint);

const text = `pgp sealed ${new Date().toISOString()}`;
console.log('alice sends with tool=pgp…');
const sent = await api('/api/messages/send', {
  method: 'POST',
  token: alice.token,
  body: { to: bobPhone, text, tool: 'pgp' },
});
if (sent.message.protocol !== 'PGP') throw new Error(`expected PGP, got ${sent.message.protocol}`);
if (sent.chainRecord.contentAvailable !== false) throw new Error('content leaked on chain');
console.log('  protocol', sent.message.protocol);
console.log('  ref', sent.message.ref);

const inbox = await api(
  `/api/messages?conversationId=${encodeURIComponent(sent.message.conversationId)}`,
  { token: bob.token },
);
const found = inbox.messages.find((m) => m.ref === sent.message.ref);
if (!found) throw new Error('Bob missing message');
if (found.plaintext !== text) throw new Error(`decrypt mismatch: ${found.plaintext}`);
if (found.tool !== 'pgp') throw new Error('tool not pgp');
console.log('  bob decrypted', found.plaintext);
console.log('  signatures', found.signatures);
console.log('OK');
