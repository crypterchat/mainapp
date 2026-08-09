# ChatScan REST API

Base path: `/api/v1`. Every response is JSON. Errors use:

```json
{ "error": { "code": "content_rejected", "message": "...", "field": "content" } }
```

## Privacy contract

The ingest endpoint accepts a **closed** set of fields. Anything else is refused before the record reaches the index,
so message content cannot be stored even by mistake:

- A request carrying `content`, `body`, `text`, `message`, `plaintext`, `payload`, `data`, `ciphertext`, `subject`,
  `preview`, `attachment` or `attachments` fails with `400 content_rejected`.
- Any other unrecognised field fails with `400 unknown_field`.
- No response includes message content, and `contentAvailable` is always `false`.

## `POST /api/v1/records`

Records one encrypted message. Requires `Content-Type: application/json`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ciphertextHash` | string | yes | 64 lowercase hex chars. Digest of the encrypted payload, computed on the client |
| `size` | integer | yes | Ciphertext length in bytes, `1..CHATSCAN_MAX_CIPHERTEXT_BYTES` |
| `protocol` | string | no | `C7` (default), `C7G`, `ETH`, `X11` |
| `channelHash` | string | no | 64 hex chars. Opaque conversation identifier |
| `nonce` | string | no | Up to 64 hex chars. Distinguishes repeat sends of an identical ciphertext |
| `fee` | number | no | Non-negative fee paid for inclusion |
| `appVersion` | string | no | Up to 32 chars of `[A-Za-z0-9._+-]` |
| `anchorTxid` | string | on CDCI | 64 hex chars. The CDCI transaction whose `OP_RETURN` carries this record's commitment. Required when `CDCI_REQUIRE_ANCHOR=true` |

Authentication: none while `CHATSCAN_INGEST_KEYS` is unset. Once set, send
`Authorization: Bearer <key>` or `X-ChatScan-Key: <key>`.

**201 Created** - the record was admitted:

```json
{
  "ref": "d700bc90...27a8/42",
  "hash": "d700bc90...27a8",
  "id": 42,
  "status": "confirmed",
  "rejectionReason": null,
  "commitment": "7c1d...9e",
  "anchor": {
    "txid": "7b19...c4",
    "outputIndex": 1,
    "blockHash": "00000a...f1",
    "blockHeight": 184203,
    "confirmations": 2,
    "chainlock": false,
    "finality": "confirmed",
    "verifiedAt": "2026-08-06T12:00:00.000Z"
  },
  "explorerUrl": "/tx/d700bc90...27a8/42",
  "record": { "...": "see the record object below" }
}
```

`status` is `confirmed` when the anchor is already in a CDCI block, and `pending` while it is still in the mempool or the
node has not been reached yet.

**202 Accepted** - the submission was well formed but violated chain policy. It is still indexed, with
`status: "rejected"` and a `rejectionReason` of:

| Reason | Cause |
| --- | --- |
| `replay-detected` | This ciphertext digest and nonce were already recorded |
| `protocol-size-exceeded` | `size` is over the protocol's ceiling |
| `anchor-missing` | No `anchorTxid`, while the node requires one |
| `anchor-not-found` | The CDCI node does not know that transaction (it needs `-txindex=1`) |
| `anchor-mismatch` | The transaction's `OP_RETURN` commits to a different submission |

Other statuses: `400` validation failure, `401` bad ingest key, `413` body over `CHATSCAN_MAX_REQUEST_BYTES`,
`429` over `CHATSCAN_INGEST_RATE_PER_MINUTE`.

## `POST /api/v1/anchor-payload`

Returns the commitment for a submission that has not been sent yet, so a client can publish the anchor first. Takes the
same fields as `POST /api/v1/records` (`anchorTxid` optional and ignored).

```json
{
  "chainId": "cdci:main",
  "preimage": "chatscan/1:cdci:main|3f2a...b1|1024|C7||",
  "commitment": "7c1d...9e",
  "marker": "CS1",
  "opReturnPayload": "4353317c1d...9e",
  "opReturnScript": "6a234353317c1d...9e",
  "note": "Publish this payload in an OP_RETURN output on the CDCI chain, then submit the record with the transaction id as \"anchorTxid\"."
}
```

The derivation is documented in [CDCI.md](CDCI.md#3-anchor-a-message); a client can compute it offline.

## `GET /api/v1/records/{HASH}/{ID-number}/anchor`

The same instructions for a record already indexed, plus its current `anchor` state.

## `GET /api/v1/records`

Newest first. Query: `limit` (1-100, default 25), `offset`, `status` (`pending`, `confirmed`, `rejected`),
`protocol`, `channel` (64 hex chars).

```json
{ "total": 128, "limit": 25, "offset": 0, "records": [ { "...": "record object" } ] }
```

## `GET /api/v1/records/{HASH}/{ID-number}`

The record object for one reference. `400 invalid_ref` if the reference is malformed, `404` if it is unknown.

```json
{
  "record": {
    "ref": "d700bc90...27a8/42",
    "hash": "d700bc90...27a8",
    "id": 42,
    "commitment": "7c1d...9e",
    "ciphertextHash": "3f2a...b1",
    "size": 1024,
    "protocol": "C7",
    "protocolLabel": "Protocol C7",
    "channelHash": "9c81...0e",
    "fee": 0.00042,
    "appVersion": "cc-1.0",
    "status": "confirmed",
    "rejectionReason": null,
    "receivedAt": "2026-08-06T12:00:00.000Z",
    "confirmedAt": "2026-08-06T12:00:15.000Z",
    "blockHeight": 184203,
    "blockHash": "00000a...f1",
    "indexInBlock": null,
    "anchor": {
      "txid": "7b19...c4",
      "outputIndex": 1,
      "blockHash": "00000a...f1",
      "blockHeight": 184203,
      "confirmations": 2,
      "chainlock": false,
      "finality": "confirmed",
      "verifiedAt": "2026-08-06T12:00:00.000Z"
    },
    "encrypted": true,
    "contentAvailable": false
  }
}
```

`anchor.finality` is `mempool`, `confirmed`, `final`, `chainlocked` or `unknown`. `anchor` is `null` on the local
development chain, where `indexInBlock` is used instead.

## `GET /api/v1/blocks`

Newest first, from the CDCI node. Query: `limit` (1-100, default 10), `offset`. Answers `502 cdci_unavailable` when the
node cannot be reached.

## `GET /api/v1/blocks/{height|hash}`

One block plus the message records it carries - anchored in it on CDCI, sealed into it on the local chain.

```json
{
  "block": {
    "source": "cdci",
    "height": 184203,
    "hash": "00000a...f1",
    "previousHash": "00000b...c4",
    "nextHash": "00000c...02",
    "merkleRoot": "7de1...aa",
    "timestamp": "2026-08-06T12:00:15.000Z",
    "algorithm": "x11",
    "difficulty": 1543.219,
    "chainwork": "000000000000000000000000000000000000000000000000000000000f4240",
    "nonce": 431,
    "bits": "1e0ffff0",
    "version": 536870912,
    "txCount": 12,
    "sizeBytes": 24576,
    "confirmations": 9,
    "chainlock": true,
    "totalFees": null,
    "sealedBy": null,
    "recordRefs": null
  },
  "records": [ { "...": "record object" } ]
}
```

`source` is `cdci` or `local`. `totalFees`, `sealedBy` and `recordRefs` are local-chain fields; `chainwork`, `bits`,
`confirmations` and `chainlock` come from CDCI.

## `GET /api/v1/search?q=`

Resolves a `{HASH}/{ID-number}` reference, a 64-hex record hash, block hash or anchor transaction id, a block height, or
a record ID-number. `kind` is one of `record-ref`, `record-hash`, `block-hash`, `anchor-txid`, `number`, `empty`,
`unsupported`.

```json
{
  "query": "1",
  "kind": "number",
  "results": [{ "type": "record", "url": "/tx/d700bc90...27a8/1", "record": { "...": "" } }]
}
```

## `GET /api/v1/status`

Network snapshot: backend, chain state, height, tip hash, fee estimate, unconfirmed count and bytes, throughput,
24-hour totals, per-record averages, anchoring settings, supported protocols, and the privacy statement. This is what the
dashboard header renders.

`status` is `online`, `syncing` or `offline` on CDCI (`degraded` and `paused` apply to the local chain). The `chain`
object holds the node's own figures - `chain`, `blocks`, `headers`, `bestBlockHash`, `difficulty`, `chainwork`, `peers`,
`subversion`, `mempool`, `chainlock` - plus `reachable` and `error` when the node cannot be reached.

## `GET /api/v1/chain`

Just the chain state from `/api/v1/status`, without the record aggregates.

## `GET /api/v1/algorithm`

The eleven X11 rounds in CDCI `HashX11` order, with the digest bound to each slot, and a note on what these hashes are
used for. In `cdci` mode block hashes come from the node, not from here.

## `GET /api/v1/stream`

Server-sent events. Emits `status` on connect and on a heartbeat, `record` when a message is indexed, and `block` when
one is sealed. Payloads are the same public objects used elsewhere, so no content is ever streamed.

```bash
curl -N http://localhost:3000/api/v1/stream
```

## `GET /healthz`

Liveness probe: `{ "status": "ok", "uptimeSeconds": 42 }`.
