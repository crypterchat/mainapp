import fsp from 'node:fs/promises';
import path from 'node:path';

import { notFound } from '../util/errors.js';
import { writeHead } from './respond.js';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves a file from the public directory. Paths are resolved and checked so a
 * traversal attempt can never escape the root.
 * @param {import('node:http').ServerResponse} res
 * @param {string} publicDir
 * @param {string} relativePath
 */
export async function serveStatic(res, publicDir, relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) throw notFound('Unsupported static asset type.');

  const target = path.resolve(publicDir, `.${path.posix.resolve('/', relativePath)}`);
  const root = path.resolve(publicDir);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw notFound('Asset not found.');
  }

  let contents;
  try {
    contents = await fsp.readFile(target);
  } catch {
    throw notFound('Asset not found.');
  }

  writeHead(res, 200, {
    'content-type': contentType,
    'content-length': contents.length,
    'cache-control': 'public, max-age=300',
  });
  res.end(contents);
}
