import { config } from './config.js';
import {
  PGP_PROTOCOL,
  generateUserKey,
  unlockPrivateKey,
  encryptAndSign,
  decryptMessage,
  readPublicKey,
  fingerprintShort,
} from './pgp.js';
import { privacyToolsPayload } from './privacy-tools.js';

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

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function authPhone(store, req) {
  const token = bearerToken(req);
  const phone = store.sessionPhone(token);
  if (!phone) {
    throw Object.assign(new Error('Authentication required'), { status: 401, code: 'unauthorized' });
  }
  return { phone, token };
}

async function ensurePgp(store, user) {
  if (user.pgp?.publicArmored && user.pgp?.privateArmored) return user;
  const keys = await generateUserKey({
    phone: user.phone,
    displayName: user.displayName,
    passphrase: config.pgpPassphrase,
  });
  return store.savePgpKeys(user.phone, keys);
}

async function unlockSession(store, vault, token, phone, passphrase) {
  const user = store.getUser(phone);
  if (!user?.pgp?.privateArmored) {
    throw Object.assign(new Error('No OpenPGP key for this user'), {
      status: 400,
      code: 'pgp_missing',
    });
  }
  try {
    const privateKey = await unlockPrivateKey(user.pgp.privateArmored, passphrase);
    vault.set(token, phone, privateKey);
    return privateKey;
  } catch {
    throw Object.assign(new Error('Invalid PGP passphrase'), {
      status: 401,
      code: 'pgp_unlock_failed',
    });
  }
}

async function decryptRow(chatscan, vault, token, store, row) {
  if (row.protocol === PGP_PROTOCOL || row.tool === 'pgp' || row.armored) {
    const unlocked = vault.get(token);
    if (!unlocked?.privateKey) {
      return { plaintext: null, locked: true, signatures: [] };
    }
    const armored =
      row.armored ||
      (row.envelopeHex ? Buffer.from(row.envelopeHex, 'hex').toString('utf8') : null);
    if (!armored) return { plaintext: null, locked: false, signatures: [] };
    try {
      const fromUser = store.getUser(row.from);
      const verificationKeys = [];
      if (fromUser?.pgp?.publicArmored) {
        verificationKeys.push(await readPublicKey(fromUser.pgp.publicArmored));
      }
      const opened = await decryptMessage({
        armoredMessage: armored,
        decryptionKey: unlocked.privateKey,
        verificationKeys,
      });
      return { plaintext: opened.text, locked: false, signatures: opened.signatures };
    } catch {
      return { plaintext: null, locked: false, signatures: [] };
    }
  }

  if (row.envelopeHex && row.keyHex) {
    try {
      const plaintext = await chatscan.openLocal(row.envelopeHex, row.keyHex);
      return { plaintext, locked: false, signatures: [] };
    } catch {
      return { plaintext: null, locked: false, signatures: [] };
    }
  }
  return { plaintext: null, locked: false, signatures: [] };
}

/**
 * @param {import('./store.js').Store} store
 * @param {import('./chatscan.js').ChatScanBridge} chatscan
 * @param {import('./pgp-vault.js').PgpVault} pgpVault
 */
export function createApi({ store, chatscan, pgpVault }) {
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
            storesChatData: true,
            usesSharedChatScan: true,
            defaultCryptoTool: config.defaultCryptoTool,
            pgp: true,
          },
          chatscan: {
            url: config.chatscanUrl,
            backend: chain.backend,
            chainId: chain.chainId,
            height: chain.height,
            network: chain.network,
          },
          privacy: privacyToolsPayload({ defaultTool: config.defaultCryptoTool }),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/server') {
        const chain = await chatscan.status();
        return json(res, 200, {
          name: config.serverName,
          publicUrl: config.publicUrl || null,
          storesChatData: true,
          defaultCryptoTool: config.defaultCryptoTool,
          pgp: true,
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

      if (req.method === 'GET' && url.pathname === '/api/privacy/tools') {
        return json(res, 200, privacyToolsPayload({ defaultTool: config.defaultCryptoTool }));
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/request-otp') {
        const body = await readBody(req);
        const phone = store.normalizePhone(body.phone);
        const displayName = String(body.displayName || '').trim().slice(0, 64);
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
        let user = store.upsertUser(phone, displayName || undefined);
        user = await ensurePgp(store, user);
        const token = store.createSession(phone, config.sessionTtlMs);
        // Auto-unlock with server demo passphrase so PGP chat works immediately.
        await unlockSession(store, pgpVault, token, phone, config.pgpPassphrase);
        return json(res, 200, {
          ok: true,
          token,
          user: {
            ...store.publicUserView(user),
            pgpUnlocked: true,
            pgpFingerprintShort: fingerprintShort(user.pgp?.fingerprint),
          },
          pgp: {
            fingerprint: user.pgp.fingerprint,
            publicArmored: user.pgp.publicArmored,
            unlocked: true,
            demoPassphrase: config.pgpPassphrase,
          },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/me') {
        const { phone, token } = authPhone(store, req);
        let user = store.getUser(phone);
        user = await ensurePgp(store, user);
        const unlocked = Boolean(pgpVault.get(token));
        return json(res, 200, {
          user: {
            ...store.publicUserView(user),
            pgpUnlocked: unlocked,
            pgpFingerprintShort: fingerprintShort(user.pgp?.fingerprint),
          },
          pgp: {
            fingerprint: user.pgp.fingerprint,
            publicArmored: user.pgp.publicArmored,
            unlocked,
          },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/pgp/me') {
        const { phone, token } = authPhone(store, req);
        let user = store.getUser(phone);
        user = await ensurePgp(store, user);
        return json(res, 200, {
          fingerprint: user.pgp.fingerprint,
          fingerprintShort: fingerprintShort(user.pgp.fingerprint),
          publicArmored: user.pgp.publicArmored,
          unlocked: Boolean(pgpVault.get(token)),
          createdAt: user.pgp.createdAt,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/pgp/unlock') {
        const { phone, token } = authPhone(store, req);
        const body = await readBody(req);
        const passphrase = String(body.passphrase || config.pgpPassphrase);
        await ensurePgp(store, store.getUser(phone));
        await unlockSession(store, pgpVault, token, phone, passphrase);
        return json(res, 200, { ok: true, unlocked: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/pgp/lock') {
        const { token } = authPhone(store, req);
        pgpVault.clear(token);
        return json(res, 200, { ok: true, unlocked: false });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/pgp/keys/')) {
        authPhone(store, req);
        const phoneParam = decodeURIComponent(url.pathname.slice('/api/pgp/keys/'.length));
        const phone = store.normalizePhone(phoneParam.startsWith('+') ? phoneParam : `+${phoneParam}`);
        let user = store.getUser(phone);
        if (!user) {
          user = store.upsertUser(phone);
        }
        user = await ensurePgp(store, user);
        return json(res, 200, {
          phone: user.phone,
          displayName: user.displayName,
          fingerprint: user.pgp.fingerprint,
          fingerprintShort: fingerprintShort(user.pgp.fingerprint),
          publicArmored: user.pgp.publicArmored,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/directory') {
        const { phone } = authPhone(store, req);
        return json(res, 200, {
          users: store.listUsers().filter((u) => u.phone !== phone),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/conversations') {
        const { phone, token } = authPhone(store, req);
        const conversations = [];
        for (const c of store.conversationsFor(phone)) {
          const rows = store.mailbox(phone, { conversationId: c.id });
          const last = rows[rows.length - 1];
          let lastText = c.lastPreview || '';
          if (last) {
            const opened = await decryptRow(chatscan, pgpVault, token, store, last);
            if (opened.plaintext) lastText = opened.plaintext;
            else if (opened.locked) lastText = '🔒 PGP locked';
            else if (last.tool === 'pgp' || last.protocol === PGP_PROTOCOL) lastText = 'PGP message';
          }
          conversations.push({ ...c, lastPreview: lastText });
        }
        return json(res, 200, { conversations });
      }

      if (req.method === 'POST' && url.pathname === '/api/messages/send') {
        const { phone, token } = authPhone(store, req);
        const body = await readBody(req);
        const to = store.normalizePhone(body.to);
        const text = typeof body.text === 'string' ? body.text : '';
        const tool = String(body.tool || config.defaultCryptoTool || 'pgp').toLowerCase();
        if (!text.trim()) {
          return json(res, 400, { error: 'Message text is required', code: 'empty_message' });
        }
        if (text.length > 4000) {
          return json(res, 400, { error: 'Message too long', code: 'too_long' });
        }
        if (to === phone) {
          return json(res, 400, { error: 'Cannot message yourself', code: 'self_message' });
        }

        let recipient = store.upsertUser(to);
        recipient = await ensurePgp(store, recipient);
        let sender = store.getUser(phone);
        sender = await ensurePgp(store, sender);
        const conversation = store.ensureConversation(phone, to);

        let delivered;
        let sentMeta;
        let onChain;

        if (tool === 'pgp' || tool === 'openpgp') {
          let unlocked = pgpVault.get(token)?.privateKey;
          if (!unlocked) {
            unlocked = await unlockSession(
              store,
              pgpVault,
              token,
              phone,
              String(body.passphrase || config.pgpPassphrase),
            );
          }
          const armored = await encryptAndSign({
            text,
            recipientPublicKeys: [recipient.pgp.publicArmored, sender.pgp.publicArmored],
            signingPrivateKey: unlocked,
          });
          const envelopeBytes = new TextEncoder().encode(armored);
          sentMeta = await chatscan.recordCiphertext(envelopeBytes, {
            conversationId: conversation.id,
            protocol: PGP_PROTOCOL,
          });
          const record = await chatscan.getRecord(sentMeta.ref);
          delivered = store.deliverEnvelope({
            conversationId: conversation.id,
            from: phone,
            to,
            envelopeHex: Buffer.from(armored, 'utf8').toString('hex'),
            armored,
            keyHex: null,
            ciphertextHash: sentMeta.ciphertextHash,
            size: sentMeta.size,
            protocol: PGP_PROTOCOL,
            tool: 'pgp',
            nonce: null,
            channelHash: sentMeta.channelHash,
            ref: sentMeta.ref,
            explorerUrl: sentMeta.explorerUrl,
            status: sentMeta.status || record.status,
            commitment: sentMeta.commitment ?? record.commitment,
            anchorTxid: sentMeta.anchorTxid,
          });
          onChain = record;
        } else {
          // Legacy ChatScan SDK AES-256-GCM envelopes.
          const sent = await chatscan.sendEncrypted(text, conversation.id);
          delivered = store.deliverEnvelope({
            conversationId: conversation.id,
            from: phone,
            to,
            envelopeHex: sent.envelopeHex,
            keyHex: sent.keyHex,
            ciphertextHash: sent.ciphertextHash,
            size: sent.size,
            protocol: sent.protocol,
            tool: 'aes',
            nonce: sent.nonce,
            channelHash: sent.channelHash,
            ref: sent.ref,
            explorerUrl: sent.explorerUrl,
            status: sent.status,
            commitment: sent.commitment,
            anchorTxid: sent.anchorTxid,
          });
          sentMeta = sent;
          onChain = await chatscan.getRecord(sent.ref);
        }

        return json(res, 201, {
          ok: true,
          message: {
            id: delivered.id,
            conversationId: conversation.id,
            from: phone,
            to,
            createdAt: delivered.createdAt,
            plaintext: text,
            tool: delivered.tool,
            protocol: delivered.protocol,
            ref: delivered.ref,
            explorerUrl: delivered.explorerUrl,
            status: delivered.status,
            ciphertextHash: delivered.ciphertextHash,
            size: delivered.size,
            commitment: delivered.commitment,
            pgp: tool === 'pgp' || tool === 'openpgp'
              ? {
                  senderFingerprint: sender.pgp.fingerprint,
                  recipientFingerprint: recipient.pgp.fingerprint,
                }
              : null,
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
        const { phone, token } = authPhone(store, req);
        const conversationId = url.searchParams.get('conversationId') || undefined;
        const since = url.searchParams.get('since')
          ? Number(url.searchParams.get('since'))
          : undefined;
        const rows = store.mailbox(phone, { conversationId, since });

        const messages = [];
        for (const row of rows) {
          const opened = await decryptRow(chatscan, pgpVault, token, store, row);
          messages.push({
            id: row.id,
            conversationId: row.conversationId,
            from: row.from,
            to: row.to,
            createdAt: row.createdAt,
            plaintext: opened.plaintext,
            locked: opened.locked,
            signatures: opened.signatures,
            tool: row.tool || (row.protocol === PGP_PROTOCOL ? 'pgp' : 'aes'),
            protocol: row.protocol,
            ref: row.ref,
            explorerUrl: row.explorerUrl,
            status: row.status,
            ciphertextHash: row.ciphertextHash,
            size: row.size,
            commitment: row.commitment,
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
            protocol: r.protocol,
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
