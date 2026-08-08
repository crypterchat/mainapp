import { PROTOCOLS } from '../../core/records.js';
import {
  formatBytes,
  formatNumber,
  formatRelativeTime,
  formatUsd,
  shortHash,
} from '../../util/format.js';
import { html } from '../../util/html.js';
import { checkIcon, clockIcon, errorIcon, homeIcon, separatorIcon } from './icons.js';

const STATUS_STYLES = {
  confirmed: { className: 'f-alert-success', icon: checkIcon, label: 'Confirmed' },
  pending: { className: 'f-alert-warning', icon: clockIcon, label: 'Pending' },
  rejected: { className: 'f-alert-error', icon: errorIcon, label: 'Rejected' },
};

/**
 * Status pill used in record tables and on the record page.
 * @param {string} status
 * @param {string} [detail]
 */
export function statusAlert(status, detail) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return html`<div class="f-alert-small">
    <div class="f-alert-wrapper">
      <div class="${style.className}">
        <div class="f-alert-icon w-embed">${style.icon}</div>
      </div>
    </div>
    <div class="f-paragraph-small">${style.label}${detail ? html` &middot; ${detail}` : ''}</div>
  </div>`;
}

/**
 * Header breadcrumb. `trail` entries render after the home icon.
 * @param {{ label: string, href?: string }[]} trail
 */
export function breadcrumb(trail) {
  return html`<div class="f-breadcrumb">
    <nav class="f-breadcrumb-wrapper" aria-label="Breadcrumb">
      <a href="/" class="f-breadcrumb-home w-inline-block" aria-label="ChatScan home">
        <div class="f-breadcrumb-home-svg w-embed">${homeIcon}</div>
      </a>
      ${trail.map(
        (item) => html`<div class="f-breadcrumb-seperator w-embed">${separatorIcon}</div>
          ${item.href
            ? html`<a href="${item.href}" class="f-breadcrumb-link w-inline-block"><div>${item.label}</div></a>`
            : html`<div class="f-breadcrumb-link"><div>${item.label}</div></div>`}`,
      )}
    </nav>
  </div>`;
}

/**
 * The live network figures shown in the page header.
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} snapshot
 */
export function networkBreadcrumb(snapshot) {
  return breadcrumb([
    { label: html`AT Fee: <span data-live="fee">${formatUsd(snapshot.fee.estimateUsd)}</span>` },
    {
      label: html`Unconfirmed TXS:
        <span data-live="unconfirmed"
          >${formatNumber(snapshot.unconfirmed.count)} (${formatBytes(snapshot.unconfirmed.bytes)})</span
        >`,
    },
    {
      label: html`tx Counts:
        <span data-live="txcount">${formatNumber(snapshot.throughput.records)} (${snapshot.throughput.tps} TPS)</span>`,
    },
  ]);
}

/**
 * Search box. Accepts a `{HASH}/{ID-number}` reference, a hash, or a height.
 * @param {string} [value]
 */
export function searchForm(value = '') {
  return html`<form class="f-search-form" action="/search" method="get" role="search">
    <label class="f-skip-link" for="chatscan-search">Search ChatScan</label>
    <input
      class="f-search-input"
      id="chatscan-search"
      name="q"
      type="search"
      value="${value}"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search by {HASH}/{ID-number}, record hash, block hash or height"
    />
    <button class="f-search-submit" type="submit">Search</button>
  </form>`;
}

/**
 * Server state toggle, matching the Webflow toggle component.
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} snapshot
 */
export function serverToggle(snapshot) {
  const labels = {
    online: 'Server Active',
    degraded: 'Server Degraded',
    syncing: 'Server Syncing',
    paused: 'Sealer Paused',
  };
  const modifier = snapshot.status === 'online' ? '' : snapshot.status === 'paused' ? ' f-toggle-off' : ' f-toggle-warn';
  return html`<div class="f-toggle-wrap">
    <div class="f-toggle-regular${modifier}" role="img" aria-label="${labels[snapshot.status]}">
      <div class="f-toggle-thumb"></div>
    </div>
    <div data-live="status-label">${labels[snapshot.status] ?? snapshot.status}</div>
  </div>`;
}

/**
 * Expandable metric card built from the Webflow dropdown component.
 * @param {object} args
 * @param {string} args.title
 * @param {string} args.value
 * @param {string} args.caption
 * @param {string} [args.liveKey] data attribute used by the live updater
 * @param {{ label: string, value: string }[]} args.rows
 */
export function metricCard({ title, value, caption, liveKey, rows }) {
  return html`<div class="f-feature-card-filled">
    <div class="f-stat-block">
      <div class="f-heading-detail-small">${title}</div>
      <div class="f-stat-value" ${liveKey ? html`data-live="${liveKey}"` : ''}>${value}</div>
      <div class="f-stat-caption">${caption}</div>
    </div>
    <div class="f-dropdown w-dropdown" data-dropdown>
      <button class="f-dropdown-toggle w-dropdown-toggle" type="button" aria-expanded="false" data-dropdown-toggle>
        <div class="f-dropdown-icon-l w-icon-dropdown-toggle"></div>
        <div class="f-paragraph-small">${title} detail</div>
      </button>
      <nav class="f-dropdown-list w-dropdown-list" data-dropdown-list>
        <div class="f-dropdown-wrap">
          ${rows.map(
            (row) => html`<div class="f-dropdown-link">
              <div class="f-paragraph-small f-text-color-gray-500">${row.label}</div>
              <div class="f-paragraph-small">${row.value}</div>
            </div>`,
          )}
        </div>
      </nav>
    </div>
  </div>`;
}

/**
 * One row of the message record table.
 * @param {ReturnType<import('../../core/records.js').publicRecord>} record
 */
export function recordRow(record) {
  return html`<div class="f-career-row-wrapper" data-record-ref="${record.ref}">
    <div class="w-layout-grid f-career-row">
      <div>
        <div class="f-paragraph-regular">
          <a class="f-mono f-mono-link" href="/tx/${record.ref}" title="${record.ref}">
            ${shortHash(record.hash, 18, 10)}/${record.id}
          </a>
        </div>
        <div class="f-stat-caption">
          ${formatBytes(record.size)} ciphertext &middot; ${formatRelativeTime(record.receivedAt)}
        </div>
      </div>
      <div>
        <div class="f-paragraph-regular f-text-color-gray-500">${record.protocolLabel}</div>
        <div class="f-stat-caption">
          ${record.blockHeight === null ? 'Awaiting block' : html`Block #${record.blockHeight}`}
        </div>
      </div>
      <div>${statusAlert(record.status, record.rejectionReason ?? undefined)}</div>
    </div>
  </div>`;
}

/**
 * Message record table.
 * @param {ReturnType<import('../../core/records.js').publicRecord>[]} records
 * @param {string} [title]
 */
export function recordTable(records, title = 'Hash ID') {
  return html`<div class="f-career-wrapper">
    <div class="f-margin-bottom-40">
      <div class="w-layout-grid f-career-table">
        <div class="f-career-position-block-title">
          <h6 class="f-heading-detail-small">${title}</h6>
        </div>
        <div data-record-list>
          ${records.length === 0
            ? html`<div class="f-empty-state">
                No message records indexed yet. Records appear here as soon as a CrypterChat client submits an
                encrypted message digest.
              </div>`
            : records.map((record) => recordRow(record))}
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * Block table.
 * @param {ReturnType<import('../api.js').publicBlock>[]} blocks
 */
export function blockTable(blocks) {
  return html`<div class="f-career-wrapper">
    <div class="w-layout-grid f-career-table">
      <div class="f-career-position-block-title">
        <h6 class="f-heading-detail-small">X11 Blocks</h6>
      </div>
      <div data-block-list>
        ${blocks.length === 0
          ? html`<div class="f-empty-state">No blocks sealed yet.</div>`
          : blocks.map(
              (block) => html`<div class="f-career-row-wrapper">
                <div class="w-layout-grid f-career-row">
                  <div>
                    <div class="f-paragraph-regular">
                      <a class="f-mono-link" href="/block/${block.height}">Block #${block.height}</a>
                    </div>
                    <div class="f-stat-caption f-mono">${shortHash(block.hash, 18, 10)}</div>
                  </div>
                  <div>
                    <div class="f-paragraph-regular f-text-color-gray-500">
                      ${formatNumber(block.txCount)} records
                    </div>
                    <div class="f-stat-caption">${formatBytes(block.sizeBytes)}</div>
                  </div>
                  <div>
                    <div class="f-paragraph-regular">${formatRelativeTime(block.timestamp)}</div>
                    <div class="f-stat-caption">${block.algorithm} &middot; difficulty ${block.difficulty}</div>
                  </div>
                </div>
              </div>`,
            )}
      </div>
    </div>
  </div>`;
}

/**
 * Key/value detail table.
 * @param {{ key: string, value: unknown }[]} rows
 */
export function detailTable(rows) {
  return html`<dl class="f-detail-grid">
    ${rows.map(
      (row) => html`<div class="f-detail-row">
        <dt class="f-detail-key">${row.key}</dt>
        <dd class="f-detail-value">${row.value}</dd>
      </div>`,
    )}
  </dl>`;
}

/**
 * The notice explaining that message content is not part of the index.
 * @param {import('../../util/html.js').SafeHtml} icon
 * @param {string} title
 * @param {string} body
 */
export function notice(icon, title, body) {
  return html`<div class="f-alert-large">
    <div class="f-alert-info">
      <div class="f-alert-icon w-embed">${icon}</div>
    </div>
    <div class="f-alert-content">
      <div class="f-paragraph-regular f-text-weight-medium">${title}</div>
      <div class="f-paragraph-small f-text-color-gray-500">${body}</div>
    </div>
  </div>`;
}

/** Protocol reference rows used on the privacy page. */
export function protocolRows() {
  return Object.values(PROTOCOLS).map((protocol) => ({
    key: protocol.label,
    value: `${protocol.id} - ciphertext up to ${formatBytes(protocol.maxCiphertextBytes)}`,
  }));
}
