---
name: chatscan-explorer
description: Guides work on the ChatScan Block Explorer - adding or changing pages, REST endpoints, record fields, CDCI chain integration, anchoring, or the Webflow-derived UI. Use when editing anything under src/, public/ or test/ in the chatscan repository, when adding a field to a message record, when touching the ingest API or the CDCI RPC client, or when a change could affect what the explorer stores or displays.
---

# Working on the ChatScan Block Explorer

ChatScan indexes **end-to-end encrypted CrypterChat messages** on the **CDCI X11 chain**
([github.com/Centraldb/CDCI](https://github.com/Centraldb/CDCI), CentralDataBase Core - a Dash-derived chain with
masternodes and ChainLocks). Each message is addressed as `{HASH}/{ID-number}`, anchored on CDCI by an `OP_RETURN`
commitment, and its content is never viewable. Read [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) and
[CDCI.md](../../../docs/CDCI.md) before a non-trivial change.

## Non-negotiables

1. **Never accept or store message content.** The ingest allowlist lives in `ALLOWED_SUBMISSION_FIELDS`
   (`src/core/records.js`) and the denylist of content-carrying field names sits directly above it. A new field must be
   metadata that a client can compute without revealing the message.
2. **Never bypass the public projections.** API responses and pages must go through `publicRecord()` and
   `publicBlock()`. Adding a stored field does not expose it until it is listed there on purpose.
3. **Keep `{HASH}/{ID-number}` canonical.** Build references with `formatRef()` and parse them with `parseRef()`. Do not
   make the anchor commitment depend on the reference: it is derived from client-held fields only
   (`src/chain/commitment.js`) so a client can publish the anchor before the explorer assigns an ID-number.
4. **ChatScan does not compute consensus hashes.** Block hashes and proof of work come from the CDCI node. `src/core/x11.js`
   mirrors CDCI's `HashX11` slot order but binds stand-in digests, and is only for ChatScan's own record hashes and the
   local development chain. Do not present it as X11 proof of work.
5. **The node is a network dependency.** An unreachable `centraldatabased` must never take the explorer down or reject a
   client's record. Pages read blocks in `tolerant` mode; the API answers `502 cdci_unavailable`; a record whose anchor
   could not be checked stays `pending` for the anchor watcher.
6. **Zero runtime dependencies.** `package.json` has no `dependencies` block and `node src/index.js` must work straight
   after a clone. Use `node:` built-ins, and `node:test` for tests.
7. **Escape everything.** Render markup with the `html` tagged template from `src/util/html.js`. Only pass
   codebase-authored markup through `raw()`, never request data.

## Where things go

| Change | Files to touch |
| --- | --- |
| New record field | `src/core/records.js` (allowlist, validation, `createRecord`, `publicRecord`), `docs/API.md`, `test/records.test.js` |
| New REST endpoint | `src/http/api.js`, `docs/API.md`, `test/api.test.js` |
| New page | `src/http/views/pages.js` (view), `src/http/pages.js` (route), `test/pages.test.js` |
| New UI component | `src/http/views/components.js`, styles in `public/css/chatscan.css` |
| CDCI RPC call | `src/chain/cdci.js`, stub response in `test/support/cdci-stub.js`, `test/cdci.test.js` |
| Anchoring or finality | `src/chain/commitment.js`, `src/chain/anchor-watcher.js`, `docs/CDCI.md`, `test/cdci-explorer.test.js` |
| Backend-visible behaviour | `src/chain/service.js` - keep both backends normalising to one shape |
| Anything a chat app consumes | mirror it in `sdk/src/`, `sdk/src/index.d.ts`, `sdk/README.md`, `sdk/test/` |
| Index or persistence | `src/store/`, `test/store.test.js` |
| New setting | `src/config.js`, `.env.example`, the README table (CDCI settings go in `docs/CDCI.md`) |

## CDCI facts worth not re-deriving

- RPC ports: main 13431, test 23431, devnet 19798, regtest 19898. P2P: 13432 / 23432 / 19799 / 19899.
- Mainnet genesis: `00000a34128e4769e9ccc6ed6ae234555421b305d62ecb3ce0477a80f4686fb1`.
- `HashX11` order: blake, bmw, groestl, **skein, jh, keccak**, luffa, cubehash, shavite, simd, echo.
- `MAX_OP_RETURN_RELAY` is 83 bytes of script; the anchor payload is 35 bytes, so it relays as standard.
- The node needs `-txindex=1`, or `getrawtransaction` cannot find anchors and valid records are rejected as
  `anchor-not-found`.
- Auth follows the daemon: an explicit `rpcuser`, or the `__cookie__` file in the network's data directory.
- Dash-derived RPC names: `signrawtransactionwithwallet` (not `signrawtransaction`), `getbestchainlock`, and
  `getrawtransaction` verbose returns `height`, `confirmations` and `chainlock`.

## UI conventions

The design comes from the ChatScan Webflow export. Reuse the existing `f-*` classes (`f-section-large`,
`f-container-regular`, `f-feature-card-filled`, `f-career-row-wrapper`, `f-alert-small`, `f-button-secondary`) rather
than inventing new ones; add a rule to the "Explorer additions" section of `public/css/chatscan.css` only when nothing
fits. Pages are server rendered and must work with JavaScript disabled - `public/js/app.js` is progressive enhancement
only. The Content-Security-Policy forbids inline `<script>` and inline `style` attributes, so put behaviour in
`public/js/app.js` and styling in the stylesheet.

## Verifying a change

```bash
npm test                                    # 146 tests, covering the explorer and the SDK
npm start                                   # local development chain on http://localhost:3000
npm run seed                                # demo traffic, including one rejected record
CHATSCAN_CHAIN_BACKEND=cdci npm start       # index a real centraldatabased node
curl -s localhost:3000/api/v1/status        # backend, chain state, anchoring settings
```

The CDCI paths are covered against `test/support/cdci-stub.js`, which mimics the daemon's RPC responses - extend the stub
rather than mocking `fetch`. Add a test with every behaviour change, and when touching privacy-sensitive code assert the
negative too: that a content field is refused, or that a response has no content key.

The SDK is a separate package, so it does not import from `src/` at runtime - it reimplements the commitment on
WebCrypto so it also runs in a browser. `sdk/test/sdk.test.js` asserts the two derivations agree; if you change the
commitment scheme, both sides and that conformance test must move together.
