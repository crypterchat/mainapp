import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { Store } from './store.js';
import { ChatScanBridge } from './chatscan.js';
import { createApi } from './api.js';

const store = new Store(config.dataDir);
const chatscan = new ChatScanBridge({
  baseUrl: config.chatscanUrl,
  ingestKey: config.chatscanIngestKey,
  appVersion: config.appVersion,
});

const handleApi = createApi({ store, chatscan });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};

function serveStatic(req, res, url) {
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(config.publicDir, rel);
  if (!file.startsWith(config.publicDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // CORS for Flutter / local tooling
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  serveStatic(req, res, url);
});

async function main() {
  let chain;
  try {
    chain = await chatscan.connect();
  } catch (error) {
    console.error('Failed to connect to ChatScan at', config.chatscanUrl);
    console.error(error.message);
    console.error('Start ChatScan first: cd chatscan && npm start');
    process.exit(1);
  }

  server.listen(config.port, config.host, () => {
    const publicBase = config.publicUrl || `http://127.0.0.1:${config.port}`;
    console.log(`CrypterChat server     ${config.serverName}`);
    console.log(`Base URL (paste in app) ${publicBase}`);
    console.log(`Listen                 http://${config.host}:${config.port}`);
    console.log(`Chat data directory    ${config.dataDir}`);
    console.log(`ChatScan (hashes only) ${config.chatscanUrl}`);
    console.log(`Chain                  ${chain.chainId} (${chain.backend}) height=${chain.height}`);
    console.log(`Demo OTP               ${config.demoOtp}`);
  });
}

main();
