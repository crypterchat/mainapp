#!/usr/bin/env node
/**
 * Headless UI demo: Alice <-> Bob through ChatScan, with screenshots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDirs = [
  path.join(root, 'docs/media'),
  '/opt/cursor/artifacts/screenshots',
];
for (const dir of outDirs) fs.mkdirSync(dir, { recursive: true });

// Prefer system chrome + puppeteer-core from a temp install.
let puppeteer;
try {
  puppeteer = require('/tmp/puppeteer-demo/node_modules/puppeteer-core');
} catch {
  console.error('Install puppeteer-core in /tmp/puppeteer-demo first');
  process.exit(1);
}

const base = process.env.MESSAGING_URL || 'http://127.0.0.1:8787';
const explorer = process.env.CHATSCAN_URL || 'http://127.0.0.1:3000';

async function shot(page, name) {
  for (const dir of outDirs) {
    const file = path.join(dir, name);
    await page.screenshot({ path: file, fullPage: false });
    console.log('wrote', file);
  }
}

async function login(page, { name, phone }) {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.type('#display-name', name, { delay: 15 });
  await page.type('#phone', phone, { delay: 15 });
  await Promise.all([
    page.click('#otp-request-form button[type="submit"]'),
    page.waitForSelector('#otp-verify-form:not(.hidden)', { timeout: 5000 }),
  ]);
  await page.type('#otp', '123456', { delay: 20 });
  await Promise.all([
    page.click('#otp-verify-form button[type="submit"]'),
    page.waitForSelector('#app-view:not(.hidden)', { timeout: 8000 }),
  ]);
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const alice = await browser.newPage();
  await login(alice, { name: 'Alice', phone: '+15551110001' });
  await shot(alice, '04-alice-home.png');

  await alice.type('#peer-phone', '+15551110002', { delay: 15 });
  await alice.click('#new-chat-form button[type="submit"]');
  await alice.waitForSelector('#active-chat:not(.hidden)', { timeout: 5000 });
  await alice.type('#message-input', 'Hello Bob — sealed on ChatScan X11', { delay: 12 });
  await alice.click('#send-form button[type="submit"]');
  await alice.waitForFunction(
    () => document.querySelectorAll('#message-list .bubble').length >= 1,
    { timeout: 10000 },
  );
  await new Promise((r) => setTimeout(r, 800));
  await shot(alice, '05-alice-sent.png');

  const ref = await alice.$eval('#message-list .bubble .meta span', (el) => el.textContent || '');
  console.log('alice message meta', ref);

  const bob = await browser.newPage();
  await login(bob, { name: 'Bob', phone: '+15551110002' });
  await bob.waitForFunction(
    () => document.querySelectorAll('#conversation-list .conversation-item').length >= 1,
    { timeout: 10000 },
  );
  await bob.click('#conversation-list .conversation-item');
  await bob.waitForSelector('#active-chat:not(.hidden)');
  await bob.waitForFunction(
    () => [...document.querySelectorAll('#message-list .bubble')].some((b) => b.textContent.includes('Hello Bob')),
    { timeout: 10000 },
  );
  await shot(bob, '06-bob-received.png');

  const chain = await browser.newPage();
  await chain.goto(explorer, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  await shot(chain, '07-chatscan-dashboard.png');
  // Open newest record from API
  const records = await (await fetch(`${explorer}/api/v1/records?limit=1`)).json();
  const newest = records.records[0];
  await chain.goto(`${explorer}/tx/${newest.ref}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  await shot(chain, '08-chatscan-record-private.png');
  console.log('record contentAvailable', newest.contentAvailable, 'ref', newest.ref);
} finally {
  await browser.close();
}
