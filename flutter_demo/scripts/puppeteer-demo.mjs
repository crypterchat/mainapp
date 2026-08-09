#!/usr/bin/env node
/**
 * Drive the Flutter WhatsApp-style web UI through a full Alice→Bob ChatScan chat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('/tmp/puppeteer-demo/node_modules/puppeteer-core');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDirs = [path.join(root, 'docs/media'), '/opt/cursor/artifacts/screenshots'];
for (const d of outDirs) fs.mkdirSync(d, { recursive: true });

const base = process.env.FLUTTER_URL || 'http://127.0.0.1:8080';

async function shot(page, name) {
  for (const dir of outDirs) {
    const file = path.join(dir, name);
    await page.screenshot({ path: file, fullPage: false });
    console.log('wrote', file);
  }
}

async function fillByLabel(page, labelText, value) {
  // Flutter HTML renderer uses semantic labels / aria
  const handled = await page.evaluate((label, val) => {
    const inputs = [...document.querySelectorAll('input, textarea')];
    const match = inputs.find((el) => {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      const nearby = (el.parentElement?.textContent || '').toLowerCase();
      const l = label.toLowerCase();
      return aria.includes(l) || placeholder.includes(l) || nearby.includes(l);
    });
    if (!match) return false;
    match.focus();
    match.value = '';
    match.dispatchEvent(new Event('input', { bubbles: true }));
    match.value = val;
    match.dispatchEvent(new Event('input', { bubbles: true }));
    match.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, labelText, value);
  if (!handled) throw new Error(`Could not find field for ${labelText}`);
}

async function clickButton(page, text) {
  const clicked = await page.evaluate((t) => {
    const wanted = t.toLowerCase();
    const nodes = [...document.querySelectorAll('button, [role="button"], flutter-view *, flt-semantics')];
    const el = nodes.find((n) => (n.textContent || '').trim().toLowerCase() === wanted)
      || nodes.find((n) => (n.textContent || '').trim().toLowerCase().includes(wanted));
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!clicked) {
    // fallback: mouse click via coordinates of text
    const [el] = await page.$x(`//*[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '${text.toUpperCase()}')]`);
    if (!el) throw new Error(`Button not found: ${text}`);
    const box = await el.boundingBox();
    if (!box) throw new Error(`No box for ${text}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

async function login(page, { name, phone }) {
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 1500));

  // Update bridge URL first
  await fillByLabel(page, 'Messaging bridge URL', 'http://127.0.0.1:8787');
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 1500));
  await fillByLabel(page, 'Display name', name);
  await fillByLabel(page, 'Phone number', phone);
  await shot(page, `flutter-${name.toLowerCase()}-login.png`);
  await clickButton(page, 'SEND CODE');
  await new Promise((r) => setTimeout(r, 1500));
  // OTP may appear
  try {
    await fillByLabel(page, 'OTP', '123456');
  } catch {
    /* maybe auto */
  }
  try {
    await clickButton(page, 'NEXT');
  } catch {
    await clickButton(page, 'SEND CODE');
  }
  await page.waitForFunction(
    () => document.body.innerText.includes('CrypterChat') && document.body.innerText.includes('ChatScan'),
    { timeout: 15000 },
  );
  await new Promise((r) => setTimeout(r, 1000));
}

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=400,900'],
});

try {
  const alice = await browser.newPage();
  await login(alice, { name: 'Alice', phone: '+15551110001' });
  await shot(alice, 'flutter-alice-home.png');

  // New chat FAB / dialog
  await clickButton(alice, 'message'); // may be icon-only; fallback below
} catch (e) {
  console.error('icon click failed', e.message);
}

try {
  // Use API-assisted UI path: open dialog by evaluating floating action if needed
  const page = (await browser.pages()).at(-1);
  // Tap FAB roughly bottom-right
  await page.mouse.click(340, 780);
  await new Promise((r) => setTimeout(r, 800));
  await fillByLabel(page, 'Phone number', '+15551110002');
  await clickButton(page, 'Open');
  await new Promise((r) => setTimeout(r, 1000));
  await fillByLabel(page, 'Message', 'Flutter WhatsApp UI — sealed on ChatScan X11');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2500));
  await shot(page, 'flutter-alice-sent.png');
  const body = await page.evaluate(() => document.body.innerText);
  console.log('alice screen contains On chain?', body.includes('On chain') || body.includes('ref '));
  console.log(body.slice(0, 500));

  // Bob in new context
  const bob = await browser.newPage();
  await login(bob, { name: 'Bob', phone: '+15551110002' });
  await shot(bob, 'flutter-bob-home.png');
  // Open Alice conversation
  const opened = await bob.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')];
    const hit = nodes.find((n) => (n.textContent || '').includes('+15551110001') || (n.textContent || '').includes('Alice'));
    if (!hit) return false;
    hit.click();
    return true;
  });
  console.log('opened alice chat for bob', opened);
  await new Promise((r) => setTimeout(r, 1500));
  await shot(bob, 'flutter-bob-received.png');
  const bobBody = await bob.evaluate(() => document.body.innerText);
  console.log('bob has message?', bobBody.includes('Flutter WhatsApp UI'));
} finally {
  await browser.close();
}
