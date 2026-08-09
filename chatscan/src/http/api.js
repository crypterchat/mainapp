import { timingSafeEqual } from 'node:crypto';

import {
  ANCHOR_MARKER,
  anchorCommitment,
  anchorPayloadHex,
  anchorPreimage,
  anchorScriptHex,
} from '../chain/commitment.js';
import { networkSnapshot } from '../core/network.js';
import { RECORD_STATUS, normalizeSubmission, parseRef, publicRecord } from '../core/records.js';
import { X11_ALGORITHM_ID, X11_ROUNDS } from '../core/x11.js';
import { badRequest, notFound, tooManyRequests, unauthorized } from '../util/errors.js';
import { readJsonBody, sendJson, writeHead } from './respond.js';

const MAX_PAGE_SIZE = 100;

/**
 * Public projection of a block, in the shape both backends normalise to.
 * @param {object} block
 */
export function publicBlock(block) {
  return {
    source: block.source,
    height: block.height,
    hash: block.hash,
    previousHash: block.previousHash,
    nextHash: block.nextHash ?? null,
    merkleRoot: block.merkleRoot,
    timestamp: new Date(block.timestamp).toISOString(),
    algorithm: block.algorithm,
    difficulty: block.difficulty,
    chainwork: block.chainwork ?? null,
    nonce: block.nonce,
    bits: block.bits ?? null,
    version: block.version ?? null,
    txCount: block.txCount,
    sizeBytes: block.sizeBytes,
    confirmations: block.confirmations ?? null,
    chainlock: block.chainlock ?? false,
    totalFees: block.totalFees ?? null,
    sealedBy: block.sealedBy ?? null,
    recordRefs: block.recordRefs ?? null,
  };
}

/**
 * Registers `/api/v1/*` routes.
 * @param {ReturnType<import('./router.js').createRouter>} router
 * @param {{ store: import('../store/store.js').ChatScanStore, node: import('../core/chain.js').ChatScanNode, config: import('../config.js').Config, limiter: import('./rate-limit.js').RateLimiter }} ctx
 */
export function registerApiRoutes(router, ctx) {
  const { store, chain, config, limiter } = ctx;

  router.get('/healthz', (req, res) => {
    sendJson(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/api/v1/status', async (req, res) => {
    sendJson(res, 200, await networkSnapshot({ store, config, chain }));
  });

  router.get('/api/v1/algorithm', (req, res) => {
    sendJson(res, 200, {
      algorithm: chain.mode === 'cdci' ? 'x11' : X11_ALGORITHM_ID,
      backend: chain.mode,
      rounds: X11_ROUNDS.map((round, index) => ({ order: index + 1, slot: round.slot, digest: round.digest })),
      reference: 'https://github.com/Centraldb/CDCI/blob/main/src/hash.h',
      note:
        chain.mode === 'cdci'
          ? 'Block hashes and proof of work come from the CDCI node, which runs the reference X11 primitives in C. The slot order above mirrors HashX11; the digests listed are what ChatScan uses for its own record hashes.'
          : 'Local development chain. Slot order mirrors CDCI HashX11; each slot is bound to a stand-in digest, so these hashes are not CDCI consensus hashes.',
    });
  });

  router.get('/api/v1/chain', async (req, res) => {
    sendJson(res, 200, await chain.chainInfo());
  });

  router.post('/api/v1/records', async (req, res, { clientKey }) => {
    requireIngestKey(req, config);

    const decision = limiter.consume(clientKey);
    if (!decision.allowed) {
      throw tooManyRequests(`Ingest limit is ${limiter.limit} records per minute.`);
    }

    const body = await readJsonBody(req, config.maxRequestBytes);
    const { record, accepted } = await chain.submit(body);

    sendJson(res, accepted ? 201 : 202, {
      ref: record.ref,
      hash: record.hash,
      id: record.id,
      status: record.status,
      rejectionReason: record.rejectionReason,
      commitment: record.commitment,
      anchor: publicRecord(record).anchor,
      explorerUrl: `/tx/${record.ref}`,
      record: publicRecord(record),
    });
  });

  router.get('/api/v1/records/:hash/:id/anchor', (req, res, { params }) => {
    const record = lookupRecord(store, `${params.hash}/${params.id}`);
    sendJson(res, 200, {
      ref: record.ref,
      ...anchorInstructions(record.commitment),
      anchor: publicRecord(record).anchor,
    });
  });

  /**
   * Preflight for a client that has encrypted a message but not yet submitted
   * it: returns the commitment to publish on CDCI so the anchor transaction can
   * be broadcast before the record is submitted.
   */
  router.post('/api/v1/anchor-payload', async (req, res) => {
    const body = await readJsonBody(req, config.maxRequestBytes);
    const submission = normalizeSubmission(body, { maxCiphertextBytes: config.maxCiphertextBytes });
    sendJson(res, 200, {
      chainId: config.chainId,
      preimage: anchorPreimage({ chainId: config.chainId, ...submission }),
      ...anchorInstructions(anchorCommitment({ chainId: config.chainId, ...submission })),
    });
  });

  router.get('/api/v1/records', (req, res, { query }) => {
    const { limit, offset } = pagination(query);
    const status = optionalStatus(query.get('status'));
    const protocol = query.get('protocol')?.toUpperCase() || undefined;
    const channelHash = normalizeHexQuery(query.get('channel'));

    const { items, total } = store.listRecords({ limit, offset, status, protocol, channelHash });
    sendJson(res, 200, {
      total,
      limit,
      offset,
      records: items.map(publicRecord),
    });
  });

  router.get('/api/v1/records/:hash/:id', (req, res, { params }) => {
    const record = lookupRecord(store, `${params.hash}/${params.id}`);
    sendJson(res, 200, { record: publicRecord(record) });
  });

  router.get('/api/v1/blocks', async (req, res, { query }) => {
    const { limit, offset } = pagination(query, 10);
    const { items, total } = await chain.listBlocks({ limit, offset });
    sendJson(res, 200, { total, limit, offset, blocks: items.map(publicBlock) });
  });

  router.get('/api/v1/blocks/:id', async (req, res, { params }) => {
    const block = await chain.getBlock(params.id);
    if (!block) throw notFound(`No block indexed at ${params.id}.`);
    sendJson(res, 200, {
      block: publicBlock(block),
      records: chain.recordsInBlock(block).map(publicRecord),
    });
  });

  router.get('/api/v1/search', async (req, res, { query }) => {
    const term = String(query.get('q') ?? '').trim();
    sendJson(res, 200, await search({ store, chain }, term));
  });

  router.get('/api/v1/stream', async (req, res) => {
    writeHead(res, 200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    write(res, 'status', await networkSnapshot({ store, config, chain }));

    const onRecord = (record) => write(res, 'record', publicRecord(record));
    const onBlock = (block) => write(res, 'block', publicBlock(block));
    const heartbeat = setInterval(() => {
      networkSnapshot({ store, config, chain })
        .then((snapshot) => write(res, 'status', snapshot))
        .catch(() => {
          /* the next heartbeat tries again */
        });
    }, Math.max(2000, Math.min(config.blockIntervalMs, 10_000)));
    heartbeat.unref?.();

    store.on('record', onRecord);
    store.on('block', onBlock);

    const cleanup = () => {
      clearInterval(heartbeat);
      store.off('record', onRecord);
      store.off('block', onBlock);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });
}

/**
 * What a client needs in order to publish one anchor on the CDCI chain.
 * @param {string} commitment
 */
function anchorInstructions(commitment) {
  return {
    commitment,
    marker: ANCHOR_MARKER,
    opReturnPayload: anchorPayloadHex(commitment),
    opReturnScript: anchorScriptHex(commitment),
    note: 'Publish this payload in an OP_RETURN output on the CDCI chain, then submit the record with the transaction id as "anchorTxid".',
  };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} event
 * @param {unknown} payload
 */
function write(res, event, payload) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Free-text lookup: a `{HASH}/{ID}` reference, a record hash, a block hash, an
 * anchor transaction id, a block height, or an ID-number.
 * @param {{ store: import('../store/store.js').ChatScanStore, chain: import('../chain/service.js').ChainService }} ctx
 * @param {string} term
 */
export async function search({ store, chain }, term, { tolerant = false } = {}) {
  if (!term) return { query: term, kind: 'empty', results: [] };
  const normalized = term.toLowerCase();

  const ref = parseRef(normalized);
  if (ref) {
    const record = store.getRecord(ref.hash, ref.id);
    return {
      query: term,
      kind: 'record-ref',
      results: record ? [{ type: 'record', url: `/tx/${record.ref}`, record: publicRecord(record) }] : [],
    };
  }

  if (/^[0-9a-f]{64}$/.test(normalized)) {
    const block = await chain.getBlock(normalized, { tolerant });
    if (block) {
      return {
        query: term,
        kind: 'block-hash',
        results: [{ type: 'block', url: `/block/${block.height}`, block: publicBlock(block) }],
      };
    }

    const byHash = store.getRecordsByHash(normalized);
    if (byHash.length > 0) {
      return {
        query: term,
        kind: 'record-hash',
        results: byHash.map((record) => ({ type: 'record', url: `/tx/${record.ref}`, record: publicRecord(record) })),
      };
    }

    // A 64-hex term that is neither a block nor a record hash may be the CDCI
    // anchor transaction of an indexed record.
    const byAnchor = store.records.filter((record) => record.anchor?.txid === normalized);
    if (byAnchor.length > 0) {
      return {
        query: term,
        kind: 'anchor-txid',
        results: byAnchor.map((record) => ({ type: 'record', url: `/tx/${record.ref}`, record: publicRecord(record) })),
      };
    }

    // Otherwise it may be a channel: the record page links a record's channel
    // here, and a chat app can list one conversation the same way.
    const byChannel = store.listRecords({ limit: 50, channelHash: normalized });
    return {
      query: term,
      kind: byChannel.total > 0 ? 'channel' : 'record-hash',
      results: byChannel.items.map((record) => ({
        type: 'record',
        url: `/tx/${record.ref}`,
        record: publicRecord(record),
      })),
    };
  }

  if (/^\d{1,15}$/.test(normalized)) {
    const value = Number.parseInt(normalized, 10);
    /** @type {object[]} */
    const results = [];
    const record = store.getRecordById(value);
    if (record) results.push({ type: 'record', url: `/tx/${record.ref}`, record: publicRecord(record) });
    const block = await chain.getBlock(value, { tolerant });
    if (block) results.push({ type: 'block', url: `/block/${block.height}`, block: publicBlock(block) });
    return { query: term, kind: 'number', results };
  }

  return { query: term, kind: 'unsupported', results: [] };
}

/**
 * @param {import('../store/store.js').ChatScanStore} store
 * @param {string} ref
 */
export function lookupRecord(store, ref) {
  const parsed = parseRef(ref);
  if (!parsed) {
    throw badRequest('invalid_ref', 'A record reference looks like {HASH}/{ID-number}, e.g. d700bc90.../42.');
  }
  const record = store.getRecord(parsed.hash, parsed.id);
  if (!record) throw notFound(`No message record indexed at ${ref}.`);
  return record;
}

/**
 * @param {import('../chain/service.js').ChainService} chain
 * @param {string} idOrHash
 */
export async function lookupBlock(chain, idOrHash) {
  const block = await chain.getBlock(String(idOrHash ?? '').toLowerCase());
  if (!block) throw notFound(`No block indexed at ${idOrHash}.`);
  return block;
}

/**
 * @param {URLSearchParams} query
 * @param {number} [defaultLimit]
 */
export function pagination(query, defaultLimit = 25) {
  const limit = clampInt(query.get('limit'), defaultLimit, 1, MAX_PAGE_SIZE);
  const offset = clampInt(query.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  return { limit, offset };
}

/**
 * @param {string | null} value
 */
function optionalStatus(value) {
  if (!value) return undefined;
  const status = value.toLowerCase();
  if (!Object.hasOwn(RECORD_STATUS, status)) {
    throw badRequest('invalid_status', `"status" must be one of: ${Object.keys(RECORD_STATUS).join(', ')}.`);
  }
  return status;
}

/** @param {string | null} value */
function normalizeHexQuery(value) {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw badRequest('invalid_channel', '"channel" must be a 64-character hex digest.');
  }
  return normalized;
}

/**
 * @param {string | null} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function clampInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Ingest is open when no keys are configured (local development) and key-gated
 * otherwise.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('../config.js').Config} config
 */
function requireIngestKey(req, config) {
  if (config.ingestKeys.length === 0) return;

  const header = String(req.headers.authorization ?? '');
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const presented = bearer || String(req.headers['x-chatscan-key'] ?? '');
  if (!presented) throw unauthorized();

  const matches = config.ingestKeys.some((key) => safeEqual(key, presented));
  if (!matches) throw unauthorized('The presented ingest key was not recognised.');
}

/**
 * @param {string} a
 * @param {string} b
 */
function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
