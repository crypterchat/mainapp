# CrypterChat Flutter demo (WhatsApp-style + ChatScan)

Runnable Flutter client with a **WhatsApp-like** chat UI. Phone-number login and
every text send use **OpenPGP** (default) through the ChatScan messaging bridge —
the X11 explorer only ever stores ciphertext hashes (`contentAvailable=false`,
protocol `PGP`).

> The full production app under `/lib` still depends on Firebase
> (`google-services.json` is a placeholder in this repo). This demo is the
> supported way to run the Flutter WhatsApp UI against ChatScan locally.

## Prerequisites

* Flutter 3.24+ (`flutter` on `PATH`)
* A CrypterChat **chat server** (yours or shared) — see `../scripts/start-own-server.sh`
* ChatScan for hashes (`CHATSCAN_URL` on that server)
* For Android: Android SDK + emulator/device
* For web: Chrome

## Use your own server URL

1. Start a server: `../scripts/start-own-server.sh` (prints a Base URL)
2. In the app, set **Chat server URL** on login, or open **Server settings** (DNS icon)
3. Tap **Test connection** — you should see the server name and ChatScan status
4. Sign in; chat data stays on that server, hashes still go to ChatScan

Details: [../docs/SELF_HOST.md](../docs/SELF_HOST.md) · [../docs/PRIVACY_TOOLS.md](../docs/PRIVACY_TOOLS.md)

In the app: shield icon → **Privacy tools** (OpenPGP, ChatScan, Tor/age-compatible).
Chat lock menu switches `pgp` / `aes` per send.

## Run (web — fastest)

```bash
# terminal 1
../scripts/start-stack.sh

# terminal 2
cd flutter_demo
flutter pub get
flutter run -d chrome \
  --web-renderer html \
  --dart-define=MESSAGING_URL=http://127.0.0.1:8787
```

Or headless web-server (good for CI / remote desktops):

```bash
flutter run -d web-server --web-hostname=0.0.0.0 --web-port=8080 \
  --web-renderer html \
  --dart-define=MESSAGING_URL=http://127.0.0.1:8787
```

## Run (Android)

```bash
flutter devices
flutter run -d android \
  --dart-define=MESSAGING_URL=http://10.0.2.2:8787   # emulator → host
# physical device: use your machine LAN IP instead of 10.0.2.2
```

Build a debug APK:

```bash
flutter build apk --debug --dart-define=MESSAGING_URL=http://10.0.2.2:8787
# → build/app/outputs/flutter-apk/app-debug.apk
```

## Try a chat

1. Sign in with an E.164 number (e.g. `+15551110001`) — demo OTP **`123456`**
2. Confirm the green **ChatScan x11:local · height N** banner
3. Start / open a chat with another number (e.g. `+15551110002`)
4. Send a message — the bubble shows **normal readable text** (CrypterChat style)
5. Sign in as the recipient and read the same plain message
6. Open ChatScan (`http://127.0.0.1:3000`) — only the ciphertext hash is public  
   (optional: long-press a bubble in the app for seal details)

## Demo media

See `../docs/media/flutter-wa-*.png` and `../docs/media/flutter-whatsapp-chatscan-demo.mp4`.
