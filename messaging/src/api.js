import { config } from './config.js';

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request too large'), { status: 413, code: 'too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400, code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

function authPhone(store, req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const phone = store.sessionPhone(token);
  if (!phone) {
    throw Object.assign(new Error('Authentication required'), { status: 401, code: 'unauthorized' });
  }
  return phone;
}

/**
 * @param {import('./store.js').Store} store
 * @param {import('./chatscan.js').ChatScanBridge} chatscan
 */
export function createApi({ store, chatscan }) {
  return async function handleApi(req, res, url) {
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const chain = await chatscan.status();
        return json(res, 200, {
          ok: true,
          service: 'crypterchat-messaging',
          server: {
            name: config.serverName,
            publicUrl: config.publicUrl || null,
            // Chat data (users, encrypted envelopes) lives on THIS server.
            storesChatData: true,
            // Hashes are sealed on the shared ChatScan chain below.
            usesSharedChatScan: true,
          },
          chatscan: {
            url: config.chatscanUrl,
            backend: chain.backend,
            chainId: chain.chainId,
            height: chain.height,
            network: chain.network,
          },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/server') {
        const chain = await chatscan.status();
        return json(res, 200, {
          name: config.serverName,
          publicUrl: config.publicUrl || null,
          storesChatData: true,
          chatscan: {
            url: config.chatscanUrl,
            chainId: chain.chainId,
            height: chain.height,
            backend: chain.backend,
            network: chain.network,
          },
          howToConnect:
            'In CrypterChat, open Server settings and paste this server’s base URL, then sign in with your phone number.',
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/request-otp') {
        const body = await readBody(req);
        const phone = store.normalizePhone(body.phone);
        const displayName = String(body.displayName || '').trim().slice(0, 64);
        // Always issue a fresh demo OTP so phone login works without SMS.
        store.saveOtp(phone, config.demoOtp);
        store.upsertUser(phone, displayName || undefined);
        return json(res, 200, {
          ok: true,
          phone,
          demo: true,
          hint: `Use OTP ${config.demoOtp} in local/demo mode`,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/verify-otp') {
        const body = await readBody(req);
        const phone = store.normalizePhone(body.phone);
        const code = String(body.code || '').trim();
        const displayName = String(body.displayName || '').trim().slice(0, 64);
        const accepted = code === config.demoOtp || store.consumeOtp(phone, code);
        if (!accepted) {
          return json(res, 401, { error: 'Invalid or expired OTP', code: 'invalid_otp' });
        }
        const user = store.upsertUser(phone, displayName || undefined);
        const token = store.createSession(phone, config.sessionTtlMs);
        return json(res, 200, {
          ok: true,
          token,
          user: { phone: user.phone, displayName: user.displayName },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/me') {
        const phone = authPhone(store, req);
        const user = store.getUser(phone);
        return json(res, 200, { user });
      }

      if (req.method === 'GET' && url.pathname === '/api/directory') {
        const phone = authPhone(store, req);
        return json(res, 200, {
          users: store.listUsers().filter((u) => u.phone !== phone),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/conversations') {
        const phone = authPhone(store, req);
        const conversations = [];
        for (const c of store.conversationsFor(phone)) {
          // Decrypt the latest envelope for a normal chat-list preview (peers only).
          const rows = store.mailbox(phone, { conversationId: c.id });
          const last = rows[rows.length - 1];
          let lastText = c.lastPreview || '';
          if (last?.envelopeHex && last?.keyHex) {
            try {
              lastText = await chatscan.openLocal(last.envelopeHex, last.keyHex);
            } catch {
              lastText = 'Message';
            }
          }
          conversations.push({ ...c, lastPreview: lastText });
        }
        return json(res, 200, { conversations });
      }

      if (req.method === 'POST' && url.pathname === '/api/messages/send') {
        const phone = authPhone(store, req);
        const body = await readBody(req);
        const to = store.normalizePhone(body.to);
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) {
          return json(res, 400, { error: 'Message text is required', code: 'empty_message' });
        }
        if (text.length > 4000) {
          return json(res, 400, { error: 'Message too long', code: 'too_long' });
        }
        if (to === phone) {
          return json(res, 400, { error: 'Cannot message yourself', code: 'self_message' });
        }

        // Ensure recipient exists (auto-provision so demos work with any E.164).
        store.upsertUser(to);
        const conversation = store.ensureConversation(phone, to);

        // Encrypt + commit on ChatScan. Plaintext never reaches the explorer.
        const sent = await chatscan.sendEncrypted(text, conversation.id);

        const delivered = store.deliverEnvelope({
          conversationId: conversation.id,
          from: phone,
          to,
          envelopeHex: sent.envelopeHex,
          keyHex: sent.keyHex,
          ciphertextHash: sent.ciphertextHash,
          size: sent.size,
          protocol: sent.protocol,
          nonce: sent.nonce,
          channelHash: sent.channelHash,
          ref: sent.ref,
          explorerUrl: sent.explorerUrl,
          status: sent.status,
          commitment: sent.commitment,
          anchorTxid: sent.anchorTxid,
        });

        // Prove ChatScan has no content.
        const onChain = await chatscan.getRecord(sent.ref);

        return json(res, 201, {
          ok: true,
          message: {
            id: delivered.id,
            conversationId: conversation.id,
            from: phone,
            to,
            createdAt: delivered.createdAt,
            // Local decrypt material for the sender UI (already known); recipients get it via mailbox.
            plaintext: text,
            ref: sent.ref,
            explorerUrl: sent.explorerUrl,
            status: sent.status,
            ciphertextHash: sent.ciphertextHash,
            size: sent.size,
            commitment: sent.commitment,
            protocol: sent.protocol,
          },
          chainRecord: {
            ref: onChain.ref,
            ciphertextHash: onChain.ciphertextHash,
            size: onChain.size,
            contentAvailable: onChain.contentAvailable,
            status: onChain.status,
            protocol: onChain.protocol,
            channelHash: onChain.channelHash,
          },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/messages') {
        const phone = authPhone(store, req);
        const conversationId = url.searchParams.get('conversationId') || undefined;
        const since = url.searchParams.get('since')
          ? Number(url.searchParams.get('since'))
          : undefined;
        const rows = store.mailbox(phone, { conversationId, since });

        // Decrypt envelopes for authorized conversation members only.
        const messages = [];
        for (const row of rows) {
          let plaintext = null;
          try {
            plaintext = await chatscan.openLocal(row.envelopeHex, row.keyHex);
          } catch {
            plaintext = null;
          }
          messages.push({
            id: row.id,
            conversationId: row.conversationId,
            from: row.from,
            to: row.to,
            createdAt: row.createdAt,
            plaintext,
            ref: row.ref,
            explorerUrl: row.explorerUrl,
            status: row.status,
            ciphertextHash: row.ciphertextHash,
            size: row.size,
            commitment: row.commitment,
            protocol: row.protocol,
          });
        }
        return json(res, 200, { messages });
      }

      if (req.method === 'GET' && url.pathname === '/api/chain/status') {
        authPhone(store, req);
        const status = await chatscan.status();
        return json(res, 200, { status, explorer: config.chatscanUrl });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/chain/record/')) {
        authPhone(store, req);
        const ref = decodeURIComponent(url.pathname.slice('/api/chain/record/'.length));
        const record = await chatscan.getRecord(ref);
        return json(res, 200, {
          record: {
            ref: record.ref,
            hash: record.hash,
            id: record.id,
            ciphertextHash: record.ciphertextHash,
            size: record.size,
            protocol: record.protocol,
            channelHash: record.channelHash,
            status: record.status,
            contentAvailable: record.contentAvailable,
            explorerUrl: `${config.chatscanUrl}/tx/${record.ref}`,
          },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/chain/history') {
        authPhone(store, req);
        const conversationId = url.searchParams.get('conversationId');
        if (!conversationId) {
          return json(res, 400, { error: 'conversationId required', code: 'missing_conversation' });
        }
        const history = await chatscan.history(conversationId, { limit: 50 });
        return json(res, 200, {
          total: history.total,
          records: history.records.map((r) => ({
            ref: r.ref,
            ciphertextHash: r.ciphertextHash,
            size: r.size,
            status: r.status,
            contentAvailable: r.contentAvailable,
            explorerUrl: `${config.chatscanUrl}/tx/${r.ref}`,
          })),
        });
      }

      return json(res, 404, { error: 'Not found', code: 'not_found' });
    } catch (error) {
      const status = error.status || 500;
      return json(res, status, {
        error: error.message || 'Server error',
        code: error.code || 'server_error',
        details: error.details,
      });
    }
  };
}
