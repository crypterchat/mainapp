/** Error carrying an HTTP status and a machine-readable code. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
export function badRequest(code, message, details) {
  return new HttpError(400, code, message, details);
}

/**
 * @param {string} message
 */
export function unauthorized(message = 'A valid ingest key is required.') {
  return new HttpError(401, 'unauthorized', message);
}

/**
 * @param {string} message
 */
export function notFound(message = 'Not found.') {
  return new HttpError(404, 'not_found', message);
}

/**
 * @param {string} message
 */
export function tooManyRequests(message = 'Ingest rate limit exceeded.') {
  return new HttpError(429, 'rate_limited', message);
}
