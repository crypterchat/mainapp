# ChatScan architecture

ChatScan is one Node process with no runtime dependencies: an HTTP server, an in-memory index, and an append-only log
on disk. `node src/index.js` is the whole deployment. The chain it indexes is CDCI
([github.com/Centraldb/CDCI](https://github.com/Centraldb/CDCI)), reached over JSON-RPC.

```
CrypterChat client                       ChatScan                        CDCI node
------------------                       --------                        ---------
encrypt(message) ──▶ ciphertext
hash(ciphertext) ──▶ digest
commit(digest,…) ──▶ commitment ──OP_RETURN──────────────────────────────▶ mempool
                                                                             │
digest + txid ──POST──▶ validate ──▶ verifyAnchor ──getrawtransaction───────▶│
                            │              │                              X11 block
plaintext stays             │              └──▶ confirmations, ChainLock ◀────┘
on the client               ▼
                          index ──▶ explorer pages + REST API
                            ▲
                     anchor watcher ──getrawtransaction──▶ (re-checks until final)
```

## Modules

| Path | Responsibility |
| --- | --- |
| `src/config.js` | Reads every setting from the environment once, at startup, and validates the backend choice |
| `src/chain/service.js` | `ChainService`: the one interface pages and the API use, over either backend |
| `src/chain/cdci-rpc.js` | JSON-RPC client for `centraldatabased`: cookie or user auth, timeouts, batching, error mapping |
| `src/chain/cdci.js` | `CdciChain`: chain state, block reads, anchor verification, wallet anchoring |
| `src/chain/commitment.js` | The anchor commitment and its `OP_RETURN` encoding |
| `src/chain/anchor-watcher.js` | Re-checks unsettled anchors until they are final |
| `src/core/x11.js` | The eleven-round X11 chain (record hashes) and canonical serialisation |
| `src/core/merkle.js` | Merkle root over the record hashes in a local-chain block |
| `src/core/records.js` | Record model: validation, hashing, `{HASH}/{ID-number}` references, anchors, public projection |
| `src/core/chain.js` | `ChatScanNode`: admission policy, anchor settlement, local sealing |
| `src/core/network.js` | The status snapshot the dashboard and `/api/v1/status` share |
| `src/store/store.js` | In-memory index and aggregates, plus the event emitter behind the SSE stream |
| `src/store/chain-log.js` | Append-only JSONL log and replay |
| `src/http/*` | Router, REST API, SSE, static assets, server-rendered pages |
| `src/http/views/*` | The ChatScan UI, built from the Webflow design system |

## Chain backends

`ChainService` normalises two backends to one shape, so every view and endpoint works against either:

| | `cdci` | `local` |
| --- | --- | --- |
| Blocks | Read from `centraldatabased` | Sealed in-process |
| Block hashes | CDCI's, computed with real X11 in C | Derived from `src/core/x11.js` |
| Record confirmation | Its anchor transaction landing in a CDCI block | Being sealed into a local block |
| Finality | Confirmations, or a CDCI ChainLock | Immediate on sealing |
| Purpose | Production | Development and tests without a node |

Because the CDCI node is a network dependency, the pages ask the service for blocks in *tolerant* mode: if the node is
unreachable, the block list renders empty and the status card says the node is offline, rather than the page failing. The
API is not tolerant - it answers `502 cdci_unavailable`, so a client never mistakes an unreachable node for an empty
chain.

## Message records

A record is the explorer's unit of work - the encrypted-message equivalent of a transaction. It holds ciphertext
*metadata* only:

- `ciphertextHash` - digest of the encrypted payload, computed by the client
- `size` - ciphertext length in bytes
- `protocol`, `channelHash`, `nonce`, `fee`, `appVersion` - all optional except the protocol default
- `anchorTxid` - the CDCI transaction carrying this record's commitment

The record hash is `x11(canonical({ chainId, id, ciphertextHash, size, protocol, channelHash, nonce, receivedAt }))`,
and the explorer reference is `{hash}/{id}` where `id` is a monotonic ID-number starting at 1. Because the ID-number is
part of the preimage, the hash and the ID cannot be recombined into a different valid reference.

The ID-number is *reserved* before the record is built (`store.reserveRecordId()`), because the reference has to exist
before the node can decide whether to admit the record. The anchor commitment deliberately does **not** depend on it:

```
commitment = sha256d("chatscan/1:" chainId "|" ciphertextHash "|" size "|" protocol "|" channelHash "|" nonce)
```

Every field there is one the client already holds, so a client can compute the commitment, broadcast the anchor, and
submit the record in one pass without a round trip to learn its ID-number. `sha256d` is the same double SHA-256 CDCI uses
for transaction ids.

`publicRecord()` in `src/core/records.js` is the only projection used by the API and the pages. Adding a field to the
index does not expose it: it has to be listed there explicitly.

### Why content cannot leak

1. `normalizeSubmission()` runs a content-field denylist first, then an allowlist of the seven accepted fields.
2. The store has no field capable of holding content, and the chain log only ever serialises stored records.
3. Responses go through `publicRecord()` / `publicBlock()`.
4. Pages render through an escaping `html` tagged template (`src/util/html.js`), so untrusted text cannot become
   markup either.

`test/records.test.js` and `test/api.test.js` assert each of these.

## Admission and rejection

| Outcome | HTTP | Indexed | When |
| --- | --- | --- | --- |
| Accepted | 201 | yes, `pending` or `confirmed` | Valid submission; in cdci mode its anchor checked out |
| Policy rejection | 202 | yes, `rejected` | Replayed ciphertext digest + nonce, over the protocol's size ceiling, or a bad anchor |
| Structural rejection | 400 | no | Content field, unknown field, bad hash, bad size, unknown protocol |

Policy rejections stay in the index so the explorer can show them - matching the "Rejected" state in the design - while
structurally invalid submissions never enter it. Anchor rejections are `anchor-missing`, `anchor-not-found` and
`anchor-mismatch`; a node that is merely *unreachable* never causes one, because that is not the client's fault. Such a
record stays `pending` and the anchor watcher settles it later.

## Anchor lifecycle

A record is admitted as soon as its anchor transaction is seen, usually while still in the CDCI mempool. `AnchorWatcher`
then re-checks every anchor that is not final on `CDCI_ANCHOR_POLL_MS`, and each change is appended to the chain log as a
`record-update` event, so confirmations survive a restart:

```
mempool ──▶ confirmed (≥1 conf) ──▶ final (≥ CDCI_CONFIRMATIONS_FOR_FINALITY)
   └──────────────────────────────▶ chainlocked (CDCI ChainLock, no reorg possible)
```

ChainLocks come from CDCI's masternode quorums (`getbestchainlock`, and the `chainlock` field on
`getrawtransaction`), and are treated as final regardless of confirmation count. A node without LLMQ ChainLocks simply
never reports them, and finality falls back to the confirmation count.

## Sealing the local chain

Only the `local` backend seals blocks; on CDCI, miners do. The sealer runs every `CHATSCAN_BLOCK_INTERVAL_MS`, and immediately when the mempool reaches
`CHATSCAN_MAX_RECORDS_PER_BLOCK`. It takes pending records oldest first, computes the merkle root, then searches for a
nonce whose X11 header hash has at least `CHATSCAN_DIFFICULTY_NIBBLES` leading zero nibbles. Sealed records move to
`confirmed` and gain `blockHeight`, `blockHash` and `indexInBlock`.

Genesis is height 0 with no records and a previous hash of 64 zeros. Each block's timestamp is forced past its parent's,
so ordering is monotonic even if the clock steps backwards.

## X11 hashing

X11 chains eleven distinct hash functions, feeding each digest into the next. CDCI's `HashX11`
([src/hash.h](https://github.com/Centraldb/CDCI/blob/main/src/hash.h)) runs them with the reference sphlib primitives,
which Node's OpenSSL build does not ship. `src/core/x11.js` keeps the same eleven-round structure and CDCI's slot order,
binding each slot to a digest Node can compute:

| # | X11 slot | Digest used today |
| --- | --- | --- |
| 1 | blake | `blake2b512` |
| 2 | bmw | `sha3-512` |
| 3 | groestl | `sha512` |
| 4 | skein | `blake2s256` |
| 5 | jh | `sm3` |
| 6 | keccak | `sha3-256` |
| 7 | luffa | `sha384` |
| 8 | cubehash | `sha3-384` |
| 9 | shavite | `ripemd160` |
| 10 | simd | `sha512-256` |
| 11 | echo | `sha256` |

The output is 32 bytes, matching X11.

**This is not a consensus hash, and ChatScan never needs one.** An explorer reads proof of work rather than recomputing
it: in `cdci` mode every block hash comes from the node, and anchor transaction ids are SHA-256d, which Node computes
exactly as CDCI does (`src/chain/commitment.js`). The eleven-round chain here is used only for ChatScan's own record
hashes and for the local development chain, both of which are explorer-internal.

Blocks on the local chain record the algorithm identifier (`x11-chatscan-r11`) so stored data stays interpretable, and
`/api/v1/algorithm` publishes the current mapping alongside the CDCI reference. If the reference primitives become
available to Node, swapping them in means editing `X11_ROUNDS` and bumping `X11_ALGORITHM_ID`; nothing else depends on the
underlying digests.

## Persistence

Each accepted record, each anchor update and each locally sealed block is appended to `data/chain.jsonl` as one JSON
line (`record`, `record-update`, `block`). Startup replays the file in order to rebuild the index, so a restart keeps
references, anchor state and confirmations. Writes are serialised through a promise queue, so log order matches accept
order. A corrupt line fails startup loudly rather than silently truncating the chain. Set `CHATSCAN_PERSIST=false` for an
ephemeral node (tests use this).

CDCI block data is not duplicated into the log: the node is the source of truth for the chain, and a CDCI snapshot is
cached for two seconds so a dashboard render plus the event stream do not ask it the same question repeatedly.

The index is held in memory, which is the main scaling limit: a node's working set is bounded by the number of records
it has ever seen. Moving the index behind a database would only touch `src/store/`.

## HTTP layer

- Pages are server rendered, so every record has a shareable URL and the explorer works without JavaScript.
  `public/js/app.js` only adds the dropdown cards, a copy button, and a live refresh driven by the SSE stream.
- Responses carry `Content-Security-Policy` (self only, no inline script or style), `X-Content-Type-Options`,
  `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.
- Static assets are served from `public/` with an extension allowlist and a resolved-path check against traversal.
- API clients get JSON errors; browsers get the explorer's error page. The choice is made from the path and `Accept`.
- Ingest is rate limited per client address, and key-gated once `CHATSCAN_INGEST_KEYS` is set.
