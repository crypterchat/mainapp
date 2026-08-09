import {
  formatBytes,
  formatDecimal,
  formatNumber,
  formatRelativeTime,
  formatTimestamp,
  formatUsd,
  shortHash,
} from '../../util/format.js';
import { html } from '../../util/html.js';
import {
  blockTable,
  breadcrumb,
  detailTable,
  metricCard,
  networkBreadcrumb,
  notice,
  protocolRows,
  recordTable,
  searchForm,
  serverToggle,
  statusAlert,
} from './components.js';
import { blockIcon, lockIcon } from './icons.js';
import { CRYPTERCHAT_URL, REPO_URL } from './layout.js';

/**
 * Shared page header: logo, title, live network breadcrumb, search.
 * @param {object} args
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 * @param {string} args.heading
 * @param {import('../../util/html.js').SafeHtml} args.aside
 * @param {import('../../util/html.js').SafeHtml} [args.breadcrumbs]
 */
function pageHeader({ snapshot, heading, aside, breadcrumbs }) {
  return html`<div class="f-margin-bottom-64">
    <div class="w-layout-grid f-header-grid-asymmetrical">
      <div class="f-max-width-large">
        <div class="f-margin-bottom-12">
          <a href="/" class="w-inline-block">
            <img src="/images/crypterchat-logo.svg" width="124" alt="CrypterChat" class="f-logo" />
          </a>
          <div class="f-heading-detail-small">ChatScan.org | Blockchain (Chat) Explorer</div>
        </div>
        ${breadcrumbs ?? networkBreadcrumb(snapshot)}
        <h1 class="f-h3-heading">${heading}</h1>
      </div>
      <div>${aside}</div>
    </div>
  </div>`;
}

/**
 * Detail rows for the chain card: CDCI node figures, or the local chain's.
 * @param {any} snapshot
 */
function chainRows(snapshot) {
  const chain = snapshot.chain;
  if (chain.backend !== 'cdci') {
    return [
      { label: 'Chain ID', value: snapshot.chainId },
      { label: 'Algorithm', value: snapshot.algorithm },
      { label: 'Tip hash', value: snapshot.tipHash ? shortHash(snapshot.tipHash) : '-' },
      { label: 'Last block', value: formatRelativeTime(Date.now() - (snapshot.tipAgeMs ?? 0)) },
      { label: 'Seal interval', value: `${Math.round(snapshot.sealer.intervalMs / 1000)}s` },
      { label: 'Difficulty', value: `${snapshot.sealer.difficultyNibbles} leading zero nibbles` },
    ];
  }

  return [
    { label: 'Chain', value: `CDCI ${chain.chain}` },
    { label: 'Algorithm', value: 'X11 (11 rounds)' },
    { label: 'Tip hash', value: chain.bestBlockHash ? shortHash(chain.bestBlockHash) : '-' },
    {
      label: 'Last block',
      value: chain.tipTime ? formatRelativeTime(chain.tipTime) : 'unknown',
    },
    { label: 'Difficulty', value: chain.difficulty === null ? '-' : formatDecimal(chain.difficulty, 3) },
    { label: 'Peers', value: chain.peers === null ? '-' : formatNumber(chain.peers) },
    {
      label: 'CDCI mempool',
      value: `${formatNumber(chain.mempool.size)} tx (${formatBytes(chain.mempool.bytes)})`,
    },
    {
      label: 'ChainLock',
      value: chain.chainlock?.height ? `height ${formatNumber(chain.chainlock.height)}` : 'none',
    },
    { label: 'Node', value: chain.subversion ?? 'unknown' },
  ];
}

/**
 * Right-hand header column on the home page.
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} snapshot
 */
function homeAside(snapshot) {
  return html`<div>
    <div class="f-margin-bottom-32">
      ${serverToggle(snapshot)}
      <p class="f-paragraph-large">
        <sub>
          This is standard on your CrypterChat app. It's a new way to securely transmit data without anyone being able
          to spy on it. The app is decentralized, and this is the blockchain of the app, where anyone can contribute.
        </sub>
      </p>
    </div>
    <div class="f-margin-bottom-32">${searchForm()}</div>
    <div class="f-button-wrapper">
      <a href="${CRYPTERCHAT_URL}" class="f-button-neutral w-inline-block" rel="noopener noreferrer">
        <div>Download the CC app</div>
      </a>
      <a href="${REPO_URL}/blob/main/docs/API.md" class="f-button-facebook w-inline-block" rel="noopener noreferrer">
        <div>Submit records via API</div>
      </a>
    </div>
  </div>`;
}

/**
 * @param {object} args
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 * @param {ReturnType<import('../../core/records.js').publicRecord>[]} args.records
 * @param {ReturnType<import('../api.js').publicBlock>[]} args.blocks
 */
export function homePage({ snapshot, records, blocks }) {
  const statusLabels = {
    online: 'Online',
    degraded: 'Degraded',
    syncing: 'Syncing',
    paused: 'Paused',
    offline: 'Node offline',
  };

  return html`<div class="f-section-large">
      <div class="f-container-regular">
        ${pageHeader({
          snapshot,
          heading: 'For the people who value online privacy',
          aside: homeAside(snapshot),
        })}
        ${snapshot.chain.backend === 'cdci' && !snapshot.chain.reachable
          ? html`<div class="f-margin-bottom-32">
              ${notice(
                blockIcon,
                'The CDCI node is not answering',
                `${snapshot.chain.error} Records already indexed are still browsable; new anchors cannot be verified until the node is back.`,
              )}
            </div>`
          : ''}
        <div class="w-layout-grid f-grid-three-column">
          ${metricCard({
            title: snapshot.chain.backend === 'cdci' ? 'CDCI Network' : 'Network Status',
            value: statusLabels[snapshot.status] ?? snapshot.status,
            caption: `Height ${formatNumber(snapshot.height ?? 0)} on ${snapshot.network}`,
            liveKey: 'network-status',
            rows: chainRows(snapshot),
          })}
          ${metricCard({
            title: '24H Status',
            value: `${formatNumber(snapshot.last24h.records)} records`,
            caption: `${formatBytes(snapshot.last24h.bytes)} of ciphertext indexed`,
            liveKey: 'records24h',
            rows: [
              { label: 'Records', value: formatNumber(snapshot.last24h.records) },
              snapshot.chain.backend === 'cdci'
                ? { label: 'Anchored on CDCI', value: formatNumber(snapshot.perRecord.anchored) }
                : { label: 'Blocks sealed', value: formatNumber(snapshot.last24h.blocks ?? 0) },
              { label: 'Ciphertext', value: formatBytes(snapshot.last24h.bytes) },
              { label: 'Fees', value: formatDecimal(snapshot.last24h.fees, 4) },
              { label: 'Confirmed', value: formatNumber(snapshot.perRecord.confirmed) },
              snapshot.chain.backend === 'cdci'
                ? { label: 'ChainLocked', value: formatNumber(snapshot.perRecord.chainlocked) }
                : { label: 'Rejected', value: formatNumber(snapshot.perRecord.rejected) },
            ],
          })}
          ${metricCard({
            title: 'Value / TX',
            value: formatBytes(snapshot.perRecord.averageSizeBytes),
            caption: 'Average ciphertext size per message record',
            liveKey: 'avgsize',
            rows: [
              { label: 'AT fee estimate', value: formatUsd(snapshot.fee.estimateUsd) },
              { label: 'Base fee', value: formatUsd(snapshot.fee.baseUsd) },
              { label: 'Mempool pressure', value: formatDecimal(snapshot.fee.pressure, 2) },
              { label: 'Average fee', value: formatDecimal(snapshot.perRecord.averageFee, 4) },
              { label: 'Unconfirmed', value: formatNumber(snapshot.unconfirmed.count) },
              { label: 'Throughput', value: `${snapshot.throughput.tps} TPS` },
            ],
          })}
        </div>
      </div>
    </div>
    <div class="f-section-large f-section-muted">
      <div class="f-container-regular">
        <div class="f-margin-bottom-32">
          ${notice(
            lockIcon,
            'Message content is never indexed',
            snapshot.chain.backend === 'cdci'
              ? `Every entry below is a message record referenced as {HASH}/{ID-number} and anchored on the CDCI X11 chain by an OP_RETURN commitment (${snapshot.anchoring.marker} + 32 bytes). CrypterChat encrypts message content end-to-end on the client, so neither ChatScan nor the chain ever holds anything but a digest.`
              : 'Every entry below is a message record referenced as {HASH}/{ID-number}. CrypterChat encrypts message content end-to-end on the client, so ChatScan only ever receives a ciphertext digest, its size and routing metadata.',
          )}
        </div>
        ${recordTable(records)}
        <div class="f-margin-bottom-48">${blockTable(blocks)}</div>
        <div class="f-button-wrapper">
          <a href="/blocks" class="f-button-secondary w-inline-block"><div>Browse all blocks</div></a>
          <a href="/privacy" class="f-button-secondary w-inline-block"><div>What ChatScan stores</div></a>
        </div>
      </div>
    </div>`;
}

/**
 * @param {object} args
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 * @param {ReturnType<import('../../core/records.js').publicRecord>} args.record
 */
export function recordPage({ snapshot, record }) {
  return html`<div class="f-section-large">
    <div class="f-container-regular">
      ${pageHeader({
        snapshot,
        heading: 'Message record',
        breadcrumbs: breadcrumb([
          { label: 'Records', href: '/' },
          { label: `#${record.id}` },
        ]),
        aside: html`<div>
          <div class="f-margin-bottom-32">${statusAlert(record.status, record.rejectionReason ?? undefined)}</div>
          <div class="f-margin-bottom-32">${searchForm()}</div>
          <div class="f-button-wrapper">
            <a href="/api/v1/records/${record.ref}" class="f-button-secondary w-inline-block"><div>View JSON</div></a>
            ${record.blockHeight === null
              ? ''
              : html`<a href="/block/${record.blockHeight}" class="f-button-secondary w-inline-block"
                  ><div>Block #${record.blockHeight}</div></a
                >`}
          </div>
        </div>`,
      })}
      <div class="f-margin-bottom-32">
        <div class="f-heading-detail-small">Explorer reference</div>
        <div class="f-record-ref f-mono" data-copy-source>${record.ref}</div>
        <button class="f-copy-button" type="button" data-copy-button>Copy reference</button>
      </div>
      <div class="f-margin-bottom-32">
        ${notice(
          lockIcon,
          'Content is not viewable',
          'This message is end-to-end encrypted between CrypterChat clients. ChatScan stores the ciphertext digest below, never the ciphertext itself and never the plaintext, so there is nothing here that can be decrypted by the explorer or its operators.',
        )}
      </div>
      ${snapshot.chain.backend === 'cdci'
        ? html`<div class="f-margin-bottom-48">
            <h2 class="f-h5-heading f-margin-bottom-16">CDCI anchor</h2>
            ${anchorRows(snapshot, record)}
          </div>`
        : ''}
      ${detailTable([
        { key: 'Reference', value: html`<span class="f-mono">${record.ref}</span>` },
        { key: 'Record hash (X11)', value: html`<span class="f-mono">${record.hash}</span>` },
        { key: 'ID number', value: formatNumber(record.id) },
        { key: 'Status', value: record.status },
        ...(record.rejectionReason ? [{ key: 'Rejection reason', value: record.rejectionReason }] : []),
        { key: 'Ciphertext digest', value: html`<span class="f-mono">${record.ciphertextHash}</span>` },
        { key: 'Ciphertext size', value: `${formatBytes(record.size)} (${formatNumber(record.size)} bytes)` },
        { key: 'Protocol', value: `${record.protocolLabel} (${record.protocol})` },
        {
          key: 'Channel',
          value: record.channelHash
            ? html`<a class="f-mono f-mono-link" href="/search?q=${record.channelHash}">${record.channelHash}</a>`
            : 'Not disclosed',
        },
        { key: 'Fee', value: formatDecimal(record.fee, 8) },
        { key: 'Client version', value: record.appVersion ?? 'Not disclosed' },
        {
          key: 'Received',
          value: `${formatTimestamp(record.receivedAt)} (${formatRelativeTime(record.receivedAt)})`,
        },
        {
          key: 'Confirmed',
          value: record.confirmedAt
            ? `${formatTimestamp(record.confirmedAt)} (${formatRelativeTime(record.confirmedAt)})`
            : 'Awaiting the next sealed block',
        },
        {
          key: 'Block',
          value:
            record.blockHeight === null
              ? 'Pending'
              : html`<a class="f-mono-link" href="/block/${record.blockHeight}">#${record.blockHeight}</a>
                  <span class="f-mono f-text-color-gray-500"> ${shortHash(record.blockHash ?? '')}</span>`,
        },
        { key: 'Index in block', value: record.indexInBlock === null ? '-' : formatNumber(record.indexInBlock) },
        { key: 'Content', value: html`<span class="f-tag f-tag-encrypted">End-to-end encrypted &middot; not stored</span>` },
      ])}
    </div>
  </div>`;
}

/**
 * The CDCI anchor for one record: the commitment it publishes and where that
 * transaction sits on the chain.
 * @param {any} snapshot
 * @param {any} record
 */
function anchorRows(snapshot, record) {
  const anchor = record.anchor;
  if (!anchor) {
    return notice(
      lockIcon,
      'Not anchored yet',
      `This record has no CDCI anchor transaction. Publish an OP_RETURN carrying commitment ${record.commitment} and submit its transaction id as "anchorTxid".`,
    );
  }

  const finalityLabels = {
    mempool: 'In the CDCI mempool, not yet in a block',
    confirmed: 'Confirmed in a block',
    final: `Final (at least ${snapshot.anchoring.confirmationsForFinality} confirmations)`,
    chainlocked: 'Final (ChainLocked by the CDCI masternode quorum)',
    unknown: 'Not verified against the node yet',
  };

  return detailTable([
    {
      key: 'Anchor transaction',
      value: html`<a class="f-mono f-mono-link" href="/search?q=${anchor.txid}">${anchor.txid}</a>`,
    },
    { key: 'Commitment', value: html`<span class="f-mono">${record.commitment}</span>` },
    { key: 'OP_RETURN marker', value: snapshot.anchoring.marker },
    { key: 'Output index', value: anchor.outputIndex === null ? '-' : formatNumber(anchor.outputIndex) },
    { key: 'Confirmations', value: formatNumber(anchor.confirmations) },
    { key: 'ChainLock', value: anchor.chainlock ? 'Yes' : 'No' },
    { key: 'Finality', value: finalityLabels[anchor.finality] ?? anchor.finality },
    {
      key: 'CDCI block',
      value:
        anchor.blockHeight === null
          ? 'Pending'
          : html`<a class="f-mono-link" href="/block/${anchor.blockHeight}">#${anchor.blockHeight}</a>
              <span class="f-mono f-text-color-gray-500"> ${shortHash(anchor.blockHash ?? '')}</span>`,
    },
    { key: 'Last checked', value: anchor.verifiedAt ? formatRelativeTime(anchor.verifiedAt) : 'never' },
  ]);
}

/**
 * @param {object} args
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 * @param {ReturnType<import('../api.js').publicBlock>} args.block
 * @param {ReturnType<import('../../core/records.js').publicRecord>[]} args.records
 */
export function blockPage({ snapshot, block, records }) {
  return html`<div class="f-section-large">
    <div class="f-container-regular">
      ${pageHeader({
        snapshot,
        heading: `Block #${block.height}`,
        breadcrumbs: breadcrumb([
          { label: 'Blocks', href: '/blocks' },
          { label: `#${block.height}` },
        ]),
        aside: html`<div>
          <div class="f-margin-bottom-32">
            ${notice(
              blockIcon,
              block.source === 'cdci'
                ? `${formatNumber(records.length)} anchored message records`
                : `${formatNumber(block.txCount)} message records`,
              block.source === 'cdci'
                ? `CDCI block found ${formatRelativeTime(block.timestamp)} with ${formatNumber(block.txCount)} transactions, of which ${formatNumber(records.length)} carry ChatScan anchors.`
                : `Sealed ${formatRelativeTime(block.timestamp)} under ${block.algorithm} at difficulty ${block.difficulty}.`,
            )}
          </div>
          <div class="f-margin-bottom-32">${searchForm()}</div>
          <div class="f-button-wrapper">
            ${block.height > 0
              ? html`<a href="/block/${block.height - 1}" class="f-button-secondary w-inline-block"
                  ><div>Previous block</div></a
                >`
              : ''}
            ${snapshot.height !== null && block.height < snapshot.height
              ? html`<a href="/block/${block.height + 1}" class="f-button-secondary w-inline-block"
                  ><div>Next block</div></a
                >`
              : ''}
            <a href="/api/v1/blocks/${block.height}" class="f-button-secondary w-inline-block"><div>View JSON</div></a>
          </div>
        </div>`,
      })}
      <div class="f-margin-bottom-48">${detailTable(blockRows(block))}</div>
      ${recordTable(
        records,
        block.source === 'cdci'
          ? `Message records anchored in block #${block.height}`
          : `Records in block #${block.height}`,
      )}
    </div>
  </div>`;
}

/**
 * Detail rows for a block, covering both the CDCI and local shapes.
 * @param {any} block
 */
function blockRows(block) {
  const rows = [
    { key: 'Height', value: formatNumber(block.height) },
    { key: 'Block hash', value: html`<span class="f-mono">${block.hash}</span>` },
    {
      key: 'Previous hash',
      value:
        block.height === 0
          ? html`<span class="f-mono">${block.previousHash}</span>`
          : html`<a class="f-mono f-mono-link" href="/block/${block.height - 1}">${block.previousHash}</a>`,
    },
    { key: 'Merkle root', value: html`<span class="f-mono">${block.merkleRoot}</span>` },
    { key: 'Timestamp', value: `${formatTimestamp(block.timestamp)} (${formatRelativeTime(block.timestamp)})` },
    { key: 'Algorithm', value: block.algorithm === 'x11' ? 'X11 (CDCI proof of work)' : block.algorithm },
  ];

  if (block.source === 'cdci') {
    rows.push(
      { key: 'Transactions', value: formatNumber(block.txCount) },
      { key: 'Block size', value: formatBytes(block.sizeBytes) },
      { key: 'Difficulty', value: block.difficulty === null ? '-' : formatDecimal(block.difficulty, 6) },
      { key: 'Chainwork', value: block.chainwork ? html`<span class="f-mono">${block.chainwork}</span>` : '-' },
      { key: 'Bits', value: block.bits ?? '-' },
      { key: 'Nonce', value: formatNumber(block.nonce) },
      { key: 'Confirmations', value: block.confirmations === null ? '-' : formatNumber(block.confirmations) },
      { key: 'ChainLock', value: block.chainlock ? 'Yes' : 'No' },
    );
    return rows;
  }

  rows.push(
    { key: 'Records', value: formatNumber(block.txCount) },
    { key: 'Ciphertext size', value: formatBytes(block.sizeBytes) },
    { key: 'Total fees', value: formatDecimal(block.totalFees ?? 0, 8) },
    { key: 'Difficulty', value: `${block.difficulty} leading zero nibbles` },
    { key: 'Nonce', value: formatNumber(block.nonce) },
    { key: 'Sealed by', value: block.sealedBy ?? '-' },
  );
  return rows;
}

/**
 * @param {object} args
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 * @param {ReturnType<import('../api.js').publicBlock>[]} args.blocks
 * @param {number} args.total
 * @param {number} args.offset
 * @param {number} args.limit
 */
export function blocksPage({ snapshot, blocks, total, offset, limit }) {
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;
  return html`<div class="f-section-large">
    <div class="f-container-regular">
      ${pageHeader({
        snapshot,
        heading: 'X11 blocks',
        breadcrumbs: breadcrumb([{ label: 'Blocks' }]),
        aside: html`<div>
          <div class="f-margin-bottom-32">${serverToggle(snapshot)}</div>
          <div class="f-margin-bottom-32">${searchForm()}</div>
        </div>`,
      })}
      ${blockTable(blocks)}
      <div class="f-pagination">
        ${hasPrevious
          ? html`<a class="f-button-secondary w-inline-block" href="/blocks?offset=${Math.max(0, offset - limit)}"
              ><div>Newer</div></a
            >`
          : ''}
        ${hasNext
          ? html`<a class="f-button-secondary w-inline-block" href="/blocks?offset=${offset + limit}"
              ><div>Older</div></a
            >`
          : ''}
        <div class="f-stat-caption">${formatNumber(total)} blocks sealed</div>
      </div>
    </div>
  </div>`;
}

/**
 * @param {object} args
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 * @param {ReturnType<import('../api.js').search>} args.result
 */
export function searchPage({ snapshot, result }) {
  const hints = html`<div class="f-empty-state">
    <div class="f-paragraph-regular f-text-weight-medium">Nothing matched that query</div>
    <div class="f-paragraph-small f-text-color-gray-500">
      ChatScan looks up a record reference (<span class="f-mono">{HASH}/{ID-number}</span>), a 64-character record hash,
      block hash, anchor transaction id or channel hash, a block height, or a record ID-number.
    </div>
  </div>`;

  const titles = {
    channel: 'Records in this channel',
    'anchor-txid': 'Records anchored by this transaction',
  };

  return html`<div class="f-section-large">
    <div class="f-container-regular">
      ${pageHeader({
        snapshot,
        heading: result.query ? `Results for "${result.query}"` : 'Search ChatScan',
        breadcrumbs: breadcrumb([{ label: 'Search' }]),
        aside: html`<div>
          <div class="f-margin-bottom-32">${searchForm(result.query ?? '')}</div>
          <div class="f-stat-caption">Query kind: ${result.kind}</div>
        </div>`,
      })}
      ${result.results.length === 0
        ? hints
        : html`${recordTable(
              result.results.filter((item) => item.type === 'record').map((item) => item.record),
              titles[result.kind] ?? 'Matching records',
            )}
            ${blockTable(result.results.filter((item) => item.type === 'block').map((item) => item.block))}`}
    </div>
  </div>`;
}

/**
 * @param {object} args
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 */
export function privacyPage({ snapshot }) {
  return html`<div class="f-section-large">
    <div class="f-container-regular">
      ${pageHeader({
        snapshot,
        heading: 'What ChatScan stores',
        breadcrumbs: breadcrumb([{ label: 'Privacy' }]),
        aside: html`<div>
          <div class="f-margin-bottom-32">
            ${notice(
              lockIcon,
              'Metadata only',
              'The ingest API accepts a fixed set of fields. Any request carrying message content is refused before it reaches the index.',
            )}
          </div>
          <div class="f-button-wrapper">
            <a href="/api/v1/algorithm" class="f-button-secondary w-inline-block"><div>X11 rounds</div></a>
            <a href="/api/v1/status" class="f-button-secondary w-inline-block"><div>Node status</div></a>
          </div>
        </div>`,
      })}
      <div class="f-margin-bottom-48">
        <h2 class="f-h5-heading f-margin-bottom-16">Indexed for every message</h2>
        ${detailTable([
          { key: 'Explorer reference', value: '{HASH}/{ID-number}, derived from the X11 record hash' },
          { key: 'Ciphertext digest', value: 'A 64-character hash of the encrypted payload, computed on the client' },
          { key: 'Ciphertext size', value: 'Byte length of the encrypted payload' },
          { key: 'Protocol', value: 'Transport protocol identifier' },
          { key: 'Channel hash', value: 'Optional opaque conversation identifier' },
          { key: 'Fee and client version', value: 'Optional, supplied by the client' },
          { key: 'Timestamps', value: 'When the record was received and confirmed' },
        ])}
      </div>
      <div class="f-margin-bottom-48">
        <h2 class="f-h5-heading f-margin-bottom-16">Never accepted, never stored</h2>
        ${detailTable([
          { key: 'Message content', value: 'Plaintext or ciphertext bodies are refused with HTTP 400' },
          { key: 'Attachments', value: 'Not accepted in any form' },
          { key: 'Account identities', value: 'No usernames, addresses, phone numbers or device identifiers' },
          { key: 'Decryption keys', value: 'Keys never leave the CrypterChat clients' },
        ])}
      </div>
      <div>
        <h2 class="f-h5-heading f-margin-bottom-16">Protocol limits</h2>
        ${detailTable(protocolRows())}
      </div>
    </div>
  </div>`;
}

/**
 * @param {object} args
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 * @param {number} args.status
 * @param {string} args.message
 */
export function errorPage({ snapshot, status, message }) {
  return html`<div class="f-section-large">
    <div class="f-container-regular">
      ${pageHeader({
        snapshot,
        heading: status === 404 ? 'Not found on this chain' : 'Something went wrong',
        breadcrumbs: breadcrumb([{ label: `Error ${status}` }]),
        aside: html`<div>
          <div class="f-margin-bottom-32">${searchForm()}</div>
          <div class="f-button-wrapper">
            <a href="/" class="f-button-secondary w-inline-block"><div>Back to the explorer</div></a>
          </div>
        </div>`,
      })}
      <div class="f-empty-state">
        <div class="f-paragraph-regular f-text-weight-medium">${message}</div>
        <div class="f-paragraph-small f-text-color-gray-500">
          Message records are addressed as {HASH}/{ID-number}, for example
          <span class="f-mono">d700bc90e31d51c5ea22dbb03114e1791ef1da92d3ee06104216cdb9571327a8/1</span>.
        </div>
      </div>
    </div>
  </div>`;
}
