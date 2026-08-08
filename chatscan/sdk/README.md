# ChatScan SDK

Connect a chat app to the **CDCI X11 blockchain** and a **ChatScan explorer**.

```
encrypt locally  ->  commit  ->  anchor on CDCI  ->  record on the explorer
```

The plaintext and the message key never leave your process. ChatScan receives a digest of the ciphertext, its byte
length, and opaque routing metadata - nothing that can be decrypted, by you or by anyone running the explorer.

No dependencies. Works in Node 20.11+, in browsers, and in React Native: everything is `fetch` and WebCrypto. The one
Node-oriented piece is `CdciWallet`, which talks to a `centraldatabased` node and therefore belongs on a server or in a
desktop client, never in a page.

## Install

```bash
npm install github:crypterchat/chatscan#path:/sdk
```

Or vendor `sdk/src` directly - it is plain ESM with no build step.

## Send a message

```js
import { CdciWallet, ChatSession } from '@crypterchat/chatscan-sdk';

const session = await ChatSession.connect({
  baseUrl: 'https://chatscan.org',
  appVersion: 'my-chat-1.0',
  // Needed when the explorer requires on-chain anchors. Omit it and pass
  // anchorTxid yourself if your wallet lives elsewhere.
  wallet: new CdciWallet({ network: 'main', user: 'rpcuser', password: process.env.CDCI_RPC_PASSWORD }),
});

const sent = await session.send('shipping the x11 sealer today', { conversation: 'devgroup' });

console.log(sent.ref);          // d700bc90…27a8/42
console.log(sent.explorerUrl);  // https://chatscan.org/tx/d700bc90…27a8/42
console.log(sent.status);       // confirmed
console.log(sent.anchorTxid);   // the CDCI transaction carrying the commitment
```

`send()` does four things: encrypts with AES-256-GCM, derives the anchor commitment, publishes it in an `OP_RETURN`
output on CDCI, and records the message on the explorer.

What comes back that you must keep yourself:

| Field | Why it matters |
| --- | --- |
| `key` | The AES key. ChatScan never sees it; without it the message is unreadable |
| `envelope` | `iv \|\| tag \|\| ciphertext`. Store or transmit this however your app already does |
| `ref` | `{HASH}/{ID-number}`, the explorer's permanent address for the message |

```js
import { openMessage } from '@crypterchat/chatscan-sdk';

await openMessage(sent.envelope, sent.key); // 'shipping the x11 sealer today'
```

## Read a conversation

```js
const history = await session.history('devgroup', { limit: 20 });
for (const record of history.records) {
  console.log(record.ref, record.size, record.anchor?.finality ?? record.status);
}
```

Records are metadata only. Decrypt your own copy of the ciphertext with the key you kept - there is no endpoint that
returns content, because there is no content stored.

## Watch for new messages

```js
const watcher = await session.watch({
  conversation: 'devgroup',
  onRecord: (record) => console.log('new message recorded:', record.ref),
});

// later
watcher.close();
```

Backed by the explorer's server-sent event stream, implemented over `fetch` so it behaves the same in Node and in the
browser, and reconnects on its own.

## Bring your own encryption

If your app already encrypts, skip `sealMessage` and hand ChatScan the digest:

```js
import { ChatScanClient, digestCiphertext, anchorInstructions } from '@crypterchat/chatscan-sdk';

const client = new ChatScanClient({ baseUrl: 'https://chatscan.org' });
const { chainId } = await client.status();

const { ciphertextHash, size } = await digestCiphertext(myEnvelope);
const submission = { ciphertextHash, size, protocol: 'C7', nonce: myNonce };

// Publish this on CDCI, then submit the txid.
const { commitment, opReturnPayload } = await anchorInstructions({ chainId, ...submission });
const { txid } = await wallet.publishAnchor(commitment);

await client.submitRecord({ ...submission, anchorTxid: txid });
```

The commitment is:

```
sha256d("chatscan/1:" chainId "|" ciphertextHash "|" size "|" protocol "|" channelHash "|" nonce)
```

and the `OP_RETURN` payload is `"CS1"` followed by those 32 bytes - 35 bytes total, inside CDCI's
`MAX_OP_RETURN_RELAY` of 83. Every input is one you already hold, so you can publish the anchor before submitting the
record. The explorer derives the same value independently; `client.anchorPayload(submission)` returns its version if you
want to cross-check.

## Handling failures

Every explorer error is a `ChatScanError` with the explorer's own `code`:

```js
import { ChatScanError } from '@crypterchat/chatscan-sdk';

try {
  await session.send(text, { conversation });
} catch (error) {
  if (error instanceof ChatScanError && error.retryable) queueForLater(text);   // node busy or unreachable
  else if (error instanceof ChatScanError) reportBug(error.code, error.details); // the submission is wrong
  else throw error;
}
```

`retryable` covers an unreachable explorer, a rate limit, an unavailable CDCI node and 5xx responses. `clientFault`
covers the rest - most usefully `content_rejected`, which means the app tried to send message content and the explorer
refused it before indexing anything.

A `send()` that resolves is not always an acceptance: a well-formed message whose anchor fails chain policy comes back
with `status: 'rejected'` and a `rejectionReason` of `anchor-missing`, `anchor-not-found` or `anchor-mismatch`. Check
it before showing a delivered tick.

## Settlement

`record.anchor.finality` tells a chat UI how settled a message is:

| Value | Meaning |
| --- | --- |
| `mempool` | Broadcast, not yet in a block |
| `confirmed` | In a CDCI block |
| `final` | Enough confirmations to be treated as settled |
| `chainlocked` | Covered by a CDCI ChainLock, so it cannot be reorganised out |
| `unknown` | Not verified against the node yet |

## API

| Export | Purpose |
| --- | --- |
| `ChatSession` | High-level: `connect`, `send`, `history`, `watch` |
| `ChatScanClient` | The explorer's REST API and event stream |
| `CdciWallet` | Publishes anchors through a `centraldatabased` wallet |
| `ChatScanError`, `CdciWalletError` | Typed failures |
| `sealMessage`, `openMessage`, `digestCiphertext` | AES-256-GCM helpers |
| `generateMessageKey`, `generateNonce`, `channelHash` | Key, nonce and channel derivation |
| `anchorCommitment`, `anchorInstructions`, `anchorPreimage`, `anchorPayloadHex`, `anchorScriptHex` | The commitment scheme |
| `sha256d`, `toHex`, `fromHex` | Small primitives, the same ones CDCI uses |

TypeScript definitions ship in `src/index.d.ts`.

## Try it

With an explorer running (`npm start` in the repository root):

```bash
node sdk/examples/chat-app.mjs devgroup
```

The example sends three encrypted messages, watches the live stream, reads the conversation back, and shows what the
explorer stores versus what only the client can recover. Point it at a CDCI node with `CDCI_RPC_URL` to anchor on chain.

See [docs/CDCI.md](../docs/CDCI.md) for running a node, and [docs/API.md](../docs/API.md) for the REST API underneath
this SDK.
