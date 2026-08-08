import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CDCI_P2P_PORTS,
  CDCI_RPC_PORTS,
  CdciRpc,
  CdciRpcError,
  defaultRpcUrl,
} from '../src/chain/cdci-rpc.js';
import { CdciStub } from './support/cdci-stub.js';
import { tempDataDir } from './helpers.js';

/**
 * @param {import('node:test').TestContext} t
 * @param {ConstructorParameters<typeof CdciStub>[0]} [options]
 */
async function stub(t, options) {
  const node = await new CdciStub(options).start();
  t.after(() => node.stop());
  return node;
}

test('the default ports match CDCI chainparams', () => {
  // src/chainparamsbase.cpp (RPC) and src/chainparams.cpp (P2P) in Centraldb/CDCI
  assert.deepEqual(CDCI_RPC_PORTS, { main: 13431, test: 23431, devnet: 19798, regtest: 19898 });
  assert.deepEqual(CDCI_P2P_PORTS, { main: 13432, test: 23432, devnet: 19799, regtest: 19899 });
  assert.equal(defaultRpcUrl('main'), 'http://127.0.0.1:13431/');
  assert.equal(defaultRpcUrl('regtest'), 'http://127.0.0.1:19898/');
});

test('a single call returns the result', async (t) => {
  const node = await stub(t);
  const rpc = new CdciRpc({ url: node.url });

  assert.equal(await rpc.call('getblockcount'), 3);
  assert.deepEqual(node.callsTo('getblockcount').length, 1);
});

test('a batch returns results in call order', async (t) => {
  const node = await stub(t);
  const rpc = new CdciRpc({ url: node.url });

  const [count, hash] = await rpc.batch([{ method: 'getblockcount' }, { method: 'getblockhash', params: [1] }]);
  assert.equal(count, 3);
  assert.match(hash, /^0000/);
});

test('RPC errors surface with the daemon code', async (t) => {
  const node = await stub(t);
  const rpc = new CdciRpc({ url: node.url });

  await assert.rejects(
    () => rpc.call('getblockhash', [99]),
    (error) => {
      assert.ok(error instanceof CdciRpcError);
      assert.equal(error.code, -8);
      assert.equal(error.method, 'getblockhash');
      assert.match(error.message, /out of range/);
      return true;
    },
  );
});

test('absence can be treated as null instead of an error', async (t) => {
  const node = await stub(t);
  const rpc = new CdciRpc({ url: node.url });

  assert.equal(await rpc.callAllowingAbsent('getblockhash', [99]), null);
  await assert.rejects(() => rpc.callAllowingAbsent('nosuchmethod', []));
});

test('an unreachable node reports a usable error', async () => {
  const rpc = new CdciRpc({ url: 'http://127.0.0.1:1/', timeoutMs: 250 });

  await assert.rejects(
    () => rpc.call('getblockcount'),
    (error) => {
      assert.ok(error instanceof CdciRpcError);
      assert.match(error.message, /unreachable|timed out/);
      assert.equal(error.toHttpError().status, 502);
      assert.equal(error.toHttpError().code, 'cdci_unavailable');
      return true;
    },
  );
});

test('user and password authenticate', async (t) => {
  const node = await stub(t, { auth: { user: 'cdci', password: 'secret' } });

  const anonymous = new CdciRpc({ url: node.url });
  await assert.rejects(() => anonymous.call('getblockcount'), /rejected the RPC credentials/);

  const authenticated = new CdciRpc({ url: node.url, user: 'cdci', password: 'secret' });
  assert.equal(await authenticated.call('getblockcount'), 3);
});

test('the node cookie file authenticates, and is re-read per call', async (t) => {
  const node = await stub(t, { auth: { user: '__cookie__', password: 'first' } });
  const cookieFile = path.join(tempDataDir(), '.cookie');
  fs.writeFileSync(cookieFile, '__cookie__:first\n');

  const rpc = new CdciRpc({ url: node.url, cookieFile });
  assert.equal(await rpc.call('getblockcount'), 3);

  // A node restart rotates the cookie; the client must pick the new one up.
  node.auth = { user: '__cookie__', password: 'second' };
  await assert.rejects(() => rpc.call('getblockcount'), /rejected the RPC credentials/);
  fs.writeFileSync(cookieFile, '__cookie__:second\n');
  assert.equal(await rpc.call('getblockcount'), 3);
});

test('a missing cookie file explains how to fix it', async () => {
  const rpc = new CdciRpc({ url: 'http://127.0.0.1:19898/', cookieFile: '/nonexistent/.cookie' });
  await assert.rejects(() => rpc.call('getblockcount'), /Could not read the CDCI cookie file/);
});
