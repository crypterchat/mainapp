# Privacy tools with CrypterChat + ChatScan

CrypterChat is built as a **stack**, not a single crypto choice.

```
You type a message
        │
        ▼
 OpenPGP encrypt + sign   ←── default (or AES-GCM / BYO age…)
        │
        ├─ armored ciphertext ──▶ your chat server mailbox
        │
        └─ SHA-256(ciphertext) ──▶ ChatScan X11 (public, immutable)
```

## Active in this repo

| Tool | Role |
| --- | --- |
| **OpenPGP** | Per-user Curve25519 keys; encrypt + sign chat (`protocol: PGP`) |
| **ChatScan X11** | Shared chain of ciphertext hashes only (`contentAvailable=false`) |
| **AES-256-GCM (C7)** | ChatScan SDK envelopes when `tool=aes` |
| **Self-hosted server** | Encrypted mailboxes stay on a machine you control |

## Compatible add-ons

These are not shipped as first-party crypto, but they fit the same model:

| Tool | How it fits |
| --- | --- |
| **age** | Encrypt offline → submit digest via ChatScan `digestCiphertext` / `recordSealed` |
| **Tor onion** | Publish `PUBLIC_URL=http://….onion` and paste that URL in Server settings |
| **Minisign / signify** | Detached signatures for releases/artifacts; ChatScan still seals message hashes |

API catalog (live from a running server):

```bash
curl -s http://127.0.0.1:8787/api/privacy/tools | jq
```

## OpenPGP details

* Keys are created on first phone login (`POST /api/auth/verify-otp`)
* Private keys are passphrase-protected (`PGP_PASSPHRASE`, demo default `crypterchat-demo`)
* Sessions auto-unlock in demo mode so Flutter / web work immediately
* Messages are encrypted to **sender + recipient** public keys and signed by the sender
* ChatScan stores only the hash of the armored ciphertext under protocol **`PGP`**

```bash
# Prove PGP send/receive + hash-only chain
cd messaging && npm run test:pgp
```

## Choosing a tool when sending

```http
POST /api/messages/send
{ "to": "+1555…", "text": "hello", "tool": "pgp" }
```

`tool` may be `pgp` (default) or `aes`.

## Self-host + Tor example

```bash
export SERVER_NAME="Private Chat"
export PUBLIC_URL="http://YOUR_ONION.onion:8787"
export CHATSCAN_URL="http://127.0.0.1:3000"   # or a shared explorer
export DEFAULT_CRYPTO_TOOL=pgp
./scripts/start-own-server.sh
```

Friends paste the onion (or LAN) Base URL into CrypterChat **Server settings**.
Chat data stays on your host; hashes still seal on ChatScan.
