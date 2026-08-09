import http from 'node:http';

import { HttpError, notFound } from '../util/errors.js';
import { registerApiRoutes } from './api.js';
import { registerPageRoutes, sendErrorPage } from './pages.js';
import { RateLimiter } from './rate-limit.js';
import { sendError, writeHead } from './respond.js';
import { createRouter } from './router.js';
import { serveStatic } from './static.js';

/**
 * Builds the ChatScan HTTP server.
 * @param {object} args
 * @param {import('../store/store.js').ChatScanStore} args.store
 * @param {import('../chain/service.js').ChainService} args.chain
 * @param {import('../config.js').Config} args.config
 */
export function createServer({ store, chain, config }) {
  const limiter = new RateLimiter({ limit: config.ingestRatePerMinute });
  const router = createRouter();
  const ctx = { store, chain, config, limiter };

  registerApiRoutes(router, ctx);
  registerPageRoutes(router, ctx);

  const server = http.createServer((req, res) => {
    handle(req, res, router, ctx).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      respondWithError(req, res, ctx, error).catch(() => res.destroy());
    });
  });

  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  return server;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {ReturnType<typeof createRouter>} router
 * @param {{ store: any, node: any, config: import('../config.js').Config, limiter: RateLimiter }} ctx
 */
async function handle(req, res, router, ctx) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = decodeSafe(url.pathname);

  if (!['GET', 'HEAD', 'POST'].includes(req.method ?? '')) {
    throw new HttpError(405, 'method_not_allowed', `${req.method} is not supported.`);
  }

  const route = router.match(req.method ?? 'GET', pathname);
  if (route) {
    await route.handler(req, res, {
      params: route.params,
      query: url.searchParams,
      clientKey: clientKey(req),
    });
    return;
  }

  const allowed = router.allowedMethods(pathname);
  if (allowed.length > 0) {
    throw new HttpError(405, 'method_not_allowed', `Use ${allowed.join(', ')} on ${pathname}.`);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(res, ctx.config.publicDir, pathname);
    return;
  }

  throw notFound(`No route for ${req.method} ${pathname}.`);
}

/**
 * API clients get JSON errors; browsers get the explorer error page.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ store: any, chain: any, config: import('../config.js').Config }} ctx
 * @param {unknown} error
 */
async function respondWithError(req, res, ctx, error) {
  const url = req.url ?? '/';
  const accepts = String(req.headers.accept ?? '');
  const wantsJson =
    url.startsWith('/api/') ||
    url === '/healthz' ||
    (accepts.includes('application/json') && !accepts.includes('text/html'));

  if (wantsJson) {
    sendError(res, error, true);
    return;
  }

  const httpError = error instanceof HttpError ? error : null;
  if (!httpError) {
    process.emitWarning(`ChatScan page failed: ${error instanceof Error ? error.stack : String(error)}`);
  }

  try {
    await sendErrorPage(res, ctx, httpError?.status ?? 500, httpError?.message ?? 'The explorer hit an unexpected error.');
  } catch {
    const body = 'ChatScan is unavailable.\n';
    writeHead(res, 500, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }
}

/** @param {string} pathname */
function decodeSafe(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Rate-limit bucket key. Trusts no forwarded headers by default, since a public
 * deployment should terminate them at the gateway.
 * @param {import('node:http').IncomingMessage} req
 */
function clientKey(req) {
  return req.socket.remoteAddress ?? 'unknown';
}
