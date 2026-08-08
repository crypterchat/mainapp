# Running ChatScan on the CDCI X11 blockchain

ChatScan indexes encrypted CrypterChat messages against **CDCI** - CentralDataBase Core,
[github.com/Centraldb/CDCI](https://github.com/Centraldb/CDCI) - an X11 proof-of-work chain with masternodes and
ChainLocks. Each message record is bound to a CDCI transaction that carries a 35-byte `OP_RETURN` commitment, and the
explorer reports how settled that transaction is.

ChatScan never computes X11 itself. Block hashes and proof of work come from `centraldatabased`, which runs the
reference primitives in C; ChatScan reads them over JSON-RPC. See
[ARCHITECTURE.md](ARCHITECTURE.md#x11-hashing) for what the eleven-round chain in `src/core/x11.js` is and is not.

## Chain parameters

Taken from CDCI's own `src/chainparams.cpp` and `src/chainparamsbase.cpp`:

| Network | RPC port | P2P port | Cookie file (default data dir) |
| --- | --- | --- | --- |
| `main` | 13431 | 13432 | `~/.centraldatabasecore/.cookie` |
| `test` | 23431 | 23432 | `~/.centraldatabasecore/testnet3/.cookie` |
| `devnet` | 19798 | 19799 | `~/.centraldatabasecore/devnet/.cookie` |
| `regtest` | 19898 | 19899 | `~/.centraldatabasecore/regtest/.cookie` |

Mainnet genesis hash: `00000a34128e4769e9ccc6ed6ae234555421b305d62ecb3ce0477a80f4686fb1`. ChatScan warns at startup if the node
it is pointed at reports a different genesis for `CDCI_NETWORK=main`.

Mainnet addresses start with a `PUBKEY_ADDRESS` version byte of 28, and `MAX_OP_RETURN_RELAY` is 83 bytes of script,
which is why the anchor payload is capped at 35.

## 1. Run a CDCI node

Build `centraldatabased` per the [CDCI README](https://github.com/Centraldb/CDCI#building), then start it with the two
flags ChatScan needs:

```bash
centraldatabased -daemon \
  -txindex=1 \
  -server=1 \
  -rpcbind=127.0.0.1 -rpcallowip=127.0.0.1
```

- **`-txindex=1` is required.** ChatScan looks anchors up with `getrawtransaction`, which can only find a transaction
  outside the wallet when the transaction index exists. Without it, valid anchors are reported as
  `anchor-not-found`. Adding the flag later triggers a reindex.
- `-datacarrier` defaults to on. If your node runs with `-datacarrier=0` it will not relay anchors at all.

Check it is up:

```bash
centraldatabase-cli getblockchaininfo
```

## 2. Point ChatScan at it

```bash
export CHATSCAN_CHAIN_BACKEND=cdci
export CDCI_NETWORK=main
npm start
```

With no credentials configured, ChatScan reads the node's `__cookie__` file for the network, the same convention
`centraldatabase-cli` uses. To use an explicit RPC user instead:

```bash
export CDCI_RPC_URL=http://127.0.0.1:13431/
export CDCI_RPC_USER=chatscan
export CDCI_RPC_PASSWORD=…
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHATSCAN_CHAIN_BACKEND` | `local` | Set to `cdci` to index the CDCI chain |
| `CDCI_NETWORK` | `main` | `main`, `test`, `devnet` or `regtest`; picks the default RPC port and cookie path |
| `CDCI_RPC_URL` | per network | Node RPC endpoint |
| `CDCI_RPC_USER` / `CDCI_RPC_PASSWORD` | _(empty)_ | Explicit RPC credentials |
| `CDCI_RPC_COOKIE_FILE` | per network | Cookie file, used when no user is set. Re-read on every call |
| `CDCI_RPC_TIMEOUT_MS` | `5000` | Per-request timeout |
| `CDCI_ANCHOR_MODE` | `client` | `client`: the CrypterChat client publishes anchors. `wallet`: ChatScan publishes them from the node's wallet |
| `CDCI_REQUIRE_ANCHOR` | `true` | Reject records submitted without an anchor transaction |
| `CDCI_CONFIRMATIONS_FOR_FINALITY` | `6` | Confirmations that count as final when there is no ChainLock |
| `CDCI_ANCHOR_POLL_MS` | `30000` | How often unsettled anchors are re-checked |

The explorer starts even when the node does not answer: it logs a warning, serves everything already indexed, and
reports `"status": "offline"` on `/api/v1/status` until the node is back.

## 3. Anchor a message

The anchor output is:

```
OP_RETURN <35 bytes: "CS1" || sha256d(preimage)>

preimage = "chatscan/1:" chainId "|" ciphertextHash "|" size "|" protocol "|" channelHash "|" nonce
```

`chainId` is the explorer's own identifier (`cdci:main` by default), reported by `/api/v1/status`. Every field is one a
client already holds, so the commitment can be computed - and the anchor broadcast - before the record is submitted and
before ChatScan assigns its ID-number.

Absent optional fields are the empty string. `sha256d` is the double SHA-256 CDCI uses for transaction ids.

### Client mode (default)

The client pays for its own anchor:

1. Encrypt the message locally and hash the ciphertext.
2. Compute the commitment, or ask the explorer for it:

   ```bash
   curl -s localhost:3000/api/v1/anchor-payload \
     -H 'content-type: application/json' \
     -d '{"ciphertextHash":"3f2a…b1","size":1024,"protocol":"C7"}'
   ```

   ```json
   {
     "chainId": "cdci:main",
     "preimage": "chatscan/1:cdci:main|3f2a…b1|1024|C7||",
     "commitment": "7c1d…9e",
     "marker": "CS1",
     "opReturnPayload": "4353317c1d…9e",
     "opReturnScript": "6a234353317c1d…9e"
   }
   ```

3. Publish it on CDCI:

   ```bash
   raw=$(centraldatabase-cli createrawtransaction '[]' '{"data":"4353317c1d…9e"}')
   funded=$(centraldatabase-cli fundrawtransaction "$raw" | jq -r .hex)
   signed=$(centraldatabase-cli signrawtransactionwithwallet "$funded" | jq -r .hex)
   centraldatabase-cli sendrawtransaction "$signed"
   ```

4. Submit the record with the transaction id:

   ```bash
   curl -X POST localhost:3000/api/v1/records \
     -H 'content-type: application/json' \
     -d '{"ciphertextHash":"3f2a…b1","size":1024,"protocol":"C7","anchorTxid":"<txid>"}'
   ```

`scripts/send-message.js` does all four steps when `CDCI_RPC_URL` is set.

### Wallet mode

With `CDCI_ANCHOR_MODE=wallet`, ChatScan publishes anchors itself through the node's wallet, which must be funded and
unlocked. This spends coins on every message, so it is off by default and best suited to a node operator running the
explorer for their own traffic.

## 4. What the explorer reports

| Record status | Meaning |
| --- | --- |
| `pending` | The anchor is in the CDCI mempool, or the node has not been reached yet |
| `confirmed` | The anchor is in a block; `blockHeight` and `blockHash` are the CDCI block's |
| `rejected` | `anchor-missing`, `anchor-not-found` or `anchor-mismatch` |

| Anchor finality | Meaning |
| --- | --- |
| `mempool` | Broadcast, zero confirmations |
| `confirmed` | At least one confirmation |
| `final` | At least `CDCI_CONFIRMATIONS_FOR_FINALITY` confirmations |
| `chainlocked` | Covered by a CDCI ChainLock, so reorganisation is off the table |
| `unknown` | Not verified against the node yet |

The anchor watcher re-checks every non-final anchor on `CDCI_ANCHOR_POLL_MS`, so confirmations and ChainLock status keep
up with the chain. Each change is appended to the chain log, so it survives a restart.

A record's page shows its anchor transaction, commitment, output index, confirmations and ChainLock state.
`/block/{height}` lists the message records anchored in that CDCI block, and searching an anchor transaction id resolves
to its record.

## Rejections and what they mean

| Reason | Cause | Fix |
| --- | --- | --- |
| `anchor-missing` | No `anchorTxid` while `CDCI_REQUIRE_ANCHOR=true` | Publish an anchor, or set `CDCI_REQUIRE_ANCHOR=false` |
| `anchor-not-found` | The node does not know the transaction | Start the node with `-txindex=1`; check the transaction was broadcast, and that you are on the same network |
| `anchor-mismatch` | The transaction's `OP_RETURN` commits to a different submission | Recompute the commitment from the exact submission being sent, including `chainId`, `nonce` and `channelHash` |

A node that is merely unreachable never causes a rejection: the record stays `pending` and the watcher settles it once
the node answers.

## Running without a node

`CHATSCAN_CHAIN_BACKEND=local` (the default) runs a self-contained development chain with its own sealer, so the UI and
API can be worked on without CDCI. It is a development aid, not a CDCI-compatible chain: its blocks are sealed locally
and its hashes are not consensus hashes. The tests cover both backends, driving the CDCI paths against a stub node in
`test/support/cdci-stub.js` that mimics the daemon's RPC responses.
