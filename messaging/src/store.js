import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

/**
 * Private delivery store for encrypted envelopes and phone-number identity.
 *
 * This is NOT a message database of record. Message immutability and public
 * integrity live on ChatScan (X11). We only keep:
 *   - user phone registrations / sessions
 *   - ciphertext envelopes + per-message keys for the conversation participants
 *
 * Plaintext is never persisted.
 */
export class Store extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.usersPath = path.join(dataDir, 'users.json');
    this.sessionsPath = path.join(dataDir, 'sessions.json');
    this.otpsPath = path.join(dataDir, 'otps.json');
    this.mailboxesPath = path.join(dataDir, 'mailboxes.json');
    this.conversationsPath = path.join(dataDir, 'conversations.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.users = this.#read(this.usersPath, {});
    this.sessions = this.#read(this.sessionsPath, {});
    this.otps = this.#read(this.otpsPath, {});
    this.mailboxes = this.#read(this.mailboxesPath, {});
    this.conversations = this.#read(this.conversationsPath, {});
  }

  #read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return structuredClone(fallback);
    }
  }

  #write(file, value) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  }

  persist() {
    this.#write(this.usersPath, this.users);
    this.#write(this.sessionsPath, this.sessions);
    this.#write(this.otpsPath, this.otps);
    this.#write(this.mailboxesPath, this.mailboxes);
    this.#write(this.conversationsPath, this.conversations);
  }

  normalizePhone(phone) {
    const digits = String(phone || '').replace(/[^\d+]/g, '');
    if (!digits.startsWith('+')) {
      throw Object.assign(new Error('Phone number must be in E.164 format, e.g. +15551234567'), {
        code: 'invalid_phone',
        status: 400,
      });
    }
    if (digits.length < 10 || digits.length > 16) {
      throw Object.assign(new Error('Phone number length is invalid'), {
        code: 'invalid_phone',
        status: 400,
      });
    }
    return digits;
  }

  saveOtp(phone, code, ttlMs = 10 * 60 * 1000) {
    this.otps[phone] = { code, expiresAt: Date.now() + ttlMs };
    this.persist();
  }

  consumeOtp(phone, code) {
    const entry = this.otps[phone];
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      delete this.otps[phone];
      this.persist();
      return false;
    }
    if (entry.code !== code) return false;
    delete this.otps[phone];
    this.persist();
    return true;
  }

  upsertUser(phone, displayName) {
    const existing = this.users[phone] || {
      phone,
      createdAt: Date.now(),
      publicKeyHint: crypto.randomBytes(16).toString('hex'),
    };
    existing.displayName = displayName || existing.displayName || phone;
    existing.lastSeenAt = Date.now();
    this.users[phone] = existing;
    this.persist();
    return existing;
  }

  getUser(phone) {
    return this.users[phone] || null;
  }

  listUsers() {
    return Object.values(this.users).map((u) => ({
      phone: u.phone,
      displayName: u.displayName,
      lastSeenAt: u.lastSeenAt,
    }));
  }

  createSession(phone, ttlMs) {
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions[token] = { phone, expiresAt: Date.now() + ttlMs };
    this.persist();
    return token;
  }

  sessionPhone(token) {
    if (!token) return null;
    const session = this.sessions[token];
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      delete this.sessions[token];
      this.persist();
      return null;
    }
    return session.phone;
  }

  conversationId(a, b) {
    return [a, b].sort().join(':');
  }

  ensureConversation(a, b) {
    const id = this.conversationId(a, b);
    if (!this.conversations[id]) {
      this.conversations[id] = {
        id,
        members: [a, b].sort(),
        updatedAt: Date.now(),
        lastPreview: null,
        lastRef: null,
      };
      this.persist();
    }
    return this.conversations[id];
  }

  conversationsFor(phone) {
    return Object.values(this.conversations)
      .filter((c) => c.members.includes(phone))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => {
        const peer = c.members.find((m) => m !== phone);
        const peerUser = this.users[peer];
        return {
          id: c.id,
          peer,
          peerName: peerUser?.displayName || peer,
          updatedAt: c.updatedAt,
          lastPreview: c.lastPreview,
          lastRef: c.lastRef,
        };
      });
  }

  /**
   * Deliver an encrypted envelope. Plaintext is never accepted here.
   */
  deliverEnvelope({
    conversationId,
    from,
    to,
    envelopeHex,
    keyHex,
    ciphertextHash,
    size,
    protocol,
    nonce,
    channelHash,
    ref,
    explorerUrl,
    status,
    commitment,
    anchorTxid,
    createdAt = Date.now(),
  }) {
    const forbidden = ['content', 'body', 'text', 'message', 'plaintext', 'payload'];
    for (const field of forbidden) {
      if (arguments[0][field] !== undefined) {
        throw Object.assign(new Error(`Refusing to store plaintext field: ${field}`), {
          code: 'content_rejected',
          status: 400,
        });
      }
    }

    const entry = {
      id: crypto.randomUUID(),
      conversationId,
      from,
      to,
      envelopeHex,
      keyHex,
      ciphertextHash,
      size,
      protocol,
      nonce,
      channelHash,
      ref,
      explorerUrl,
      status,
      commitment,
      anchorTxid,
      createdAt,
    };

    for (const phone of [from, to]) {
      if (!this.mailboxes[phone]) this.mailboxes[phone] = [];
      this.mailboxes[phone].push(entry);
    }

    const conversation = this.conversations[conversationId];
    if (conversation) {
      conversation.updatedAt = createdAt;
      conversation.lastPreview = `Encrypted · ${size} B · ${ref}`;
      conversation.lastRef = ref;
    }

    this.persist();
    this.emit('envelope', entry);
    return entry;
  }

  mailbox(phone, { conversationId, since } = {}) {
    const list = this.mailboxes[phone] || [];
    return list
      .filter((m) => (!conversationId || m.conversationId === conversationId))
      .filter((m) => (!since || m.createdAt > since))
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}
