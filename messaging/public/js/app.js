const state = {
  token: localStorage.getItem('cc_token') || '',
  user: JSON.parse(localStorage.getItem('cc_user') || 'null'),
  conversations: [],
  activeId: null,
  peerPhone: null,
  pollTimer: null,
  knownMessageIds: new Set(),
};

const $ = (id) => document.getElementById(id);

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function showAuth() {
  $('auth-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
}

function showApp() {
  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('me-label').textContent = `${state.user.displayName} · ${state.user.phone}`;
}

async function refreshChainPill() {
  try {
    const health = await api('/api/health', { auth: false });
    const server = health.server || {};
    const cs = health.chatscan || {};
    const banner = $('server-banner');
    if (banner) {
      banner.innerHTML =
        `<strong>${escapeHtml(server.name || 'Chat server')}</strong> — chat data on this server · ` +
        `ChatScan <code>${escapeHtml(cs.chainId || '')}</code> (hashes only)`;
    }
    $('chain-pill').innerHTML =
      `<strong>${escapeHtml(server.name || 'Chat server')}</strong><br>` +
      `Chat data here · ChatScan ${escapeHtml(cs.chainId || '')} · h${escapeHtml(String(cs.height ?? ''))} · ` +
      `<a href="${escapeHtml(cs.url || '/')}" target="_blank" rel="noopener">explorer</a>`;
  } catch (error) {
    $('chain-pill').textContent = `Server offline: ${error.message}`;
  }
}

async function refreshConversations() {
  const { conversations } = await api('/api/conversations');
  state.conversations = conversations;
  const list = $('conversation-list');
  list.innerHTML = '';
  for (const c of conversations) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `conversation-item${c.id === state.activeId ? ' active' : ''}`;
    btn.innerHTML = `<strong>${escapeHtml(c.peerName)}</strong><span>${escapeHtml(c.peer)}</span><span>${escapeHtml(c.lastPreview || 'No messages yet')}</span>`;
    btn.addEventListener('click', () => openConversation(c.peer, c.id));
    list.appendChild(btn);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function openConversation(peer, conversationId) {
  state.peerPhone = peer;
  state.activeId = conversationId || [state.user.phone, peer].sort().join(':');
  state.knownMessageIds = new Set();
  $('empty-chat').classList.add('hidden');
  $('active-chat').classList.remove('hidden');
  $('peer-title').textContent = peer;
  $('peer-sub').textContent = `Conversation ${state.activeId}`;
  $('explorer-link').href = '/'; // updated after chain status
  try {
    const { explorer } = await api('/api/chain/status');
    $('explorer-link').href = explorer;
  } catch {
    /* ignore */
  }
  await refreshConversations();
  await loadMessages({ scroll: true });
}

async function loadMessages({ scroll = false } = {}) {
  if (!state.activeId) return;
  const { messages } = await api(`/api/messages?conversationId=${encodeURIComponent(state.activeId)}`);
  const list = $('message-list');
  const wasAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.innerHTML = '';
  for (const msg of messages) {
    state.knownMessageIds.add(msg.id);
    const mine = msg.from === state.user.phone;
    const el = document.createElement('article');
    el.className = `bubble ${mine ? 'mine' : 'theirs'}`;
    const explorerPath = msg.explorerUrl || '#';
    // Peer-to-peer: show the normal message text only. Hashes live on ChatScan.
    const when = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    el.innerHTML = `
      <div class="bubble-text">${escapeHtml(msg.plaintext ?? '[unable to decrypt]')}</div>
      <div class="bubble-foot">
        <span>${escapeHtml(when)}</span>
        <a class="chain-link" href="${escapeHtml(explorerPath)}" target="_blank" rel="noopener" title="Open on ChatScan">✓</a>
      </div>`;
    list.appendChild(el);
  }
  if (scroll || wasAtBottom) list.scrollTop = list.scrollHeight;
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      await refreshConversations();
      if (state.activeId) await loadMessages();
      await refreshChainPill();
    } catch {
      /* transient */
    }
  }, 2500);
}

$('otp-request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const phone = $('phone').value.trim();
    const displayName = $('display-name').value.trim();
    const result = await api('/api/auth/request-otp', {
      method: 'POST',
      auth: false,
      body: { phone, displayName },
    });
    $('otp-request-form').classList.add('hidden');
    $('otp-verify-form').classList.remove('hidden');
    $('otp-hint').innerHTML = result.hint
      ? escapeHtml(result.hint)
      : 'Enter the code sent to your phone.';
    toast('Code ready');
  } catch (error) {
    toast(error.message);
  }
});

$('otp-verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const phone = $('phone').value.trim();
    const displayName = $('display-name').value.trim();
    const code = $('otp').value.trim();
    const result = await api('/api/auth/verify-otp', {
      method: 'POST',
      auth: false,
      body: { phone, displayName, code },
    });
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem('cc_token', state.token);
    localStorage.setItem('cc_user', JSON.stringify(state.user));
    showApp();
    await refreshChainPill();
    await refreshConversations();
    startPolling();
    toast('Signed in');
  } catch (error) {
    toast(error.message);
  }
});

$('logout-btn').addEventListener('click', () => {
  state.token = '';
  state.user = null;
  localStorage.removeItem('cc_token');
  localStorage.removeItem('cc_user');
  clearInterval(state.pollTimer);
  showAuth();
});

$('new-chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const peer = $('peer-phone').value.trim();
  try {
    // Touch directory by ensuring we can open a conversation id locally.
    await openConversation(peer);
    $('peer-phone').value = '';
  } catch (error) {
    toast(error.message);
  }
});

$('send-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('message-input').value;
  if (!state.peerPhone || !text.trim()) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api('/api/messages/send', {
      method: 'POST',
      body: { to: state.peerPhone, text },
    });
    $('message-input').value = '';
    state.activeId = result.message.conversationId;
    await refreshConversations();
    await loadMessages({ scroll: true });
    toast('Sent');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

async function boot() {
  await refreshChainPill().catch(() => {});
  if (!state.token || !state.user) {
    showAuth();
    return;
  }
  try {
    await api('/api/me');
    showApp();
    await refreshChainPill();
    await refreshConversations();
    startPolling();
  } catch {
    localStorage.removeItem('cc_token');
    localStorage.removeItem('cc_user');
    showAuth();
  }
}

boot();
