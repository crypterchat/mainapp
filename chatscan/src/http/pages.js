import { networkSnapshot } from '../core/network.js';
import { publicRecord } from '../core/records.js';
import { notFound } from '../util/errors.js';
import { lookupRecord, pagination, publicBlock, search } from './api.js';
import { sendHtml } from './respond.js';
import { renderPage } from './views/layout.js';
import {
  blockPage,
  blocksPage,
  errorPage,
  homePage,
  privacyPage,
  recordPage,
  searchPage,
} from './views/pages.js';

const HOME_RECORD_LIMIT = 12;
const HOME_BLOCK_LIMIT = 6;
const BLOCKS_PAGE_SIZE = 20;

/**
 * Registers the server-rendered explorer pages.
 * @param {ReturnType<import('./router.js').createRouter>} router
 * @param {{ store: import('../store/store.js').ChatScanStore, chain: import('../chain/service.js').ChainService, config: import('../config.js').Config }} ctx
 */
export function registerPageRoutes(router, ctx) {
  const { store, chain, config } = ctx;
  const snapshot = () => networkSnapshot({ store, config, chain });

  router.get('/', async (req, res) => {
    const [current, blocks] = await Promise.all([snapshot(), chain.listBlocks({ limit: HOME_BLOCK_LIMIT, tolerant: true })]);
    const records = store.listRecords({ limit: HOME_RECORD_LIMIT }).items.map(publicRecord);
    sendHtml(
      res,
      200,
      renderPage({
        title: 'ChatScan | Blockchain (Chat) Explorer',
        description:
          'ChatScan indexes end-to-end encrypted CrypterChat message records on the CDCI X11 blockchain. Every message is addressed as {HASH}/{ID-number} and its content is never viewable.',
        snapshot: current,
        body: homePage({ snapshot: current, records, blocks: blocks.items.map(publicBlock) }),
      }),
    );
  });

  const renderRecord = async (req, res, { params }) => {
    const record = publicRecord(lookupRecord(store, `${params.hash}/${params.id}`));
    const current = await snapshot();
    sendHtml(
      res,
      200,
      renderPage({
        title: `Record ${record.hash.slice(0, 12)}.../${record.id} | ChatScan`,
        description: `Encrypted message record ${record.ref} on the ChatScan explorer. Content is end-to-end encrypted and not viewable.`,
        snapshot: current,
        body: recordPage({ snapshot: current, record }),
      }),
    );
  };

  router.get('/tx/:hash/:id', renderRecord);
  router.get('/record/:hash/:id', renderRecord);

  router.get('/block/:id', async (req, res, { params }) => {
    const block = await chain.getBlock(params.id, { tolerant: true });
    if (!block) throw notFound(`No block indexed at ${params.id}.`);
    const records = chain.recordsInBlock(block).map(publicRecord);
    const current = await snapshot();
    sendHtml(
      res,
      200,
      renderPage({
        title: `Block #${block.height} | ChatScan`,
        description: `X11 block #${block.height} carries ${records.length} encrypted message records.`,
        snapshot: current,
        body: blockPage({ snapshot: current, block: publicBlock(block), records }),
      }),
    );
  });

  router.get('/blocks', async (req, res, { query }) => {
    const { offset } = pagination(query, BLOCKS_PAGE_SIZE);
    const [current, page] = await Promise.all([
      snapshot(),
      chain.listBlocks({ limit: BLOCKS_PAGE_SIZE, offset, tolerant: true }),
    ]);
    sendHtml(
      res,
      200,
      renderPage({
        title: 'X11 blocks | ChatScan',
        description: 'Blocks on the X11 chain ChatScan indexes.',
        snapshot: current,
        body: blocksPage({
          snapshot: current,
          blocks: page.items.map(publicBlock),
          total: page.total,
          offset,
          limit: BLOCKS_PAGE_SIZE,
        }),
      }),
    );
  });

  router.get('/search', async (req, res, { query }) => {
    const result = await search({ store, chain }, String(query.get('q') ?? '').trim(), { tolerant: true });
    const current = await snapshot();
    sendHtml(
      res,
      200,
      renderPage({
        title: result.query ? `Search "${result.query}" | ChatScan` : 'Search | ChatScan',
        description: 'Look up an encrypted message record, a block, or a height on the ChatScan explorer.',
        snapshot: current,
        body: searchPage({ snapshot: current, result }),
      }),
    );
  });

  router.get('/privacy', async (req, res) => {
    const current = await snapshot();
    sendHtml(
      res,
      200,
      renderPage({
        title: 'What ChatScan stores | ChatScan',
        description: 'The exact fields ChatScan indexes for an encrypted message, and everything it refuses.',
        snapshot: current,
        body: privacyPage({ snapshot: current }),
      }),
    );
  });
}

/**
 * Renders an HTML error page inside the explorer shell.
 * @param {import('node:http').ServerResponse} res
 * @param {{ store: import('../store/store.js').ChatScanStore, chain: import('../chain/service.js').ChainService, config: import('../config.js').Config }} ctx
 * @param {number} status
 * @param {string} message
 * @returns {Promise<void>}
 */
export async function sendErrorPage(res, ctx, status, message) {
  const current = await networkSnapshot({ store: ctx.store, config: ctx.config, chain: ctx.chain });
  sendHtml(
    res,
    status,
    renderPage({
      title: `${status} | ChatScan`,
      description: 'ChatScan Block Explorer',
      snapshot: current,
      body: errorPage({ snapshot: current, status, message }),
    }),
  );
}
