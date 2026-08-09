import { HttpError, badRequest } from '../util/errors.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Record<string, string>} [headers]
 */
export function writeHead(res, status, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, payload, headers = {}) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  writeHead(res, status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
export function sendHtml(res, status, html) {
  writeHead(res, status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  res.end(html);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} error
 * @param {boolean} wantsJson
 */
export function sendError(res, error, wantsJson) {
  const httpError =
    error instanceof HttpError
      ? error
      : new HttpError(500, 'internal_error', 'The ChatScan node hit an unexpected error.');

  if (!(error instanceof HttpError)) {
    process.emitWarning(`ChatScan request failed: ${error instanceof Error ? error.stack : String(error)}`);
  }

  if (wantsJson) {
    sendJson(res, httpError.status, {
      error: { code: httpError.code, message: httpError.message, ...(httpError.details ?? {}) },
    });
    return;
  }
  const body = `${httpError.status} ${httpError.code}: ${httpError.message}\n`;
  writeHead(res, httpError.status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Reads a JSON request body, refusing anything larger than `maxBytes`.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 */
export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] ?? '');
    if (contentType && !contentType.toLowerCase().startsWith('application/json')) {
      reject(badRequest('unsupported_media_type', 'Content-Type must be application/json.'));
      return;
    }

    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      // Drain rather than destroy, so the client still receives the response.
      req.resume();
      reject(error);
    };

    const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      fail(new HttpError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes.`));
      return;
    }

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(new HttpError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => fail(badRequest('body_read_failed', 'Could not read the request body.')));

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(badRequest('invalid_json', 'Request body is not valid JSON.'));
      }
    });
  });
}
