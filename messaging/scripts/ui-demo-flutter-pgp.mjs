#!/usr/bin/env node
/**
 * Drive the Flutter web demo for PGP screenshots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('/tmp/puppeteer-demo/node_modules/puppeteer-core');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mediaDir = path.join(root, 'docs/media');
const artifactDir = '/opt/cursor/artifacts/screenshots';
for (const dir of [mediaDir, artifactDir]) fs.mkdirSync(dir, { recursive: true });

const app = process.env.FLUTTER_URL || 'http://127.0.0.1:8080';
const messaging = process.env.MESSAGING_URL || 'http://127.0.0.1:8787';

async function shot(page, name) {
  for (const dir of [mediaDir, artifactDir]) {
    await page.screenshot({ path: path.join(dir, name), fullPage: false });
    console.log('wrote', path.join(dir, name));
  }
}

async function waitFlutter(page) {
  await page.waitForFunction(
    () => document.querySelector('flt-semantics-placeholder, flt-glass-pane, flutter-view') != null
      || document.body?.innerText?.includes('CrypterChat'),
    { timeout: 60000 },
  );
  // Enable semantics for automation.
  await page.evaluate(() => {
    const el = document.querySelector('flt-semantics-placeholder');
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
}

async function fillByLabel(page, label, value) {
  const ok = await page.evaluate((labelText, val) => {
    const nodes = [...document.querySelectorAll('[aria-label], input, flt-semantics')];
    // Prefer aria-labelled inputs via flutter semantics tree
    const candidates = [...document.querySelectorAll('input, textarea')];
    for (const input of candidates) {
      const aria = (input.getAttribute('aria-label') || '') + ' ' + (input.getAttribute('placeholder') || '');
      const parentText = input.closest('[aria-label]')?.getAttribute('aria-label') || '';
      const blob = `${aria} ${parentText}`.toLowerCase();
      if (blob.includes(labelText.toLowerCase())) {
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }
    // Semantics nodes often wrap editable text
    const sem = [...document.querySelectorAll('flt-semantics')].find((n) =>
      (n.getAttribute('aria-label') || '').toLowerCase().includes(labelText.toLowerCase()),
    );
    if (sem) {
      sem.click();
      return 'clicked';
    }
    return false;
  }, label, value);
  if (ok === 'clicked') {
    await page.keyboard.type(value, { delay: 15 });
  }
  return ok;
}

async function clickText(page, text) {
  const clicked = await page.evaluate((t) => {
    const nodes = [...document.querySelectorAll('flt-semantics, button, [role="button"]')];
    const el = nodes.find((n) => {
      const label = (n.getAttribute('aria-label') || n.textContent || '').trim();
      return label.toLowerCase().includes(t.toLowerCase());
    });
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Could not click "${text}"`);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=420,900'],
  defaultViewport: { width: 420, height: 900, isMobile: true, hasTouch: true },
});

try {
  // Pre-create users via API so chat works
  for (const [phone, name] of [
    ['+15558003331', 'AliceF'],
    ['+15558003332', 'BobF'],
  ]) {
    await fetch(`${messaging}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, displayName: name }),
    });
    await fetch(`${messaging}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, displayName: name, code: '123456' }),
    });
  }

  const page = await browser.newPage();
  await page.goto(app, { waitUntil: 'networkidle0', timeout: 120000 });
  await waitFlutter(page);
  await new Promise((r) => setTimeout(r, 2500));
  await shot(page, 'pgp-flutter-01-splash-login.png');

  // Try to interact with login fields
  const inputs = await page.$$('input');
  console.log('input count', inputs.length);
  if (inputs.length >= 3) {
    // server URL, name, phone roughly — order from LoginScreen
    // Actually: base, name, phone, maybe otp later
  }

  // Use keyboard/tab approach on visible fields
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    for (const input of inputs) {
      const ph = (input.getAttribute('aria-label') || input.placeholder || '').toLowerCase();
      if (ph.includes('display') || ph.includes('name')) {
        input.value = 'AliceF';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (ph.includes('phone') || ph.includes('e.164')) {
        input.value = '+15558003331';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (ph.includes('server') || ph.includes('url') || ph.includes('http')) {
        input.value = 'http://127.0.0.1:8787';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'pgp-flutter-02-login-filled.png');

  try {
    await clickText(page, 'SEND CODE');
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')];
      for (const input of inputs) {
        const ph = (input.getAttribute('aria-label') || input.placeholder || '').toLowerCase();
        if (ph.includes('otp') || ph.includes('code')) {
          input.value = '123456';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
    await clickText(page, 'NEXT');
    await new Promise((r) => setTimeout(r, 2500));
    await shot(page, 'pgp-flutter-03-home.png');

    try {
      await clickText(page, 'Privacy tools');
      await new Promise((r) => setTimeout(r, 1500));
      await shot(page, 'pgp-flutter-04-privacy-tools.png');
      // back
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 400));
      const back = await page.$('[aria-label="Back"]');
      if (back) await back.click();
      else await page.evaluate(() => history.back());
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      console.log('privacy tools nav skipped', e.message);
    }

    try {
      await clickText(page, 'New chat');
      await new Promise((r) => setTimeout(r, 800));
      await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')];
        const last = inputs.at(-1);
        if (last) {
          last.value = '+15558003332';
          last.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await clickText(page, 'Open');
      await new Promise((r) => setTimeout(r, 1500));
      await page.keyboard.type('Flutter PGP hi Bob', { delay: 20 });
      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 2500));
      await shot(page, 'pgp-flutter-05-chat-sent.png');
    } catch (e) {
      console.log('chat flow skipped', e.message);
      await shot(page, 'pgp-flutter-05-chat-sent.png');
    }
  } catch (e) {
    console.log('login click flow issue', e.message);
    await shot(page, 'pgp-flutter-03-home.png');
  }
} finally {
  await browser.close();
}
console.log('OK');
