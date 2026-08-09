import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export const config = {
  host: env('MESSAGING_HOST', '0.0.0.0'),
  port: Number(env('MESSAGING_PORT', '8787')),
  dataDir: path.resolve(env('MESSAGING_DATA_DIR', path.join(root, 'data'))),
  /**
   * Shared ChatScan explorer / X11 chain. Your chat server keeps encrypted
   * envelopes locally; only ciphertext hashes are submitted here.
   */
  chatscanUrl: env('CHATSCAN_URL', 'http://127.0.0.1:3000').replace(/\/$/, ''),
  chatscanIngestKey: env('CHATSCAN_INGEST_KEY', ''),
  /** Friendly name shown in CrypterChat when users connect to this server. */
  serverName: env('SERVER_NAME', 'My CrypterChat Server'),
  /** Optional public base URL advertised to clients (e.g. https://chat.example.com). */
  publicUrl: env('PUBLIC_URL', '').replace(/\/$/, ''),
  appVersion: env('APP_VERSION', 'crypterchat-1.0'),
  /** Demo OTP accepted in local/dev so phone login works without SMS providers. */
  demoOtp: env('DEMO_OTP', '123456'),
  /**
   * Passphrase used to protect per-user OpenPGP private keys in demo mode.
   * Change in production; clients can unlock with the same passphrase.
   */
  pgpPassphrase: env('PGP_PASSPHRASE', 'crypterchat-demo'),
  /** Default message crypto tool: pgp | aes */
  defaultCryptoTool: env('DEFAULT_CRYPTO_TOOL', 'pgp'),
  sessionTtlMs: Number(env('SESSION_TTL_MS', String(7 * 24 * 60 * 60 * 1000))),
  publicDir: path.join(root, 'public'),
};
