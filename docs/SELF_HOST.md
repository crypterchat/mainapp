# Host your own CrypterChat server

You can run a **private chat server** for your friends or community.  
Encrypted chat data stays on **your** machine. Message **hashes** still seal on the shared **ChatScan** X11 chain.

```
CrypterChat app  ──URL──▶  YOUR chat server  ──hash only──▶  ChatScan
                              (users, OTP,
                               encrypted envelopes)
```

## 1. Start your server

```bash
git clone https://github.com/crypterchat/mainapp.git
cd mainapp

# Optional: name your server and point ChatScan at a public explorer
export SERVER_NAME="Alice Chat"
export PUBLIC_URL="http://YOUR_LAN_IP:8787"
export CHATSCAN_URL="http://127.0.0.1:3000"   # or a shared ChatScan URL

./scripts/start-own-server.sh
```

The script prints a **Base URL**. That is what users paste into the app.

Copy `messaging/.env.example` if you prefer a file-based config.

## 2. Connect the CrypterChat app

### Flutter demo (`flutter_demo`)

1. Open the app  
2. On login, set **Chat server URL** to your Base URL  
   (or open **Server settings** from the chat list)  
3. Tap **Test connection** — you should see your server name + ChatScan status  
4. Sign in with phone + OTP (`123456` in demo mode)

Android emulator → host machine: `http://10.0.2.2:8787`  
Phone on same Wi‑Fi → `http://192.168.x.x:8787`

### Web UI

Open `http://YOUR_SERVER:8787` in a browser. That page is already served by your chat server.

## 3. What lives where

| Data | Where |
| --- | --- |
| Phone users, sessions, OpenPGP keys, encrypted envelopes | **Your chat server** (`messaging/data`) |
| Ciphertext hash, size, channel metadata (`PGP` / `C7`) | **ChatScan** (public, immutable) |
| Message plaintext | Only after OpenPGP decrypt for conversation members — never on ChatScan |

Default crypto is OpenPGP (`DEFAULT_CRYPTO_TOOL=pgp`). See [PRIVACY_TOOLS.md](PRIVACY_TOOLS.md) for age / Tor / other compatible tools.

## 4. Production notes

- Put the chat server behind HTTPS (Caddy / nginx) and set `PUBLIC_URL=https://chat.example.com`
- Set a real SMS OTP provider instead of `DEMO_OTP`
- Optionally set `CHATSCAN_INGEST_KEYS` on ChatScan and `CHATSCAN_INGEST_KEY` on your server
- Keep `MESSAGING_DATA_DIR` backed up — that is your users’ encrypted mailbox
