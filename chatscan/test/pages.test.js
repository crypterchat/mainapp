import assert from 'node:assert/strict';
import test from 'node:test';

import { sampleSubmission, startTestServer } from './helpers.js';

/**
 * @param {Response} response
 */
async function html(response) {
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  return response.text();
}

test('the dashboard renders the ChatScan header and live figures', async (t) => {
  const app = await startTestServer({ CHATSCAN_SEALER_ENABLED: 'true' });
  t.after(() => app.close());

  const body = await html(await app.request('/'));

  assert.match(body, /ChatScan\.org \| Blockchain \(Chat\) Explorer/);
  assert.match(body, /For the people who value online privacy/);
  assert.match(body, /AT Fee:/);
  assert.match(body, /Unconfirmed TXS:/);
  assert.match(body, /tx Counts:/);
  assert.match(body, /Network Status/);
  assert.match(body, /24H Status/);
  assert.match(body, /Value \/ TX/);
  assert.match(body, /Server Active/);
  assert.match(body, /No message records indexed yet/);
});

test('records appear on the dashboard and link to their reference page', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const submitted = await (await app.submit(sampleSubmission())).json();
  const body = await html(await app.request('/'));

  assert.match(body, new RegExp(`/tx/${submitted.ref}`));
  assert.match(body, /Pending/);
  assert.match(body, /Protocol C7/);
});

test('the record page shows the {HASH}/{ID-number} reference and no content', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const submitted = await (await app.submit(sampleSubmission())).json();
  const body = await html(await app.request(`/tx/${submitted.ref}`));

  assert.match(body, new RegExp(submitted.ref));
  assert.match(body, /Content is not viewable/);
  assert.match(body, /End-to-end encrypted/);
  assert.match(body, /Ciphertext digest/);
  assert.match(body, /Awaiting the next sealed block/);

  // /record/... is an alias of /tx/...
  assert.equal((await app.request(`/record/${submitted.ref}`)).status, 200);
});

test('a confirmed record links to its block, and the block lists it', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const submitted = await (await app.submit(sampleSubmission())).json();
  app.node.sealBlock();

  const recordBody = await html(await app.request(`/tx/${submitted.ref}`));
  assert.match(recordBody, /Confirmed/);
  assert.match(recordBody, /\/block\/1/);

  const blockBody = await html(await app.request('/block/1'));
  assert.match(blockBody, /Block #1/);
  assert.match(blockBody, /Merkle root/);
  assert.match(blockBody, new RegExp(`/tx/${submitted.ref}`));

  const blocksBody = await html(await app.request('/blocks'));
  assert.match(blocksBody, /X11 blocks/);
  assert.match(blocksBody, /Block #1/);
});

test('search renders results for a reference', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const submitted = await (await app.submit(sampleSubmission())).json();
  const body = await html(await app.request(`/search?q=${submitted.ref}`));

  assert.match(body, /Matching records/);
  assert.match(body, new RegExp(`/tx/${submitted.ref}`));
});

test('search escapes untrusted queries', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const body = await html(await app.request('/search?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E'));

  assert.ok(!body.includes('<img src=x onerror=alert(1)>'));
  assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(body, /Nothing matched that query/);
});

test('the privacy page lists what is and is not stored', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const body = await html(await app.request('/privacy'));
  assert.match(body, /Indexed for every message/);
  assert.match(body, /Never accepted, never stored/);
  assert.match(body, /Decryption keys/);
});

test('unknown pages render the explorer 404', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await app.request('/tx/nope/1');
  assert.equal(response.status, 400);
  assert.match(await html(response), /Something went wrong|Not found on this chain/);

  const missing = await app.request(`/tx/${'b'.repeat(64)}/5`);
  assert.equal(missing.status, 404);
  assert.match(await html(missing), /Not found on this chain/);
});

test('static assets are served and traversal is refused', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const css = await app.request('/css/chatscan.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);

  const script = await app.request('/js/app.js');
  assert.equal(script.status, 200);

  const logo = await app.request('/images/crypterchat-logo.svg');
  assert.equal(logo.status, 200);

  assert.equal((await app.request('/../package.json')).status, 404);
  assert.equal((await app.request('/css/../../package.json')).status, 404);
  assert.equal((await app.request('/nope.css')).status, 404);
});
