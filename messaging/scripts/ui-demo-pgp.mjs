#!/usr/bin/env node
/**
 * Headless PGP + ChatScan UI demo: screenshots + MP4 walkthrough.
 *
 *   node messaging/scripts/ui-demo-pgp.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mediaDir = path.join(root, 'docs/media');
const artifactDir = '/opt/cursor/artifacts/screenshots';
const frameDir = '/tmp/pgp-demo-frames';
for (const dir of [mediaDir, artifactDir, frameDir]) fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(frameDir)) fs.unlinkSync(path.join(frameDir, f));

let puppeteer;
try {
  puppeteer = require('/tmp/puppeteer-demo/node_modules/puppeteer-core');
} catch {
  console.error('Install puppeteer-core in /tmp/puppeteer-demo first');
  process.exit(1);
}

const base = process.env.MESSAGING_URL || 'http://127.0.0.1:8787';
const explorer = process.env.CHATSCAN_URL || 'http://127.0.0.1:3000';
const alicePhone = '+15558001111';
const bobPhone = '+15558002222';
let frameIndex = 0;

async function shot(page, name) {
  for (const dir of [mediaDir, artifactDir]) {
    const file = path.join(dir, name);
    await page.screenshot({ path: file, fullPage: false });
    console.log('wrote', file);
  }
  // Also keep a sequenced frame for the video slideshow.
  const frame = path.join(frameDir, `frame-${String(frameIndex++).padStart(3, '0')}.png`);
  await page.screenshot({ path: frame, fullPage: false });
}

async function hold(page, ms = 900) {
  await new Promise((r) => setTimeout(r, ms));
  const frame = path.join(frameDir, `frame-${String(frameIndex++).padStart(3, '0')}.png`);
  await page.screenshot({ path: frame, fullPage: false });
}

async function login(page, { name, phone }) {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#display-name');
  await page.click('#display-name', { clickCount: 3 });
  await page.type('#display-name', name, { delay: 12 });
  await page.click('#phone', { clickCount: 3 });
  await page.type('#phone', phone, { delay: 12 });
  await Promise.all([
    page.click('#otp-request-form button[type="submit"]'),
    page.waitForSelector('#otp-verify-form:not(.hidden)', { timeout: 8000 }),
  ]);
  await page.click('#otp', { clickCount: 3 });
  await page.type('#otp', '123456', { delay: 20 });
  await Promise.all([
    page.click('#otp-verify-form button[type="submit"]'),
    page.waitForSelector('#app-view:not(.hidden)', { timeout: 12000 }),
  ]);
  await page.waitForFunction(
    () => (document.querySelector('#chain-pill')?.textContent || '').includes('PGP'),
    { timeout: 10000 },
  );
}

function makeVideo() {
  const outMedia = path.join(mediaDir, 'crypterchat-pgp-chatscan-demo.mp4');
  const outArt = '/opt/cursor/artifacts/crypterchat-pgp-chatscan-demo.mp4';
  const args = [
    '-y',
    '-framerate', '1/2.2',
    '-i', path.join(frameDir, 'frame-%03d.png'),
    '-vf', 'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,fps=30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outMedia,
  ];
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: 'inherit' });
    ff.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}`));
      fs.copyFileSync(outMedia, outArt);
      console.log('wrote', outMedia);
      console.log('wrote', outArt);
      resolve(outMedia);
    });
  });
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  // --- Login screen (OpenPGP copy) ---
  const alice = await browser.newPage();
  await alice.goto(base, { waitUntil: 'networkidle0' });
  await alice.evaluate(() => localStorage.clear());
  await alice.reload({ waitUntil: 'networkidle0' });
  await hold(alice, 600);
  await shot(alice, 'pgp-01-login.png');

  await login(alice, { name: 'Alice', phone: alicePhone });
  await hold(alice, 800);
  await shot(alice, 'pgp-02-alice-home.png');

  // Privacy tools catalog (render from API)
  const toolsPage = await browser.newPage();
  const tools = await (await fetch(`${base}/api/privacy/tools`)).json();
  const health = await (await fetch(`${base}/api/health`)).json();
  await toolsPage.setContent(`<!doctype html><html><head><meta charset="utf-8"/>
    <style>
      body{font-family:Figtree,system-ui,sans-serif;margin:0;background:linear-gradient(160deg,#f7f4ff,#eef6ff);color:#1e1e1e}
      main{max-width:920px;margin:40px auto;padding:28px 32px;background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(40,20,80,.08)}
      h1{font-family:Fraunces,Georgia,serif;font-size:2rem;margin:0 0 .4rem}
      .lede{color:#667781;line-height:1.45;margin:0 0 1.25rem}
      .pill{display:inline-block;background:#f0ebff;color:#5B36D0;padding:.35rem .7rem;border-radius:999px;font-size:.85rem;margin-right:.4rem}
      .tool{border-top:1px solid #ece8f5;padding:14px 0}
      .tool strong{display:block;font-size:1.05rem}
      .meta{color:#8596A0;font-size:.9rem;margin-top:.25rem;line-height:1.4}
      .ok{color:#2e7d32;font-weight:600}
      .soft{color:#8a6d3b;font-weight:600}
    </style></head><body><main>
      <h1>CrypterChat privacy tools</h1>
      <p class="lede">OpenPGP encrypts chat. ChatScan seals only the hash. Compatible tools plug into the same stack.</p>
      <p><span class="pill">default: ${tools.defaultTool}</span>
         <span class="pill">server: ${health.server?.name || 'chat'}</span>
         <span class="pill">chain: ${health.chatscan?.chainId || ''}</span></p>
      ${(tools.tools || []).map((t) => `
        <div class="tool">
          <strong>${t.name} · <span class="${t.status === 'active' ? 'ok' : 'soft'}">${t.status}</span></strong>
          <div class="meta">${t.role}<br/>Works with: ${(t.worksWith || []).join(', ')}</div>
        </div>`).join('')}
      <div class="tool"><strong>Stack</strong><div class="meta">${(tools.stack || []).map((s, i) => `${i + 1}. ${s}`).join('<br/>')}</div></div>
    </main></body></html>`, { waitUntil: 'domcontentloaded' });
  await hold(toolsPage, 700);
  await shot(toolsPage, 'pgp-03-privacy-tools.png');
  await toolsPage.close();

  // Alice opens chat + sends PGP message
  await alice.bringToFront();
  await alice.click('#peer-phone', { clickCount: 3 });
  await alice.type('#peer-phone', bobPhone, { delay: 12 });
  await alice.click('#new-chat-form button[type="submit"]');
  await alice.waitForSelector('#active-chat:not(.hidden)', { timeout: 8000 });
  await alice.waitForSelector('#crypto-tool');
  await alice.select('#crypto-tool', 'pgp');
  await hold(alice, 500);
  await shot(alice, 'pgp-04-alice-composer.png');

  const msg = `PGP hello Bob — ${new Date().toISOString()}`;
  await alice.click('#message-input', { clickCount: 3 });
  await alice.type('#message-input', msg, { delay: 10 });
  await alice.click('#send-form button[type="submit"]');
  await alice.waitForFunction(
    () => [...document.querySelectorAll('#message-list .bubble')].some((b) => b.textContent.includes('PGP hello Bob')),
    { timeout: 15000 },
  );
  await hold(alice, 900);
  await shot(alice, 'pgp-05-alice-sent.png');

  const sentMeta = await alice.evaluate(() => {
    const bubble = [...document.querySelectorAll('#message-list .bubble')].at(-1);
    return bubble?.querySelector('.bubble-foot')?.textContent || '';
  });
  console.log('alice bubble foot', sentMeta);

  // Bob receives
  const bob = await browser.newPage();
  await login(bob, { name: 'Bob', phone: bobPhone });
  await bob.waitForFunction(
    () => document.querySelectorAll('#conversation-list .conversation-item').length >= 1,
    { timeout: 12000 },
  );
  await hold(bob, 600);
  await shot(bob, 'pgp-06-bob-list.png');
  await bob.click('#conversation-list .conversation-item');
  await bob.waitForSelector('#active-chat:not(.hidden)');
  await bob.waitForFunction(
    () => [...document.querySelectorAll('#message-list .bubble')].some((b) => b.textContent.includes('PGP hello Bob')),
    { timeout: 15000 },
  );
  await hold(bob, 900);
  await shot(bob, 'pgp-07-bob-received.png');

  // ChatScan explorer + PGP record
  const chain = await browser.newPage();
  await chain.goto(explorer, { waitUntil: 'domcontentloaded' });
  await hold(chain, 1100);
  await shot(chain, 'pgp-08-chatscan-dashboard.png');

  const records = await (await fetch(`${explorer}/api/v1/records?limit=5`)).json();
  const pgpRecord = (records.records || records.items || []).find((r) => r.protocol === 'PGP')
    || (records.records || records.items || [])[0];
  if (!pgpRecord) throw new Error('No ChatScan records found');
  await chain.goto(`${explorer}/tx/${pgpRecord.ref}`, { waitUntil: 'domcontentloaded' });
  await hold(chain, 1200);
  await shot(chain, 'pgp-09-chatscan-pgp-record.png');
  console.log('record', {
    ref: pgpRecord.ref,
    protocol: pgpRecord.protocol,
    contentAvailable: pgpRecord.contentAvailable,
  });
  if (pgpRecord.contentAvailable === true) {
    throw new Error('ChatScan unexpectedly exposes content');
  }

  // Snapshot JSON for README / CI
  const snapshot = {
    capturedAt: new Date().toISOString(),
    messaging: base,
    explorer,
    defaultTool: tools.defaultTool,
    alicePhone,
    bobPhone,
    messagePreview: msg,
    record: {
      ref: pgpRecord.ref,
      protocol: pgpRecord.protocol,
      contentAvailable: pgpRecord.contentAvailable,
      ciphertextHash: pgpRecord.ciphertextHash,
    },
    screenshots: [
      'pgp-01-login.png',
      'pgp-02-alice-home.png',
      'pgp-03-privacy-tools.png',
      'pgp-04-alice-composer.png',
      'pgp-05-alice-sent.png',
      'pgp-06-bob-list.png',
      'pgp-07-bob-received.png',
      'pgp-08-chatscan-dashboard.png',
      'pgp-09-chatscan-pgp-record.png',
    ],
    video: 'crypterchat-pgp-chatscan-demo.mp4',
  };
  fs.writeFileSync(path.join(mediaDir, 'pgp-demo-snapshot.json'), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(artifactDir, 'pgp-demo-snapshot.json'), JSON.stringify(snapshot, null, 2));
  console.log('wrote snapshot');

  await makeVideo();
  console.log('OK');
} finally {
  await browser.close();
}
