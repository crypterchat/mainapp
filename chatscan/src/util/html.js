/** Marker for a string that is already HTML-safe. */
class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Marks a string as pre-escaped HTML. Only use it for markup this codebase
 * produces, never for request data.
 * @param {string} value
 */
export function raw(value) {
  return new SafeHtml(value);
}

/**
 * Tagged template that escapes every interpolated value unless it is already
 * {@link SafeHtml}. Arrays are concatenated, `null`/`undefined`/`false` render
 * as nothing.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 */
export function html(strings, ...values) {
  let output = '';
  for (const [index, chunk] of strings.entries()) {
    output += chunk;
    if (index < values.length) output += stringify(values[index]);
  }
  return new SafeHtml(output);
}

/** @param {unknown} value */
function stringify(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(stringify).join('');
  return escapeHtml(value);
}

/** @param {unknown} value */
export function render(value) {
  return stringify(value);
}

export { SafeHtml };
