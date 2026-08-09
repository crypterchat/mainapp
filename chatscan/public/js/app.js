/**
 * ChatScan Block Explorer front-end.
 *
 * Pages are server rendered, so this script only adds progressive enhancement:
 * dropdown metric cards, a copy button for record references, and a live
 * refresh driven by the node's server-sent event stream.
 */

const REFRESH_THROTTLE_MS = 3000;
const LIVE_REGIONS = ['[data-record-list]', '[data-block-list]'];

function initDropdowns() {
  for (const dropdown of document.querySelectorAll('[data-dropdown]')) {
    const toggle = dropdown.querySelector('[data-dropdown-toggle]');
    const list = dropdown.querySelector('[data-dropdown-list]');
    if (!toggle || !list) continue;

    toggle.addEventListener('click', () => {
      const open = list.classList.toggle('w--open');
      toggle.classList.toggle('w--open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const list of document.querySelectorAll('[data-dropdown-list].w--open')) {
      list.classList.remove('w--open');
      const toggle = list.parentElement?.querySelector('[data-dropdown-toggle]');
      toggle?.classList.remove('w--open');
      toggle?.setAttribute('aria-expanded', 'false');
    }
  });
}

function initCopyButtons() {
  for (const button of document.querySelectorAll('[data-copy-button]')) {
    button.addEventListener('click', async () => {
      const source = document.querySelector('[data-copy-source]');
      if (!source || !navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        const original = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => {
          button.textContent = original;
        }, 1500);
      } catch {
        button.textContent = 'Copy failed';
      }
    });
  }
}

/**
 * Pulls the current page again and swaps in the freshly rendered figures and
 * tables, so the client never has to re-implement server-side formatting.
 */
async function refreshFromServer() {
  const response = await fetch(window.location.href, {
    headers: { accept: 'text/html' },
    cache: 'no-store',
  });
  if (!response.ok) return;

  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');

  for (const element of document.querySelectorAll('[data-live]')) {
    const key = element.getAttribute('data-live');
    const replacement = parsed.querySelector(`[data-live="${key}"]`);
    if (replacement) element.textContent = replacement.textContent;
  }

  for (const selector of LIVE_REGIONS) {
    const current = document.querySelector(selector);
    const replacement = parsed.querySelector(selector);
    if (current && replacement) current.innerHTML = replacement.innerHTML;
  }
}

function initLiveStream() {
  if (typeof EventSource === 'undefined') return;

  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      refreshFromServer().catch(() => {
        /* a failed refresh is retried on the next stream event */
      });
    }, REFRESH_THROTTLE_MS);
  };

  const stream = new EventSource('/api/v1/stream');
  stream.addEventListener('record', schedule);
  stream.addEventListener('block', schedule);
  stream.addEventListener('status', schedule);
  window.addEventListener('beforeunload', () => stream.close());
}

initDropdowns();
initCopyButtons();
initLiveStream();
