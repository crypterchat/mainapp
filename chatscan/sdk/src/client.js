import { ChatScanError, errorFromResponse } from './errors.js';

/**
 * A client for one ChatScan explorer.
 *
 * Everything here is plain `fetch`, so it works in a browser, in React Native
 * and in Node. Nothing in this class can send message content: `submitRecord`
 * takes a fixed set of metadata fields, and the explorer refuses anything else.
 */
export class ChatScanClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl e.g. `https://chatscan.org`
   * @param {string} [options.ingestKey] sent as a bearer token when the explorer requires one
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeoutMs]
   */
  constructor({ baseUrl, ingestKey, fetch: fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
    if (!baseUrl) throw new TypeError('"baseUrl" is required, e.g. http://localhost:3000');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.ingestKey = ingestKey;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** The explorer's chain state, anchoring rules and record totals. */
  status() {
    return this.#get('/api/v1/status');
  }

  /** Just the chain half of {@link status}. */
  chain() {
    return this.#get('/api/v1/chain');
  }

  /** The X11 round mapping the explorer reports. */
  algorithm() {
    return this.#get('/api/v1/algorithm');
  }

  /**
   * The commitment and `OP_RETURN` payload for a submission that has not been
   * sent yet. Useful as a cross-check: the SDK can derive this offline with
   * `anchorInstructions()`, and both must agree.
   * @param {object} submission
   */
  anchorPayload(submission) {
    return this.#send('POST', '/api/v1/anchor-payload', submission);
  }

  /**
   * Records one encrypted message.
   *
   * Accepts `ciphertextHash`, `size`, `protocol`, `channelHash`, `nonce`, `fee`,
   * `appVersion` and `anchorTxid` - and nothing else. A `202` from the explorer
   * means the record was indexed but rejected on chain policy, which is returned
   * rather than thrown so the caller can inspect `rejectionReason`.
   *
   * @param {object} record
   * @returns {Promise<{ ref: string, hash: string, id: number, status: string, rejectionReason: string | null, commitment: string, anchor: object | null, explorerUrl: string, record: object }>}
   */
  submitRecord(record) {
    return this.#send('POST', '/api/v1/records', record);
  }

  /**
   * @param {string} ref `{HASH}/{ID-number}`
   * @returns {Promise<object>} the record
   */
  async getRecord(ref) {
    const { record } = await this.#get(`/api/v1/records/${encodeRef(ref)}`);
    return record;
  }

  /**
   * @param {string} ref
   * @returns {Promise<object>} the anchor instructions and current anchor state
   */
  getRecordAnchor(ref) {
    return this.#get(`/api/v1/records/${encodeRef(ref)}/anchor`);
  }

  /**
   * Newest-first records.
   * @param {{ limit?: number, offset?: number, status?: string, protocol?: string, channel?: string }} [query]
   */
  listRecords(query = {}) {
    return this.#get(`/api/v1/records${toQuery(query)}`);
  }

  /** @param {{ limit?: number, offset?: number }} [query] */
  listBlocks(query = {}) {
    return this.#get(`/api/v1/blocks${toQuery(query)}`);
  }

  /** @param {number | string} heightOrHash */
  getBlock(heightOrHash) {
    return this.#get(`/api/v1/blocks/${encodeURIComponent(String(heightOrHash))}`);
  }

  /**
   * Resolves a reference, a record or block hash, an anchor transaction id, a
   * height, or an ID-number.
   * @param {string} term
   */
  search(term) {
    return this.#get(`/api/v1/search${toQuery({ q: term })}`);
  }

  /** The explorer page for a record, for linking from a chat UI. */
  recordUrl(ref) {
    return `${this.baseUrl}/tx/${ref}`;
  }

  /** The explorer page for a block. */
  blockUrl(height) {
    return `${this.baseUrl}/block/${height}`;
  }

  /**
   * Subscribes to the explorer's live stream.
   *
   * Implemented over `fetch` rather than `EventSource`, so it behaves the same
   * in Node and in the browser. Returns a handle with `close()`; the stream
   * reconnects on its own until closed.
   *
   * @param {object} handlers
   * @param {(record: object) => void} [handlers.onRecord]
   * @param {(block: object) => void} [handlers.onBlock]
   * @param {(status: object) => void} [handlers.onStatus]
   * @param {(error: unknown) => void} [handlers.onError]
   * @param {number} [handlers.reconnectMs]
   * @returns {{ close: () => void, closed: boolean }}
   */
  watch({ onRecord, onBlock, onStatus, onError, reconnectMs = 3000 } = {}) {
    const controller = new AbortController();
    const handle = {
      closed: false,
      close() {
        handle.closed = true;
        controller.abort();
      },
    };

    const dispatch = (event, data) => {
      try {
        const payload = JSON.parse(data);
        if (event === 'record') onRecord?.(payload);
        else if (event === 'block') onBlock?.(payload);
        else if (event === 'status') onStatus?.(payload);
      } catch (error) {
        onError?.(error);
      }
    };

    const run = async () => {
      while (!handle.closed) {
        try {
          const response = await this.fetch(`${this.baseUrl}/api/v1/stream`, {
            headers: { accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw await errorFromResponse(response);

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!handle.closed) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              let event = 'message';
              let data = '';
              for (const line of frame.split('\n')) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
              }
              if (data) dispatch(event, data);
              boundary = buffer.indexOf('\n\n');
            }
          }
        } catch (error) {
          if (handle.closed || controller.signal.aborted) return;
          onError?.(error);
        }
        if (handle.closed) return;
        await new Promise((resolve) => setTimeout(resolve, reconnectMs));
      }
    };

    void run();
    return handle;
  }

  /**
   * @param {string} path
   * @returns {Promise<any>}
   */
  #get(path) {
    return this.#send('GET', path);
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @returns {Promise<any>}
   */
  async #send(method, path, body) {
    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.ingestKey) headers.authorization = `Bearer ${this.ingestKey}`;

    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ChatScanError({
        status: 0,
        code: 'network_error',
        message: `Could not reach the ChatScan explorer at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (!response.ok) throw await errorFromResponse(response);
    return response.status === 204 ? null : response.json();
  }
}

/** @param {string} ref */
function encodeRef(ref) {
  const [hash, id] = String(ref).split('/');
  if (!hash || !id) throw new TypeError('A record reference looks like {HASH}/{ID-number}.');
  return `${encodeURIComponent(hash)}/${encodeURIComponent(id)}`;
}

/** @param {Record<string, unknown>} query */
function toQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}
