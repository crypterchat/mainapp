/** Type definitions for @crypterchat/chatscan-sdk. */

export interface AnchorSubject {
  chainId: string;
  ciphertextHash: string;
  size: number;
  protocol?: string;
  channelHash?: string | null;
  nonce?: string;
}

export interface AnchorInstructions {
  commitment: string;
  marker: string;
  preimage: string;
  opReturnPayload: string;
  opReturnScript: string;
}

export interface RecordAnchor {
  txid: string;
  outputIndex: number | null;
  blockHash: string | null;
  blockHeight: number | null;
  confirmations: number;
  chainlock: boolean;
  finality: 'mempool' | 'confirmed' | 'final' | 'chainlocked' | 'unknown';
  verifiedAt: string | null;
}

export interface MessageRecord {
  ref: string;
  hash: string;
  id: number;
  commitment: string | null;
  ciphertextHash: string;
  size: number;
  protocol: string;
  protocolLabel: string;
  channelHash: string | null;
  fee: number;
  appVersion: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  rejectionReason: string | null;
  receivedAt: string;
  confirmedAt: string | null;
  blockHeight: number | null;
  blockHash: string | null;
  indexInBlock: number | null;
  anchor: RecordAnchor | null;
  encrypted: true;
  contentAvailable: false;
}

export interface SubmitResponse {
  ref: string;
  hash: string;
  id: number;
  status: MessageRecord['status'];
  rejectionReason: string | null;
  commitment: string;
  anchor: RecordAnchor | null;
  explorerUrl: string;
  record: MessageRecord;
}

export interface RecordSubmission {
  ciphertextHash: string;
  size: number;
  protocol?: string;
  channelHash?: string | null;
  nonce?: string;
  fee?: number;
  appVersion?: string;
  anchorTxid?: string;
}

export interface ExplorerStatus {
  network: string;
  chainId: string;
  backend: 'cdci' | 'local';
  algorithm: string;
  status: 'online' | 'syncing' | 'offline' | 'degraded' | 'paused';
  height: number | null;
  tipHash: string | null;
  chain: Record<string, unknown>;
  anchoring: {
    mode: string;
    marker: string;
    payloadBytes: number;
    confirmationsForFinality: number;
    required: boolean;
  };
  [key: string]: unknown;
}

export interface WatchHandle {
  close(): void;
  readonly closed: boolean;
}

export declare class ChatScanError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly clientFault: boolean;
}

export declare class ChatScanClient {
  constructor(options: { baseUrl: string; ingestKey?: string; fetch?: typeof fetch; timeoutMs?: number });
  baseUrl: string;
  status(): Promise<ExplorerStatus>;
  chain(): Promise<Record<string, unknown>>;
  algorithm(): Promise<Record<string, unknown>>;
  anchorPayload(submission: RecordSubmission): Promise<AnchorInstructions & { chainId: string; note: string }>;
  submitRecord(record: RecordSubmission): Promise<SubmitResponse>;
  getRecord(ref: string): Promise<MessageRecord>;
  getRecordAnchor(ref: string): Promise<AnchorInstructions & { ref: string; anchor: RecordAnchor | null }>;
  listRecords(query?: {
    limit?: number;
    offset?: number;
    status?: string;
    protocol?: string;
    channel?: string;
  }): Promise<{ total: number; limit: number; offset: number; records: MessageRecord[] }>;
  listBlocks(query?: { limit?: number; offset?: number }): Promise<{ total: number; blocks: Record<string, unknown>[] }>;
  getBlock(heightOrHash: number | string): Promise<{ block: Record<string, unknown>; records: MessageRecord[] }>;
  search(term: string): Promise<{ query: string; kind: string; results: Record<string, unknown>[] }>;
  recordUrl(ref: string): string;
  blockUrl(height: number): string;
  watch(handlers?: {
    onRecord?: (record: MessageRecord) => void;
    onBlock?: (block: Record<string, unknown>) => void;
    onStatus?: (status: ExplorerStatus) => void;
    onError?: (error: unknown) => void;
    reconnectMs?: number;
  }): WatchHandle;
}

export declare class CdciWalletError extends Error {
  code: number | null;
  method: string | null;
}

export declare class CdciWallet {
  constructor(options?: {
    url?: string;
    network?: 'main' | 'test' | 'devnet' | 'regtest';
    user?: string;
    password?: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  });
  url: string;
  call(method: string, params?: unknown[]): Promise<unknown>;
  info(): Promise<{ chain: string | null; blocks: number | null; bestBlockHash: string | null; difficulty: number | null }>;
  publishAnchor(commitment: string): Promise<{ txid: string; fee: number | null }>;
}

export interface SentMessage {
  ref: string;
  explorerUrl: string;
  status: MessageRecord['status'];
  rejectionReason: string | null;
  commitment: string;
  anchorTxid: string | null;
  anchorFee: number | null;
  key: string;
  envelope: Uint8Array;
  record: MessageRecord;
}

export declare class ChatSession {
  constructor(options: { client: ChatScanClient; wallet?: CdciWallet; appVersion?: string; fee?: number });
  static connect(options: {
    baseUrl: string;
    ingestKey?: string;
    wallet?: CdciWallet;
    appVersion?: string;
    fee?: number;
  }): Promise<ChatSession>;
  client: ChatScanClient;
  wallet?: CdciWallet;
  status: ExplorerStatus | null;
  refresh(): Promise<ExplorerStatus>;
  send(
    plaintext: string,
    options?: {
      conversation?: string;
      channelHash?: string;
      protocol?: string;
      key?: string;
      anchorTxid?: string;
    },
  ): Promise<SentMessage>;
  history(
    conversation: string,
    query?: { limit?: number; offset?: number },
  ): Promise<{ total: number; records: MessageRecord[] }>;
  watch(handlers: {
    onRecord: (record: MessageRecord) => void;
    conversation?: string;
    onError?: (error: unknown) => void;
  }): Promise<WatchHandle>;
}

export declare const ANCHOR_MARKER: string;
export declare const ANCHOR_PAYLOAD_BYTES: number;
export declare const CDCI_MAX_OP_RETURN_SCRIPT_BYTES: number;
export declare const CDCI_RPC_PORTS: Readonly<Record<string, number>>;
export declare const VERSION: string;

export declare function anchorCommitment(subject: AnchorSubject): Promise<string>;
export declare function anchorInstructions(subject: AnchorSubject): Promise<AnchorInstructions>;
export declare function anchorPreimage(subject: AnchorSubject): string;
export declare function anchorPayloadHex(commitment: string): string;
export declare function anchorScriptHex(commitment: string): string;
export declare function sha256d(input: Uint8Array | string): Promise<Uint8Array>;
export declare function toHex(bytes: Uint8Array): string;
export declare function fromHex(hex: string): Uint8Array;

export declare function generateMessageKey(): string;
export declare function generateNonce(): string;
export declare function channelHash(conversation: string): Promise<string>;
export declare function sealMessage(
  plaintext: string,
  options?: { key?: string },
): Promise<{ key: string; envelope: Uint8Array; ciphertextHash: string; size: number }>;
export declare function openMessage(envelope: Uint8Array, key: string): Promise<string>;
export declare function digestCiphertext(envelope: Uint8Array): Promise<{ ciphertextHash: string; size: number }>;
