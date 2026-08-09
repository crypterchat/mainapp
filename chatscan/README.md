# ChatScan Block Explorer

ChatScan is a block explorer for **encrypted messages** instead of coin transfers. Every message sent through
CrypterChat is recorded on the chain and addressed in the explorer as:

```
{HASH}/{ID-number}
```

for example `d700bc90e31d51c5ea22dbb03114e1791ef1da92d3ee06104216cdb9571327a8/42`.

Message **content is never viewable**. CrypterChat encrypts messages end-to-end on the client, so the only thing
ChatScan ever receives is a digest of the ciphertext, its byte length, and opaque routing metadata. The ingest API
refuses any request that carries message content, and the explorer has no code path that could render it.

The chain is **CDCI** - CentralDataBase Core, [github.com/Centraldb/CDCI](https://github.com/Centraldb/CDCI) - an
**X11** proof-of-work chain with masternodes and ChainLocks. Each message record is bound to a CDCI transaction carrying
a 35-byte `OP_RETURN` commitment, and the explorer reports its confirmations and ChainLock status. See
[docs/CDCI.md](docs/CDCI.md).

![The ChatScan dashboard, connected to a CDCI node](docs/media/dashboard.png)

## Demo

A 90-second tour of the explorer: the dashboard and its live CDCI figures, a message record with its on-chain anchor, a
block, and the privacy page. Recorded against a CDCI regtest node.

![Animated tour of the ChatScan Block Explorer](docs/media/chatscan-explorer-preview.webp)

<video src="docs/media/chatscan-explorer-tour.mp4" controls width="100%"></video>

The preview above runs at 3x speed - [watch the full recording](docs/media/chatscan-explorer-tour.mp4) for the real
pace.

<table>
<tr>
<td width="50%"><img src="docs/media/records.png" alt="Message records with Confirmed, Pending and Rejected states"></td>
<td width="50%"><img src="docs/media/record-anchor.png" alt="A message record showing its CDCI anchor and the notice that content is not viewable"></td>
</tr>
<tr>
<td>Message records, addressed as <code>{HASH}/{ID-number}</code>, with their protocol and settlement state.</td>
<td>One record: the CDCI anchor transaction, its commitment, ChainLock status - and no way to read the message.</td>
</tr>
<tr>
<td width="50%"><img src="docs/media/block.png" alt="An X11 block on the CDCI chain"></td>
<td width="50%"><img src="docs/media/privacy.png" alt="The page listing exactly what ChatScan stores and refuses"></td>
</tr>
<tr>
<td>An X11 block read from the CDCI node, with the message records anchored in it.</td>
<td>Exactly what is indexed for every message, and everything that is refused.</td>
</tr>
</table>

## Quick start

Requires **Node.js 20.11 or newer**. There are no dependencies to install.

```bash
git clone https://github.com/crypterchat/chatscan.git
cd chatscan
npm start                        # http://localhost:3000
```

That starts the explorer on its **local development chain**, so the UI and API work without a CDCI node. In a second
terminal, fill it with demo traffic:

```bash
npm run seed                     # 40 encrypted message records (one is a deliberate replay)
npm run send -- "hello world"    # one message; the plaintext never leaves your machine
```

Then open <http://localhost:3000>.

To index the real chain instead, point ChatScan at a `centraldatabased` node started with `-txindex=1`:

```bash
CHATSCAN_CHAIN_BACKEND=cdci CDCI_NETWORK=main npm start
```

[docs/CDCI.md](docs/CDCI.md) covers the node flags, ports, credentials and the anchoring flow.

Run the test suite (146 tests, no network access needed - the CDCI paths run against a stub node):

```bash
npm test
```

## What the explorer shows

| Page | What it does |
| --- | --- |
| `/` | Live dashboard: CDCI chain state, fee estimate, unconfirmed records, throughput, latest records and blocks |
| `/tx/{HASH}/{ID-number}` | One message record: reference, ciphertext digest, size, protocol, CDCI anchor, status |
| `/block/{height}` | One X11 block and the message records anchored in it |
| `/blocks` | Paged list of blocks |
| `/search?q=` | Lookup by reference, record hash, block hash, anchor transaction id, height or ID-number |
| `/privacy` | The exact fields ChatScan stores, and everything it refuses |

`/record/{HASH}/{ID-number}` is an alias of `/tx/...`.

## Connecting a chat app

The [ChatScan SDK](sdk/) is the supported way in. It encrypts locally, anchors on CDCI and records the message in one
call, and it has no dependencies - Node, browser or React Native:

```js
import { CdciWallet, ChatSession } from '@crypterchat/chatscan-sdk';

const session = await ChatSession.connect({
  baseUrl: 'https://chatscan.org',
  wallet: new CdciWallet({ network: 'main', user: 'rpcuser', password: process.env.CDCI_RPC_PASSWORD }),
  appVersion: 'my-chat-1.0',
});

const sent = await session.send('shipping the x11 sealer today', { conversation: 'devgroup' });
console.log(sent.ref, sent.explorerUrl, sent.anchorTxid);
```

`sent.key` and `sent.envelope` stay in your process; the explorer never receives either. Run the worked example against
a local explorer with `node sdk/examples/chat-app.mjs devgroup`, and see [sdk/README.md](sdk/README.md) for reading
history, watching the live stream, bringing your own encryption, and handling failures.

## Recording a message directly

Under the SDK it is plain HTTP. A client encrypts the message, hashes the ciphertext, anchors the commitment on CDCI,
and submits **metadata only**:

```bash
curl -X POST http://localhost:3000/api/v1/records \
  -H 'content-type: application/json' \
  -d '{
        "ciphertextHash": "3f2a...64 hex chars...b1",
        "size": 1024,
        "protocol": "C7",
        "channelHash": "9c81...64 hex chars...0e",
        "nonce": "8f14e45fceea167a5a36dedd4bea2543",
        "anchorTxid": "7b19...64 hex chars...c4",
        "fee": 0.00042,
        "appVersion": "cc-1.0"
      }'
```

```json
{
  "ref": "d700bc90...27a8/42",
  "hash": "d700bc90...27a8",
  "id": 42,
  "status": "confirmed",
  "commitment": "7c1d...9e",
  "anchor": { "txid": "7b19...c4", "confirmations": 2, "blockHeight": 184203, "finality": "confirmed" },
  "explorerUrl": "/tx/d700bc90...27a8/42"
}
```

`anchorTxid` is the CDCI transaction whose `OP_RETURN` carries this record's commitment. The commitment is derived from
fields the client already holds, so it can be computed and published before the record is submitted:

```
OP_RETURN <35 bytes: "CS1" || sha256d("chatscan/1:" chainId "|" ciphertextHash "|" size "|" protocol "|" channelHash "|" nonce)>
```

Sending a `content`, `body`, `text`, `message`, `plaintext`, `payload` or `attachment` field fails with HTTP 400 and
`"code": "content_rejected"`. See [docs/API.md](docs/API.md) for the full REST reference, and
`scripts/send-message.js` for a working client that encrypts locally, publishes the anchor, and submits only the digest.

## Configuration

Every setting is an environment variable; the defaults run a self-contained local node.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHATSCAN_CHAIN_BACKEND` | `local` | `cdci` to index the CDCI chain, `local` for the development chain |
| `CHATSCAN_PORT` | `3000` | HTTP port (`PORT` also works) |
| `CHATSCAN_HOST` | `0.0.0.0` | Bind address |
| `CHATSCAN_NETWORK` | from backend | Network name shown in the UI |
| `CHATSCAN_CHAIN_ID` | from backend | Chain identifier mixed into record hashes and anchor commitments |
| `CHATSCAN_DATA_DIR` | `./data` | Where the append-only chain log lives |
| `CHATSCAN_PERSIST` | `true` | Set to `false` for an in-memory node |
| `CHATSCAN_INGEST_KEYS` | _(empty)_ | Comma-separated keys; ingest is open when unset |
| `CHATSCAN_INGEST_RATE_PER_MINUTE` | `600` | Per-client ingest limit |
| `CHATSCAN_MAX_REQUEST_BYTES` | `16384` | Request body ceiling |
| `CHATSCAN_MAX_CIPHERTEXT_BYTES` | `4194304` | Largest ciphertext length a record may declare |
| `CHATSCAN_FEE_QUOTE_USD` | `21.546` | Base fee quote shown as "AT Fee" |

CDCI settings (`CDCI_NETWORK`, `CDCI_RPC_URL`, `CDCI_RPC_USER`, `CDCI_RPC_PASSWORD`, `CDCI_RPC_COOKIE_FILE`,
`CDCI_ANCHOR_MODE`, `CDCI_REQUIRE_ANCHOR`, `CDCI_CONFIRMATIONS_FOR_FINALITY`, `CDCI_ANCHOR_POLL_MS`) are documented in
[docs/CDCI.md](docs/CDCI.md).

Local-chain settings (`CHATSCAN_BLOCK_INTERVAL_MS`, `CHATSCAN_MAX_RECORDS_PER_BLOCK`, `CHATSCAN_DIFFICULTY_NIBBLES`,
`CHATSCAN_SEALER_ENABLED`) only apply when `CHATSCAN_CHAIN_BACKEND=local`.

Copy [.env.example](.env.example) if you prefer to keep them in a file and export it with your process manager.

## Project layout

```
src/chain/     CDCI JSON-RPC client, anchor commitments, anchor watcher, backend selection
src/core/      X11 hashing, merkle roots, record model, local chain and sealer
src/store/     In-memory index plus the append-only chain log
src/http/      Router, REST API, SSE stream, static assets, server-rendered pages
src/http/views ChatScan UI (Webflow design system, rendered server side)
sdk/           Client SDK for chat apps, plus a worked example
public/        Stylesheet, progressive-enhancement script, images
scripts/       Demo client and seeder
test/          node:test suite, including a stub CDCI node
docs/          API reference, CDCI setup, architecture notes, screenshots and the demo video
```

## Licence

MIT - see [LICENSE](LICENSE).
