import { html, render } from '../../util/html.js';
import { githubIcon } from './icons.js';

export const REPO_URL = 'https://github.com/crypterchat/chatscan';
export const CRYPTERCHAT_URL = 'https://crypter.chat';

/**
 * Wraps page content in the ChatScan shell (banner, sections, footer).
 * @param {object} args
 * @param {string} args.title
 * @param {string} args.description
 * @param {import('../../util/html.js').SafeHtml} args.body
 * @param {ReturnType<import('../../core/network.js').networkSnapshot>} args.snapshot
 */
export function renderPage({ title, description, body, snapshot }) {
  return `<!DOCTYPE html>
${render(html`<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta content="width=device-width, initial-scale=1" name="viewport" />
    <meta name="description" content="${description}" />
    <meta name="robots" content="index, follow" />
    <link href="/css/chatscan.css" rel="stylesheet" type="text/css" />
    <link href="/images/favicon.svg" rel="icon" type="image/svg+xml" />
    <script src="/js/app.js" type="module" defer></script>
  </head>
  <body data-network="${snapshot.network}">
    <a class="f-skip-link" href="#main">Skip to explorer content</a>
    ${banner(snapshot)}
    <main id="main">${body}</main>
    ${footer()}
  </body>
</html>`)}
`;
}

/** @param {ReturnType<import('../../core/network.js').networkSnapshot>} snapshot */
function banner(snapshot) {
  return html`<div class="f-banner">
    <div class="f-banner-container-between">
      <div class="f-banner-text-wrapper">
        <div class="f-paragraph-regular">
          Contribute to Building the Future: Join Our Dev Group and Support Our
          <span class="f-banner-text-span">end-to-end encrypted chain</span>
        </div>
      </div>
      <div class="f-banner-block">
        <a href="${REPO_URL}" class="f-button-github w-inline-block" rel="noopener noreferrer" target="_blank">
          <div class="f-button-icon w-embed">${githubIcon}</div>
          <div>Contribute on GitHub</div>
        </a>
        <div class="f-banner-button-divider"></div>
        <div class="f-banner-block">
          <div class="f-banner-badge">${snapshot.network}</div>
          <div class="f-banner-caption">Height ${snapshot.height ?? 0}</div>
        </div>
      </div>
    </div>
  </div>`;
}

function footer() {
  const groups = [
    {
      title: 'Explorer',
      links: [
        { label: 'Latest records', href: '/' },
        { label: 'Latest blocks', href: '/blocks' },
        { label: 'Search', href: '/search' },
      ],
    },
    {
      title: 'Network',
      links: [
        { label: 'Node status', href: '/api/v1/status' },
        { label: 'X11 rounds', href: '/api/v1/algorithm' },
        { label: 'Health check', href: '/healthz' },
      ],
    },
    {
      title: 'Developers',
      links: [
        { label: 'REST API', href: `${REPO_URL}/blob/main/docs/API.md` },
        { label: 'Architecture', href: `${REPO_URL}/blob/main/docs/ARCHITECTURE.md` },
        { label: 'Source code', href: REPO_URL },
      ],
    },
    {
      title: 'Privacy',
      links: [
        { label: 'What ChatScan stores', href: '/privacy' },
        { label: 'End-to-end encryption', href: `${CRYPTERCHAT_URL}` },
      ],
    },
  ];

  return html`<div class="f-footer-regular">
    <div class="f-container-regular">
      <div class="w-layout-grid f-footer-top-grid">
        <div class="f-footer-content">
          <div class="f-margin-bottom-16">
            <a href="/" class="f-footer-logo w-inline-block">
              <img src="/images/crypterchat-logo.svg" loading="lazy" width="124" alt="CrypterChat" />
            </a>
          </div>
          <p class="f-paragraph-small-2">Communication in the safe way</p>
        </div>
      </div>
      <div class="w-layout-grid f-footer-large-grid">
        ${groups.map(
          (group) => html`<div class="f-footer-block">
            <div class="f-footer-title">${group.title}</div>
            ${group.links.map(
              (link) => html`<a href="${link.href}" class="f-footer-link w-inline-block"><div>${link.label}</div></a>`,
            )}
          </div>`,
        )}
      </div>
      <div class="f-footer-divider"></div>
      <div class="f-footer-bottom">
        <p class="f-footer-detail">CrypterChat LLC | Erickson Holding LTD</p>
        <div class="f-footer-menu">
          <div class="f-footer-vertical-divider"></div>
          <a href="${CRYPTERCHAT_URL}" class="f-footer-link w-inline-block" rel="noopener noreferrer">
            <div>Go back to Crypter.chat</div>
          </a>
        </div>
      </div>
    </div>
  </div>`;
}
