import { ANCHOR_MARKER, ANCHOR_PAYLOAD_BYTES } from '../chain/commitment.js';
import { PROTOCOLS } from './records.js';
import { X11_ALGORITHM_ID, X11_ROUNDS } from './x11.js';

/**
 * Fee estimate in USD. The quote is a configured base rate scaled by mempool
 * pressure, so a backed-up node quotes a higher fee.
 * @param {{ pending: number }} stats
 * @param {import('../config.js').Config} config
 */
export function feeEstimate(stats, config) {
  const pressure = Math.min(stats.pending / Math.max(config.maxRecordsPerBlock, 1), 4);
  const estimate = config.feeQuoteUsd * (1 + pressure * 0.25);
  return {
    baseUsd: round(config.feeQuoteUsd, 3),
    estimateUsd: round(estimate, 3),
    pressure: round(pressure, 3),
  };
}

/**
 * Everything the explorer header and `/api/v1/status` need in one snapshot.
 *
 * In `cdci` mode the height, tip and difficulty come from the CDCI node; in
 * `local` mode they come from the development chain. Either way the shape is the
 * same, so the views do not care which backend is in use.
 *
 * @param {object} args
 * @param {import('../store/store.js').ChatScanStore} args.store
 * @param {import('../config.js').Config} args.config
 * @param {import('../chain/service.js').ChainService} args.chain
 * @param {number} [args.now]
 * @returns {Promise<object>}
 */
export async function networkSnapshot({ store, config, chain, now = Date.now() }) {
  const stats = store.stats(now);
  const chainInfo = await chain.chainInfo({ now });
  const isCdci = chainInfo.backend === 'cdci';

  const height = isCdci ? chainInfo.blocks : stats.height;
  const tipHash = isCdci ? chainInfo.bestBlockHash : stats.tipHash;
  const tipTimestamp = isCdci ? chainInfo.tipTime : stats.tipTimestamp;
  const tipAgeMs = tipTimestamp === null || tipTimestamp === undefined ? null : Math.max(0, now - tipTimestamp);

  const status = isCdci
    ? cdciStatus(chainInfo)
    : localStatus({ config, tipAgeMs, pending: stats.pending });

  const last24hBlocks = isCdci
    ? null
    : store.blocks.filter((block) => now - block.timestamp <= 24 * 60 * 60 * 1000).length;

  return {
    network: config.networkName,
    chainId: config.chainId,
    backend: chainInfo.backend,
    algorithm: isCdci ? 'x11' : X11_ALGORITHM_ID,
    algorithmRounds: X11_ROUNDS.map((round) => round.slot),
    status,
    chain: chainInfo,
    anchoring: {
      mode: chainInfo.anchorMode,
      marker: ANCHOR_MARKER,
      payloadBytes: ANCHOR_PAYLOAD_BYTES,
      confirmationsForFinality: chainInfo.confirmationsForFinality,
      required: isCdci ? config.cdci.requireAnchor : false,
    },
    sealer: {
      enabled: isCdci ? false : config.sealerEnabled,
      intervalMs: config.blockIntervalMs,
      maxRecordsPerBlock: config.maxRecordsPerBlock,
      difficultyNibbles: config.difficultyNibbles,
    },
    height,
    tipHash,
    tipAgeMs,
    blocks: isCdci ? (chainInfo.blocks === null ? 0 : chainInfo.blocks + 1) : stats.blocks,
    fee: feeEstimate(stats, config),
    unconfirmed: { count: stats.pending, bytes: stats.pendingBytes },
    throughput: { records: stats.records, tps: round(stats.tps, 2) },
    last24h: {
      records: stats.last24hCount,
      bytes: stats.last24hBytes,
      fees: round(stats.last24hFees, 8),
      blocks: last24hBlocks,
    },
    mempool: chainInfo.mempool,
    perRecord: {
      averageSizeBytes: stats.averageSize,
      averageFee: stats.records > 0 ? round(stats.last24hFees / Math.max(stats.last24hCount, 1), 8) : 0,
      confirmed: stats.confirmed,
      rejected: stats.rejected,
      anchored: stats.anchored,
      chainlocked: stats.chainlocked,
    },
    protocols: Object.values(PROTOCOLS).map((protocol) => ({
      id: protocol.id,
      label: protocol.label,
      maxCiphertextBytes: protocol.maxCiphertextBytes,
    })),
    privacy: {
      contentIndexed: false,
      note: 'ChatScan indexes ciphertext metadata only. Message content is end-to-end encrypted and never leaves the CrypterChat clients.',
    },
  };
}

/**
 * A CDCI-backed explorer is only as healthy as its node.
 * @param {any} chainInfo
 */
function cdciStatus(chainInfo) {
  if (!chainInfo.reachable) return 'offline';
  if (chainInfo.syncing) return 'syncing';
  return 'online';
}

/**
 * An idle local chain is healthy: the sealer only produces a block when records
 * are waiting, so a stale tip only matters while the mempool is backed up.
 * @param {{ config: import('../config.js').Config, tipAgeMs: number | null, pending: number }} args
 */
function localStatus({ config, tipAgeMs, pending }) {
  if (!config.sealerEnabled) return 'paused';
  if (tipAgeMs === null) return 'syncing';
  if (tipAgeMs > config.blockIntervalMs * 3 && pending > 0) return 'degraded';
  return 'online';
}

/**
 * @param {number} value
 * @param {number} digits
 */
function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
