/**
 * Minimal path router. Patterns support `:name` segments and a trailing `*`
 * wildcard, which is all the explorer needs and keeps the project dependency
 * free.
 */
export function createRouter() {
  /** @type {{ method: string, segments: string[], handler: Function }[]} */
  const routes = [];

  /**
   * @param {string} method
   * @param {string} pattern
   * @param {Function} handler
   */
  function add(method, pattern, handler) {
    routes.push({ method, segments: split(pattern), handler });
  }

  return {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    /**
     * @param {string} method
     * @param {string} pathname
     * @returns {{ handler: Function, params: Record<string, string> } | null}
     */
    match(method, pathname) {
      const parts = split(pathname);
      const wanted = method === 'HEAD' ? 'GET' : method;
      for (const route of routes) {
        if (route.method !== wanted) continue;
        const params = matchSegments(route.segments, parts);
        if (params) return { handler: route.handler, params };
      }
      return null;
    },
    /** @param {string} pathname */
    allowedMethods(pathname) {
      const parts = split(pathname);
      const methods = new Set();
      for (const route of routes) {
        if (matchSegments(route.segments, parts)) methods.add(route.method);
      }
      return [...methods];
    },
  };
}

/** @param {string} pathname */
function split(pathname) {
  return pathname.split('/').filter((segment) => segment.length > 0);
}

/**
 * @param {string[]} pattern
 * @param {string[]} parts
 * @returns {Record<string, string> | null}
 */
function matchSegments(pattern, parts) {
  /** @type {Record<string, string>} */
  const params = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const segment = pattern[i];
    if (segment === '*') {
      params.wildcard = parts.slice(i).join('/');
      return params;
    }
    if (i >= parts.length) return null;
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(parts[i]);
      continue;
    }
    if (segment !== parts[i]) return null;
  }
  return pattern.length === parts.length ? params : null;
}
