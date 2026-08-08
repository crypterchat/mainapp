import process from 'node:process';

import { ChainService } from './chain/service.js';
import { loadConfig } from './config.js';
import { createServer } from './http/server.js';
import { ChatScanStore } from './store/store.js';

/**
 * Wires up a ChatScan node: replay the chain log, connect the chain backend,
 * serve HTTP.
 * @param {import('./config.js').Config} [config]
 */
export function createApp(config = loadConfig()) {
  const store = new ChatScanStore({ chainLogPath: config.chainLogPath, persist: config.persist }).replay();
  const chain = new ChainService({ store, config });
  const server = createServer({ store, chain, config });
  return { config, store, chain, node: chain.node, server };
}

/** Starts the explorer and installs shutdown handlers. */
export async function main() {
  const app = createApp();
  const { config, chain, server, store } = app;

  chain.start();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.log(`ChatScan Block Explorer listening on http://${config.host}:${port}`);
  console.log(`  backend: ${config.backend}`);
  if (config.backend === 'cdci') {
    console.log(`  cdci:    ${config.cdci.network} via ${config.cdci.rpcUrl}`);
    console.log(`  anchors: ${config.cdci.anchorMode} mode, required=${config.cdci.requireAnchor}`);
    await reportCdciNode(chain, config);
  } else {
    console.log(`  network: ${config.networkName} (${config.chainId})`);
    console.log(`  height:  ${store.tip()?.height ?? 0}`);
    console.log(`  sealer:  ${config.sealerEnabled ? `every ${config.blockIntervalMs}ms` : 'disabled'}`);
  }
  console.log(`  records: ${store.records.length}`);
  console.log(`  ingest:  ${config.ingestKeys.length > 0 ? 'key required' : 'open (no CHATSCAN_INGEST_KEYS set)'}`);

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down.`);
    chain.stop();
    await new Promise((resolve) => server.close(resolve));
    await store.flush();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return app;
}

/**
 * Reports whether the CDCI node answered, without preventing startup: the
 * explorer stays useful while a node is still starting or syncing.
 * @param {ChainService} chain
 * @param {import('./config.js').Config} config
 */
async function reportCdciNode(chain, config) {
  const info = await chain.chainInfo();
  if (!info.reachable) {
    console.warn(`  WARNING: ${info.error}`);
    console.warn('  The explorer is up, but it cannot read the chain until centraldatabased answers.');
    console.warn('  See docs/CDCI.md for how to run the node and expose its RPC interface.');
    return;
  }
  console.log(`  chain:   ${info.chain} at height ${info.blocks} (${info.subversion ?? 'unknown version'})`);
  if (info.syncing) console.log('  note:    the node is still syncing; heights will move.');

  const genesis = await chain.cdci.genesisHash().catch(() => null);
  const { CDCI_GENESIS_HASH } = await import('./chain/cdci-rpc.js');
  const expected = CDCI_GENESIS_HASH[config.cdci.network];
  if (expected && genesis && genesis !== expected) {
    console.warn(`  WARNING: the node's genesis hash ${genesis} is not CDCI ${config.cdci.network} (${expected}).`);
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error('ChatScan failed to start:', error);
    process.exit(1);
  });
}
