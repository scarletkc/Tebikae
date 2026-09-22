export const NOTE_COLORS = ['default', 'yellow', 'green', 'blue', 'purple', 'red'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export type NoteKind = 'markdown' | 'checklist';
export interface NoteMetadata {
  schemaVersion: 1;
  id: string;
  kind: NoteKind;
  color: NoteColor;
  pinned: boolean;
  trashedAt: string | null;
  [key: string]: unknown;
}
export interface NoteDocument {
  title: string;
  markdown: string;
  meta: NoteMetadata;
  archived: boolean;
  labelIds: number[];
}
export interface Label {
  id: number;
  name: string;
  color: string;
  description: string | null;
}
export interface RawIssueSnapshot {
  id: number;
  nodeId: string;
  number: number;
  url: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  stateReason: string | null;
  labels: Label[];
  createdAt: string;
  updatedAt: string;
}
export type ParseResult =
  | { status: 'managed'; meta: NoteMetadata; markdown: string }
  | { status: 'unmanaged' | 'unsupported' | 'invalid'; markdown: string; reason?: string };
export type SyncStatus =
  | 'local-draft'
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'auth-required'
  | 'rate-limited'
  | 'conflict'
  | 'uncertain'
  | 'error';
export type ApiFailureCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND_OR_INACCESSIBLE'
  | 'ISSUES_DISABLED'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'NETWORK_UNCERTAIN'
  | 'SERVER_ERROR'
  | 'PRIVATE_REQUIRED'
  | 'OWNER_REQUIRED'
  | 'ARCHIVED_REPOSITORY'
  | 'SESSION_EXPIRED';
export interface ApiFailure {
  code: ApiFailureCode;
  status?: number;
  retryAt?: string;
  requestId?: string;
  detail?: string;
}
export interface Connection {
  scopeId: string;
  viewerId: number;
  login: string;
  repoId: number;
  owner: string;
  repo: string;
  lastConnectedAt: string;
  readOnly?: boolean;
}
export interface LocalNote {
  scopeId: string;
  localId: string;
  issueId?: number;
  issueNumber?: number;
  current: NoteDocument;
  base: RawIssueSnapshot | null;
  lastSeenRemote: RawIssueSnapshot | null;
  localRevision: number;
  localCreatedAt: string;
  localModifiedAt: string;
  syncStatus: SyncStatus;
  error?: ApiFailure;
  conflictFields?: string[];
  duplicate?: boolean;
  remoteUnavailable?: boolean;
  /** Fingerprint of a restored backup record; used only for local import deduplication. */
  importFingerprint?: string;
  purgeStartedAt?: string;
}
export interface DeletedIssue {
  scopeId: string;
  issueId: number;
}
export interface UnmanagedIssue {
  scopeId: string;
  issueId: number;
  snapshot: RawIssueSnapshot;
  status: 'unmanaged' | 'unsupported' | 'invalid';
  reason?: string;
}
export interface OutboxEntry {
  scopeId: string;
  localId: string;
  operationId: string;
  kind: 'create' | 'update';
  status: 'pending' | 'sending' | 'uncertain' | 'conflict' | 'error';
  attemptSnapshot?: NoteDocument;
  attemptRevision?: number;
  attemptStartedAt?: string;
  retryAt?: string;
  attemptBase?: RawIssueSnapshot;
  /** Consecutive transient failures; reset after confirmed progress or an explicit retry. */
  retryAttempts?: number;
  attemptLocalSnapshot?: NoteDocument;
  forceExpectedRemote?: RawIssueSnapshot;
}
export interface SyncState {
  scopeId: string;
  cursor?: string;
  lastFullScanAt?: string;
  initialLoadComplete: boolean;
  loading?: boolean;
  loadedCount?: number;
  lastPullAt?: string;
  /** Durable scope-wide server cooldown, including across a fresh authenticated session. */
  rateLimitUntil?: string;
  pullRetryAt?: string;
  pullRetryAttempts?: number;
  error?: ApiFailure;
}
export interface Recovery {
  id?: number;
  scopeId: string;
  localId: string;
  createdAt: string;
  reason: string;
  snapshot: NoteDocument;
  resolved?: boolean;
}
export interface HttpCacheEntry {
  scopeId: string;
  url: string;
  accept: string;
  apiVersion: string;
  etag: string;
  response: unknown;
  link: string | null;
}
export interface NoteFilters {
  view: 'notes' | 'archive' | 'trash' | 'all';
  query: string;
  labelIds: number[];
  labelMatch: 'all' | 'any';
  unlabeledOnly: boolean;
  colors: NoteColor[];
  kinds: NoteKind[];
  pinned: 'all' | 'pinned' | 'unpinned';
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  unsyncedOnly: boolean;
  sort: 'updated-desc' | 'updated-asc' | 'created-desc' | 'title';
}
