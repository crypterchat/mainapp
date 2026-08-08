const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** @param {number} value */
export function formatNumber(value) {
  return Number(value ?? 0).toLocaleString('en-US');
}

/**
 * @param {number} value
 * @param {number} [digits]
 */
export function formatDecimal(value, digits = 2) {
  return Number(value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  let value = Number(bytes ?? 0);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 2;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** @param {number} usd */
export function formatUsd(usd) {
  return `$ ${formatDecimal(usd, 3)}`;
}

/**
 * Shortened hash for dense table cells.
 * @param {string} hash
 * @param {number} [head]
 * @param {number} [tail]
 */
export function shortHash(hash, head = 10, tail = 8) {
  if (typeof hash !== 'string' || hash.length <= head + tail + 1) return String(hash ?? '');
  return `${hash.slice(0, head)}...${hash.slice(-tail)}`;
}

/**
 * @param {number | string | null} timestamp epoch ms or ISO string
 * @param {number} [now]
 */
export function formatRelativeTime(timestamp, now = Date.now()) {
  if (timestamp === null || timestamp === undefined) return 'unknown';
  const ms = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(ms)) return 'unknown';

  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * @param {number | string | null} timestamp
 */
export function formatTimestamp(timestamp) {
  if (timestamp === null || timestamp === undefined) return '-';
  const ms = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(ms)) return '-';
  return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}
