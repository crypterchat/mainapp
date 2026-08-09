import path from 'node:path';
import process from 'node:process';

import { defaultRpcUrl } from './chain/cdci-rpc.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function list(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Reads configuration from the environment once, at startup.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(env = process.env) {
  const dataDir = env.CHATSCAN_DATA_DIR
    ? path.resolve(env.CHATSCAN_DATA_DIR)
    : path.join(REPO_ROOT, 'data');

  const config = {
    repoRoot: REPO_ROOT,
    publicDir: path.join(REPO_ROOT, 'public'),
    dataDir,
    chainLogPath: path.join(dataDir, 'chain.jsonl'),

    host: env.CHATSCAN_HOST ?? '0.0.0.0',
    port: int(env.CHATSCAN_PORT ?? env.PORT, 3000),

    // Which chain the explorer indexes against:
    //   cdci  - the CDCI X11 blockchain (github.com/Centraldb/CDCI) over RPC
    //   local - a self-contained development chain, for working without a node
    backend: (env.CHATSCAN_CHAIN_BACKEND ?? 'local').toLowerCase(),

    cdci: {
      network: (env.CDCI_NETWORK ?? 'main').toLowerCase(),
      rpcUrl: env.CDCI_RPC_URL ?? '',
      rpcUser: env.CDCI_RPC_USER ?? '',
      rpcPassword: env.CDCI_RPC_PASSWORD ?? '',
      rpcCookieFile: env.CDCI_RPC_COOKIE_FILE ?? '',
      rpcTimeoutMs: int(env.CDCI_RPC_TIMEOUT_MS, 5000),
      // client - the CrypterChat client publishes its own anchor and submits the txid
      // wallet - ChatScan asks the node's wallet to publish anchors (spends coins)
      anchorMode: (env.CDCI_ANCHOR_MODE ?? 'client').toLowerCase(),
      requireAnchor: bool(env.CDCI_REQUIRE_ANCHOR, true),
      confirmationsForFinality: int(env.CDCI_CONFIRMATIONS_FOR_FINALITY, 6),
      anchorPollMs: int(env.CDCI_ANCHOR_POLL_MS, 30_000),
    },

    // Network identity shown in the UI. In cdci mode these follow the node.
    networkName: env.CHATSCAN_NETWORK ?? '',
    chainId: env.CHATSCAN_CHAIN_ID ?? '',

    // Consensus / sealing.
    blockIntervalMs: int(env.CHATSCAN_BLOCK_INTERVAL_MS, 15_000),
    maxRecordsPerBlock: int(env.CHATSCAN_MAX_RECORDS_PER_BLOCK, 64),
    difficultyNibbles: int(env.CHATSCAN_DIFFICULTY_NIBBLES, 2),
    sealerEnabled: bool(env.CHATSCAN_SEALER_ENABLED, true),
    sealedBy: env.CHATSCAN_SEALED_BY ?? 'chatscan-local-sealer',

    // Ingest limits. Only ciphertext *metadata* is ever accepted, so bodies are tiny.
    maxRequestBytes: int(env.CHATSCAN_MAX_REQUEST_BYTES, 16 * 1024),
    maxCiphertextBytes: int(env.CHATSCAN_MAX_CIPHERTEXT_BYTES, 4 * 1024 * 1024),
    ingestKeys: list(env.CHATSCAN_INGEST_KEYS),
    ingestRatePerMinute: int(env.CHATSCAN_INGEST_RATE_PER_MINUTE, 600),

    // Presentation-only values, surfaced in the explorer header.
    feeQuoteUsd: Number(env.CHATSCAN_FEE_QUOTE_USD ?? '21.546'),
    persist: bool(env.CHATSCAN_PERSIST, true),
    logLevel: env.CHATSCAN_LOG_LEVEL ?? 'info',
  };

  if (!['local', 'cdci'].includes(config.backend)) {
    throw new Error(`CHATSCAN_CHAIN_BACKEND must be "local" or "cdci", received "${config.backend}".`);
  }
  if (config.backend === 'cdci' && !CDCI_NETWORKS.includes(config.cdci.network)) {
    throw new Error(`CDCI_NETWORK must be one of ${CDCI_NETWORKS.join(', ')}, received "${config.cdci.network}".`);
  }
  if (config.backend === 'cdci' && !['client', 'wallet'].includes(config.cdci.anchorMode)) {
    throw new Error(`CDCI_ANCHOR_MODE must be "client" or "wallet", received "${config.cdci.anchorMode}".`);
  }

  if (!config.cdci.rpcUrl) config.cdci.rpcUrl = defaultRpcUrl(config.cdci.network);
  if (config.backend === 'cdci' && !config.cdci.rpcUser && !config.cdci.rpcCookieFile) {
    config.cdci.rpcCookieFile = defaultCookieFile(config.cdci.network);
  }

  // In cdci mode the node is the source of truth for chain identity.
  if (!config.networkName) config.networkName = config.backend === 'cdci' ? `cdci-${config.cdci.network}` : 'x11-local';
  if (!config.chainId) config.chainId = config.backend === 'cdci' ? `cdci:${config.cdci.network}` : 'x11:local';

  return config;
}

const CDCI_NETWORKS = ['main', 'test', 'devnet', 'regtest'];

/**
 * Where `centraldatabased` writes its RPC cookie: the data directory for
 * mainnet, a network subdirectory otherwise (see CDCI's CBaseChainParams).
 * @param {string} network
 */
function defaultCookieFile(network) {
  const dataDir = path.join(process.env.HOME ?? '', '.centraldatabasecore');
  const subDirectory = { main: '', test: 'testnet3', devnet: 'devnet', regtest: 'regtest' }[network] ?? '';
  return path.join(dataDir, subDirectory, '.cookie');
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
