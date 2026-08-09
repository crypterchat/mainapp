/**
 * An error returned by a ChatScan explorer.
 *
 * `code` is the explorer's machine-readable reason - `content_rejected`,
 * `unknown_field`, `invalid_hash`, `rate_limited`, `cdci_unavailable`,
 * `not_found`, ... - so a chat app can branch on it instead of parsing prose.
 */
export class ChatScanError extends Error {
  /**
   * @param {object} args
   * @param {number} args.status HTTP status
   * @param {string} args.code
   * @param {string} args.message
   * @param {Record<string, unknown>} [args.details]
   */
  constructor({ status, code, message, details = {} }) {
    super(message);
    this.name = 'ChatScanError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /**
   * True when retrying later could succeed: the explorer was unreachable, busy,
   * or its CDCI node was not answering. None of these mean the submission is
   * wrong, so a chat app should queue the message rather than drop it.
   */
  get retryable() {
    return (
      this.status === 0 ||
      this.status >= 500 ||
      this.code === 'network_error' ||
      this.code === 'rate_limited' ||
      this.code === 'cdci_unavailable'
    );
  }

  /** True when the submission itself is at fault and retrying will not help. */
  get clientFault() {
    return this.status >= 400 && this.status < 500 && !this.retryable;
  }
}

/**
 * Builds a {@link ChatScanError} from a fetch Response.
 * @param {Response} response
 * @returns {Promise<ChatScanError>}
 */
export async function errorFromResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = body?.error ?? {};
  const { code, message, ...details } = error;
  return new ChatScanError({
    status: response.status,
    code: code ?? `http_${response.status}`,
    message: message ?? `ChatScan request failed with HTTP ${response.status}.`,
    details,
  });
}
