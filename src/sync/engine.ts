import { parseNoteBody, serializeNoteBody, snapshotToDocument } from '../domain/codec';
import { mergeThreeWay } from '../domain/merge';
import type {
  ApiFailure,
  Connection,
  Label,
  LocalNote,
  NoteDocument,
  OutboxEntry,
  RawIssueSnapshot,
  SyncState,
} from '../domain/types';
import { recoverInterruptedWrites, saveRecovery, type TebikaeDB } from '../storage/db';

export interface SyncClient {
  pollIntervalMs?: number;
  getAnchor(connection: Connection): Promise<string | undefined>;
  listIssues(connection: Connection, options?: { since?: string }): AsyncIterable<RawIssueSnapshot[]>;
  getIssue(connection: Connection, number: number): Promise<RawIssueSnapshot>;
  createIssue(
    connection: Connection,
    payload: { title: string; body: string; labels?: string[] },
  ): Promise<RawIssueSnapshot>;
  updateIssue(
    connection: Connection,
    number: number,
    payload: { title?: string; body?: string; state?: 'open' | 'closed'; state_reason?: 'completed' },
  ): Promise<RawIssueSnapshot>;
  deleteIssue(connection: Connection, nodeId: string): Promise<void>;
  listLabels(connection: Connection): Promise<Label[]>;
  addLabels(connection: Connection, number: number, names: string[]): Promise<unknown>;
  removeLabel(connection: Connection, number: number, name: string): Promise<unknown>;
  createLabel(
    connection: Connection,
    input: { name: string; color?: string; description?: string },
  ): Promise<Label>;
}

// These extra snapshots make partial acknowledgement and crash recovery explicit.
type Attempt = OutboxEntry & {
  attemptBase?: RawIssueSnapshot;
  attemptLocalSnapshot?: NoteDocument;
  forceExpectedRemote?: RawIssueSnapshot;
};
type StatusListener = () => void;
interface QueuedWork {
  generation: number;
  priority: number;
  work(generation: number): Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}
const now = () => new Date().toISOString();
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const failureOf = (error: unknown): ApiFailure => {
  const failure = (error as { failure?: ApiFailure })?.failure;
  return failure || { code: 'NETWORK_UNCERTAIN' };
};

export class SyncEngine {
  readonly editingIds = new Set<string>();
  private queue: QueuedWork[] = [];
  private running = false;
  private generation = 0;
  private stopped = false;
  private hasPulled = false;
  private initialized = false;
  private interval?: ReturnType<typeof setInterval>;
  private autoTimer?: ReturnType<typeof setTimeout>;
  private lastAutoWrite = 0;
  private lastPull = 0;
  private listeners = new Set<StatusListener>();
  private removeEvents?: () => void;
  private pausedUntil = 0;
  private purging = new Map<string, Promise<void>>();

  constructor(
    readonly db: TebikaeDB,
    readonly client: SyncClient,
    readonly connection: Connection,
  ) {}

  subscribe(listener: StatusListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setEditing(localId: string, editing: boolean) {
    if (editing) this.editingIds.add(localId);
    else this.editingIds.delete(localId);
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private active(generation: number) {
    return !this.stopped && generation === this.generation;
  }
  private assertActive(generation: number) {
    if (!this.active(generation))
      throw Object.assign(new Error('SESSION_EXPIRED'), { failure: { code: 'SESSION_EXPIRED' } });
  }
  private enqueue(work: (generation: number) => Promise<void>, priority = 0): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ generation: this.generation, priority, work, resolve, reject });
      this.queue.sort((a, b) => b.priority - a.priority);
      void this.drain();
    });
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      try {
        this.assertActive(job.generation);
        if (!this.initialized) {
          await recoverInterruptedWrites(this.db, this.connection.scopeId);
          this.initialized = true;
        }
        this.assertActive(job.generation);
        await job.work(job.generation);
        job.resolve();
      } catch (error) {
        job.reject(error);
      }
    }
    this.running = false;
  }

  async start() {
    if (this.stopped) return;
    if (!this.interval && typeof window !== 'undefined') {
      const refresh = (minimum = 15_000) => {
        if (document.visibilityState !== 'visible' || (typeof navigator !== 'undefined' && !navigator.onLine))
          return;
        if (Date.now() - this.lastPull >= minimum)
          void this.pull()
            .then(() => this.flush())
            .catch(() => undefined);
      };
      const visible = () => refresh();
      const online = () => {
        void this.pull()
          .then(() => this.flush())
          .catch(() => undefined);
      };
      document.addEventListener('visibilitychange', visible);
      window.addEventListener('online', online);
      this.removeEvents = () => {
        document.removeEventListener('visibilitychange', visible);
        window.removeEventListener('online', online);
      };
      this.interval = setInterval(
        () => refresh(Math.max(60_000, this.client.pollIntervalMs || 60_000)),
        60_000,
      );
    }
    await this.pull();
    await this.flush();
  }

  stop() {
    this.stopped = true;
    this.generation++;
    clearInterval(this.interval);
    clearTimeout(this.autoTimer);
    this.removeEvents?.();
  }

  pull(full = false) {
    return this.enqueue((generation) => this.pullInner(generation, full));
  }

  private async pullInner(generation: number, forceFull: boolean) {
    const scopeId = this.connection.scopeId;
    if (Date.now() < this.pausedUntil) return;
    const previous = await this.db.syncState.get(scopeId);
    const full =
      forceFull ||
      !previous?.initialLoadComplete ||
      !previous.lastFullScanAt ||
      Date.now() - Date.parse(previous.lastFullScanAt) >= 86_400_000;
    const state: SyncState = {
      ...previous,
      scopeId,
      initialLoadComplete: previous?.initialLoadComplete || false,
      loading: true,
      loadedCount: 0,
      error: undefined,
    };
    await this.db.syncState.put(state);
    try {
      const anchor = await this.client.getAnchor(this.connection);
      this.assertActive(generation);
      const labels = await this.client.listLabels(this.connection);
      this.assertActive(generation);
      await this.db.transaction('rw', this.db.labels, async () => {
        await this.db.labels.where('scopeId').equals(scopeId).delete();
        await this.db.labels.bulkPut(labels.map((label) => ({ ...label, scopeId })));
      });
      const seen = new Set<number>();
      const since =
        !full && previous?.cursor ? new Date(Date.parse(previous.cursor) - 60_000).toISOString() : undefined;
      for await (const page of this.client.listIssues(this.connection, { since })) {
        this.assertActive(generation);
        for (const remote of page) {
          if (seen.has(remote.id)) continue;
          seen.add(remote.id);
          await this.ingest(remote, generation);
        }
        await this.db.syncState.update(scopeId, { loadedCount: seen.size });
        this.emit();
      }
      this.assertActive(generation);
      await this.detectDuplicates();
      if (full) {
        await this.db.notes
          .where('scopeId')
          .equals(scopeId)
          .modify((note) => {
            if (note.issueId)
              note.remoteUnavailable =
                !seen.has(note.issueId) || Boolean(note.conflictFields?.includes('protocol'));
          });
        // A completed full scan that never saw an Issue with a pending purge attempt is the
        // only trustworthy confirmation that its deletion took effect: an inaccessible
        // repository fails the scan itself, and a single GET cannot distinguish a deleted
        // Issue from a private one the token can no longer see.
        const confirmed = await this.db.notes
          .where('scopeId')
          .equals(scopeId)
          .filter((note) => Boolean(note.issueId) && Boolean(note.purgeStartedAt) && !seen.has(note.issueId!))
          .toArray();
        for (const note of confirmed) {
          await this.db.transaction(
            'rw',
            [
              this.db.notes,
              this.db.outbox,
              this.db.recovery,
              this.db.deletedIssues,
              this.db.unmanagedIssues,
              this.db.httpCache,
            ],
            async () => {
              this.assertActive(generation);
              await this.purgeLocalRecords(scopeId, note.localId, note.issueId);
            },
          );
          this.editingIds.delete(note.localId);
        }
        if (confirmed.length) this.emit();
      }
      const stamp = now();
      await this.db.syncState.put({
        ...state,
        loading: false,
        loadedCount: seen.size,
        initialLoadComplete: full ? true : state.initialLoadComplete,
        cursor: anchor || previous?.cursor,
        lastFullScanAt: full ? stamp : previous?.lastFullScanAt,
        lastPullAt: stamp,
      });
      this.hasPulled = true;
      this.lastPull = Date.now();
      this.emit();
    } catch (error) {
      if (!this.active(generation)) return;
      const failure = failureOf(error);
      if (failure.code === 'SESSION_EXPIRED') return;
      this.pause(failure);
      await this.db.syncState.update(scopeId, { loading: false, error: failure });
      this.emit();
      throw error;
    }
  }

  private async ingest(remote: RawIssueSnapshot, generation: number) {
    this.assertActive(generation);
    const scopeId = this.connection.scopeId;
    const document = snapshotToDocument(remote);
    await this.db.transaction(
      'rw',
      this.db.notes,
      this.db.unmanagedIssues,
      this.db.outbox,
      this.db.recovery,
      this.db.deletedIssues,
      async () => {
        if (await this.db.deletedIssues.get([scopeId, remote.id])) return;
        let note = await this.db.notes.where('[scopeId+issueId]').equals([scopeId, remote.id]).first();
        if (note?.purgeStartedAt) {
          // The Issue exists again, so a pending purge attempt never took effect remotely;
          // drop the attempt and ingest the note normally so it stays recoverable.
          await this.db.notes.update([scopeId, note.localId], { purgeStartedAt: undefined });
          note.purgeStartedAt = undefined;
        }
        if (!document) {
          const parsed = parseNoteBody(remote.body);
          if (parsed.status === 'managed') return;
          await this.db.unmanagedIssues.put({
            scopeId,
            issueId: remote.id,
            snapshot: remote,
            status: parsed.status,
            reason: parsed.reason,
          });
          if (note) {
            await saveRecovery(this.db, note, 'remote-protocol-changed');
            await this.db.notes.update([scopeId, note.localId], {
              lastSeenRemote: remote,
              remoteUnavailable: true,
              syncStatus: 'conflict',
              conflictFields: ['protocol'],
            });
            await this.db.outbox.update([scopeId, note.localId], { status: 'conflict' });
          }
          return;
        }
        await this.db.unmanagedIssues.delete([scopeId, remote.id]);
        if (!note) {
          const candidates = await this.db.notes
            .where('scopeId')
            .equals(scopeId)
            .filter((candidate) => !candidate.issueId && candidate.current.meta.id === document.meta.id)
            .toArray();
          for (const candidate of candidates) {
            const attempt = await this.db.outbox.get([scopeId, candidate.localId]);
            if (attempt?.attemptStartedAt) {
              note = candidate;
              break;
            }
          }
          if (note) {
            const attempt = (await this.db.outbox.get([scopeId, note.localId])) as Attempt;
            await this.recoverCreate(note, attempt, remote);
            return;
          }
        }
        if (note) {
          const pending = await this.db.outbox.get([scopeId, note.localId]);
          await this.db.notes.put({
            ...note,
            lastSeenRemote: remote,
            remoteUnavailable: false,
            ...(pending || this.editingIds.has(note.localId)
              ? {}
              : { current: document, base: remote, syncStatus: 'synced' as const, error: undefined }),
          });
        } else {
          await this.db.notes.add({
            scopeId,
            localId: crypto.randomUUID(),
            issueId: remote.id,
            issueNumber: remote.number,
            current: document,
            base: remote,
            lastSeenRemote: remote,
            localRevision: 0,
            localCreatedAt: remote.createdAt,
            localModifiedAt: remote.updatedAt,
            syncStatus: 'synced',
          });
        }
      },
    );
  }

  /** Called inside ingest's transaction after locating an uncertain POST by UUID. */
  private async recoverCreate(note: LocalNote, attempt: Attempt, remote: RawIssueSnapshot) {
    const sent = attempt.attemptSnapshot;
    const document = snapshotToDocument(remote);
    if (!sent || !document) {
      await this.conflict(note, remote, ['base']);
      return;
    }
    // The POST sent this content but always created an open Issue. Treat any
    // outstanding archive intent as a local change, alongside edits made since dispatch.
    const baseline: RawIssueSnapshot = {
      ...remote,
      title: sent.title,
      body: serializeNoteBody(sent.meta, sent.markdown),
      state: 'open',
      labels: sent.labelIds.map((id) => ({ id, name: '', color: '', description: null })),
    };
    const result = mergeThreeWay(baseline, note.current, remote);
    const conflicted = result.conflicts.length > 0;
    const done = !conflicted && this.sameContent(result.document, document);
    const key: [string, string] = [note.scopeId, note.localId];
    if (conflicted) await saveRecovery(this.db, note, 'recovered-create-conflict');
    await this.db.notes.put({
      ...note,
      issueId: remote.id,
      issueNumber: remote.number,
      current: result.document,
      base: conflicted ? baseline : remote,
      lastSeenRemote: remote,
      syncStatus: conflicted ? 'conflict' : done ? 'synced' : 'pending',
      conflictFields: conflicted ? result.conflicts : undefined,
      error: undefined,
      remoteUnavailable: false,
    });
    if (done) {
      await this.db.outbox.delete(key);
      await this.db.recovery.where('[scopeId+localId]').equals(key).modify({ resolved: true });
    } else {
      // The creation is confirmed. Future work must reconcile against the merged
      // baseline as an update, not replay the old POST snapshot after another restart.
      await this.db.outbox.put({
        scopeId: note.scopeId,
        localId: note.localId,
        operationId: attempt.operationId,
        kind: 'update',
        status: conflicted ? 'conflict' : 'pending',
      });
    }
  }

  private async detectDuplicates() {
    const scopeId = this.connection.scopeId;
    await this.db.transaction('rw', this.db.notes, this.db.outbox, async () => {
      const notes = await this.db.notes.where('scopeId').equals(scopeId).toArray();
      const byId = new Map<string, LocalNote[]>();
      for (const note of notes) {
        const identity = this.identity(note);
        const group = byId.get(identity) || [];
        group.push(note);
        byId.set(identity, group);
      }
      for (const group of byId.values()) {
        if (group.length < 2) continue;
        for (const note of group) {
          await this.db.notes.update([scopeId, note.localId], {
            duplicate: true,
            syncStatus: 'conflict',
            conflictFields: ['duplicate-id'],
          });
          await this.db.outbox.update([scopeId, note.localId], { status: 'conflict' });
        }
      }
    });
  }

  private identity(note: LocalNote) {
    const baseId = note.base && snapshotToDocument(note.base)?.meta.id;
    const remoteId = note.lastSeenRemote && snapshotToDocument(note.lastSeenRemote)?.meta.id;
    const intentionalRename = baseId && note.current.meta.id !== baseId;
    return intentionalRename ? note.current.meta.id : remoteId || note.current.meta.id;
  }

  flush(manual = false) {
    if (!manual) {
      const wait = Math.max(0, this.lastAutoWrite + 30_000 - Date.now());
      if (wait > 0) {
        clearTimeout(this.autoTimer);
        this.autoTimer = setTimeout(() => {
          void this.flush().catch(() => undefined);
        }, wait);
        return Promise.resolve();
      }
    }
    return this.enqueue(
      async (generation) => {
        if (this.connection.readOnly || Date.now() < this.pausedUntil) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          await this.db.notes
            .where('scopeId')
            .equals(this.connection.scopeId)
            .filter((note) => note.syncStatus === 'pending' || note.syncStatus === 'local-draft')
            .modify({ syncStatus: 'offline' });
          return;
        }
        if (!this.hasPulled) await this.pullInner(generation, false);
        this.assertActive(generation);
        const entries = await this.db.outbox.where('scopeId').equals(this.connection.scopeId).toArray();
        for (const entry of entries) {
          this.assertActive(generation);
          if (
            entry.status === 'conflict' ||
            entry.status === 'error' ||
            (entry.retryAt && Date.parse(entry.retryAt) > Date.now())
          )
            continue;
          const note = await this.db.notes.get([entry.scopeId, entry.localId]);
          if (!note || note.duplicate || note.remoteUnavailable || note.purgeStartedAt) continue;
          if (entry.kind === 'create' && entry.status === 'uncertain') continue;
          if (!manual && this.lastAutoWrite && Date.now() - this.lastAutoWrite < 30_000) {
            clearTimeout(this.autoTimer);
            this.autoTimer = setTimeout(
              () => {
                void this.flush().catch(() => undefined);
              },
              30_000 - (Date.now() - this.lastAutoWrite),
            );
            break;
          }
          try {
            if (note.issueNumber) await this.update(note, entry as Attempt, generation);
            else await this.create(note, generation);
          } catch (error) {
            if (!this.active(generation)) return;
            const failure = failureOf(error);
            if (failure.code === 'SESSION_EXPIRED') return;
            await this.recordFailure(note, failure);
            if (['AUTH_REQUIRED', 'RATE_LIMITED', 'FORBIDDEN'].includes(failure.code)) break;
          }
        }
        this.emit();
      },
      manual ? 10 : 0,
    );
  }

  private async freeze(note: LocalNote, desired: NoteDocument, remote?: RawIssueSnapshot): Promise<Attempt> {
    return this.db.transaction('rw', this.db.notes, this.db.outbox, this.db.recovery, async () => {
      const key: [string, string] = [note.scopeId, note.localId];
      const entry = await this.db.outbox.get(key);
      if (!entry) throw new Error('MISSING_INTENT');
      const attempt: Attempt = {
        ...entry,
        status: 'sending',
        attemptSnapshot: structuredClone(desired),
        attemptLocalSnapshot: structuredClone(note.current),
        attemptBase: remote,
        attemptRevision: note.localRevision,
        attemptStartedAt: now(),
        retryAt: undefined,
      };
      await saveRecovery(this.db, note, 'before-write');
      await this.db.outbox.put(attempt);
      await this.db.notes.update(key, { syncStatus: 'syncing', error: undefined });
      return attempt;
    });
  }

  private async create(note: LocalNote, generation: number) {
    const labels = await this.resolveLabels(note.current.labelIds);
    this.assertActive(generation);
    const attempt = await this.freeze(note, note.current);
    this.assertActive(generation);
    this.lastAutoWrite = Date.now();
    let remote = await this.client.createIssue(this.connection, {
      title: note.current.title,
      body: serializeNoteBody(note.current.meta, note.current.markdown),
      labels: labels.map((label) => label.name),
    });
    this.assertActive(generation);
    if (attempt.attemptSnapshot?.archived) {
      // GitHub creates Issues open. Persist its identity before attempting the close,
      // so a failed/lost close response can never cause a second creation.
      await this.acknowledge(note, attempt, remote, false);
      this.assertActive(generation);
      this.lastAutoWrite = Date.now();
      remote = await this.client.updateIssue(this.connection, remote.number, {
        state: 'closed',
        state_reason: 'completed',
      });
      this.assertActive(generation);
    }
    await this.acknowledge(note, attempt, remote, true);
  }

  private async update(note: LocalNote, prior: Attempt, generation: number) {
    const remote = await this.client.getIssue(this.connection, note.issueNumber!);
    this.assertActive(generation);
    note = (await this.db.notes.get([note.scopeId, note.localId])) || note;
    if (prior.status === 'uncertain' && prior.attemptSnapshot) {
      const actual = snapshotToDocument(remote);
      if (actual && this.sameContent(actual, prior.attemptSnapshot)) {
        await this.acknowledge(note, prior, remote, true);
        return;
      }
      // Reconcile against the preflight baseline, never blindly replay a frozen PATCH.
      if (prior.attemptBase && !this.sameRemoteContent(remote, prior.attemptBase)) {
        const before = snapshotToDocument(prior.attemptBase);
        // A successful content PATCH followed by interrupted labels is expected.
        if (!actual || !before || !this.sameContent(actual, prior.attemptSnapshot, false)) {
          await this.conflict(note, remote, ['uncertain-write']);
          return;
        }
        await this.acknowledge(note, prior, remote, false);
        note = (await this.db.notes.get([note.scopeId, note.localId]))!;
      }
    }
    if (prior.forceExpectedRemote && !this.sameRemoteContent(remote, prior.forceExpectedRemote)) {
      await this.conflict(note, remote, ['remote-changed']);
      return;
    }
    let base = note.base;
    let mergeRemote = remote;
    // An explicitly converted unmanaged Issue has a synthetic metadata baseline.
    if (
      base &&
      parseNoteBody(base.body).status === 'unmanaged' &&
      parseNoteBody(remote.body).status === 'unmanaged'
    ) {
      base = { ...base, body: serializeNoteBody(note.current.meta, base.body) };
      mergeRemote = { ...remote, body: serializeNoteBody(note.current.meta, remote.body) };
    }
    const result = mergeThreeWay(base, note.current, mergeRemote);
    if (result.conflicts.length) {
      await this.conflict(note, remote, result.conflicts);
      return;
    }
    const desired = result.document;
    const attempt = await this.freeze(note, desired, remote);
    this.assertActive(generation);
    let confirmed = remote;
    const patch: { title?: string; body?: string; state?: 'open' | 'closed'; state_reason?: 'completed' } =
      {};
    const body = serializeNoteBody(desired.meta, desired.markdown);
    if (remote.title !== desired.title) patch.title = desired.title;
    if (remote.body !== body) patch.body = body;
    if ((remote.state === 'closed') !== desired.archived) {
      patch.state = desired.archived ? 'closed' : 'open';
      if (desired.archived) patch.state_reason = 'completed';
    }
    if (Object.keys(patch).length) {
      this.lastAutoWrite = Date.now();
      confirmed = await this.client.updateIssue(this.connection, note.issueNumber!, patch);
      this.assertActive(generation);
      await this.acknowledge(note, attempt, confirmed, false);
    }
    // Only the user's explicit label delta may mutate labels. The PATCH response
    // may already contain unrelated labels added after our preflight read.
    const baseLabels = new Set(note.base?.labels.map((label) => label.id) || []);
    const desiredLabels = new Set(note.current.labelIds);
    const removed = confirmed.labels.filter(
      (label) => baseLabels.has(label.id) && !desiredLabels.has(label.id),
    );
    const addedIds = note.current.labelIds.filter(
      (id) => !baseLabels.has(id) && !confirmed.labels.some((label) => label.id === id),
    );
    if (removed.length || addedIds.length) {
      // Refresh names by stable ID immediately before label mutations.
      const labels = await this.client.listLabels(this.connection);
      this.assertActive(generation);
      await this.db.labels.bulkPut(labels.map((label) => ({ ...label, scopeId: note.scopeId })));
      for (const label of removed) {
        const latest = labels.find((item) => item.id === label.id);
        if (!latest) continue;
        this.lastAutoWrite = Date.now();
        await this.client.removeLabel(this.connection, note.issueNumber!, latest.name);
        this.assertActive(generation);
      }
      const added = addedIds.map((id) => labels.find((label) => label.id === id));
      if (added.some((label) => !label))
        throw Object.assign(new Error('LABEL_MISSING'), { failure: { code: 'VALIDATION_FAILED' } });
      if (added.length) {
        this.lastAutoWrite = Date.now();
        await this.client.addLabels(
          this.connection,
          note.issueNumber!,
          added.map((label) => label!.name),
        );
        this.assertActive(generation);
      }
      confirmed = await this.client.getIssue(this.connection, note.issueNumber!);
      this.assertActive(generation);
    }
    await this.acknowledge(note, attempt, confirmed, true);
  }

  private async acknowledge(original: LocalNote, attempt: Attempt, remote: RawIssueSnapshot, final: boolean) {
    const document = snapshotToDocument(remote);
    if (!document || !attempt.attemptSnapshot) {
      await this.conflict(original, remote, ['protocol']);
      return;
    }
    await this.db.transaction('rw', this.db.notes, this.db.outbox, this.db.recovery, async () => {
      const key: [string, string] = [original.scopeId, original.localId];
      const latest = await this.db.notes.get(key);
      if (!latest) return;
      const unchanged = latest.localRevision === attempt.attemptRevision;
      // Carry unrelated remote labels into the local document before advancing
      // base; otherwise a subsequent retry could mistake them for removals.
      const desired = structuredClone(attempt.attemptSnapshot!);
      const labelBaseline = new Set(attempt.attemptBase?.labels.map((label) => label.id) || []);
      const labels = new Set(document.labelIds);
      for (const id of labelBaseline) if (!desired.labelIds.includes(id)) labels.delete(id);
      for (const id of desired.labelIds) if (!labelBaseline.has(id)) labels.add(id);
      desired.labelIds = [...labels];
      let current = unchanged ? (final ? document : desired) : latest.current;
      let conflicts: string[] = [];
      if (!unchanged) {
        const originalDocument = attempt.attemptLocalSnapshot || attempt.attemptSnapshot!;
        const baseline = {
          ...remote,
          title: originalDocument.title,
          body: serializeNoteBody(originalDocument.meta, originalDocument.markdown),
          state: originalDocument.archived ? ('closed' as const) : ('open' as const),
          labels: originalDocument.labelIds.map((id) => ({ id, name: '', color: '', description: null })),
        };
        const rebased = mergeThreeWay(baseline, latest.current, {
          ...remote,
          title: desired.title,
          body: serializeNoteBody(desired.meta, desired.markdown),
          state: desired.archived ? 'closed' : 'open',
          labels: desired.labelIds.map((id) => ({ id, name: '', color: '', description: null })),
        });
        // Conflicting new input is always kept verbatim for explicit resolution.
        if (!rebased.conflicts.length) current = rebased.document;
        else conflicts = rebased.conflicts;
      }
      const done = final && !conflicts.length && this.sameContent(current, document);
      const updated: LocalNote = {
        ...latest,
        issueId: remote.id,
        issueNumber: remote.number,
        base: remote,
        lastSeenRemote: remote,
        current,
        syncStatus: conflicts.length ? 'conflict' : done ? 'synced' : 'pending',
        conflictFields: conflicts.length ? conflicts : undefined,
        error: undefined,
        remoteUnavailable: false,
      };
      await this.db.notes.put(updated);
      if (done) {
        await this.db.outbox.delete(key);
        await this.db.recovery.where('[scopeId+localId]').equals(key).modify({ resolved: true });
      } else {
        const entry = await this.db.outbox.get(key);
        if (entry)
          await this.db.outbox.put({
            ...entry,
            kind: 'update',
            status: conflicts.length ? 'conflict' : final ? 'pending' : 'sending',
          });
      }
    });
  }

  private async conflict(note: LocalNote, remote: RawIssueSnapshot, fields: string[]) {
    await this.db.transaction('rw', this.db.notes, this.db.outbox, this.db.recovery, async () => {
      const latest = await this.db.notes.get([note.scopeId, note.localId]);
      if (!latest) return;
      await saveRecovery(this.db, latest, 'conflict');
      await this.db.notes.update([note.scopeId, note.localId], {
        lastSeenRemote: remote,
        syncStatus: 'conflict',
        conflictFields: fields,
      });
      await this.db.outbox.update([note.scopeId, note.localId], { status: 'conflict' });
    });
  }

  private sameContent(a: NoteDocument, b: NoteDocument, labels = true) {
    return (
      a.title === b.title &&
      a.markdown === b.markdown &&
      a.archived === b.archived &&
      equal(a.meta, b.meta) &&
      (!labels ||
        equal(
          [...a.labelIds].sort((x, y) => x - y),
          [...b.labelIds].sort((x, y) => x - y),
        ))
    );
  }
  private sameRemoteContent(a: RawIssueSnapshot, b: RawIssueSnapshot) {
    return (
      a.title === b.title &&
      a.body === b.body &&
      a.state === b.state &&
      equal(
        a.labels.map((label) => label.id).sort((x, y) => x - y),
        b.labels.map((label) => label.id).sort((x, y) => x - y),
      )
    );
  }
  private async resolveLabels(ids: number[]) {
    const labels = await this.db.labels.where('scopeId').equals(this.connection.scopeId).toArray();
    const resolved = ids.map((id) => labels.find((label) => label.id === id));
    if (resolved.some((label) => !label))
      throw Object.assign(new Error('LABEL_MISSING'), { failure: { code: 'VALIDATION_FAILED' } });
    return resolved as Label[];
  }
  private pause(failure: ApiFailure) {
    if (failure.code === 'RATE_LIMITED')
      this.pausedUntil = failure.retryAt ? Date.parse(failure.retryAt) : Date.now() + 60_000;
  }
  private async recordFailure(note: LocalNote, failure: ApiFailure) {
    this.pause(failure);
    await this.db.transaction('rw', this.db.notes, this.db.outbox, async () => {
      const key: [string, string] = [note.scopeId, note.localId];
      const entry = await this.db.outbox.get(key);
      const uncertain =
        (entry?.status === 'sending' || entry?.status === 'uncertain') &&
        ['NETWORK_UNCERTAIN', 'SERVER_ERROR'].includes(failure.code);
      await this.db.notes.update(key, {
        syncStatus: uncertain
          ? 'uncertain'
          : failure.code === 'AUTH_REQUIRED'
            ? 'auth-required'
            : failure.code === 'RATE_LIMITED'
              ? 'rate-limited'
              : 'error',
        error: failure,
      });
      if (entry)
        await this.db.outbox.update(key, {
          status: uncertain ? 'uncertain' : failure.code === 'RATE_LIMITED' ? 'pending' : 'error',
          retryAt: failure.retryAt,
        });
    });
  }

  async retry(localId: string, allowUncertainCreate = false) {
    const scopeId = this.connection.scopeId;
    const entry = await this.db.outbox.get([scopeId, localId]);
    if (!entry) return;
    if (entry.kind === 'create' && entry.status === 'uncertain') {
      await this.pull(true);
      const updated = await this.db.outbox.get([scopeId, localId]);
      if (!updated || updated.kind !== 'create') return this.flush(true);
      if (!allowUncertainCreate) return;
    }
    const status = entry.kind === 'update' && entry.status === 'uncertain' ? 'uncertain' : 'pending';
    await this.db.outbox.update([scopeId, localId], { status });
    await this.db.notes.update([scopeId, localId], { syncStatus: status, error: undefined });
    return this.flush(true);
  }

  /** Removes every local trace of a note whose remote deletion is confirmed.
   * Must run inside a transaction over notes, outbox, recovery, deletedIssues,
   * unmanagedIssues, and httpCache. */
  private async purgeLocalRecords(scopeId: string, localId: string, issueId?: number) {
    if (issueId) {
      await this.db.deletedIssues.put({ scopeId, issueId });
      await this.db.unmanagedIssues.delete([scopeId, issueId]);
      await this.db.httpCache.where('scopeId').equals(scopeId).delete();
    }
    await this.db.notes.delete([scopeId, localId]);
    await this.db.outbox.delete([scopeId, localId]);
    await this.db.recovery.where('[scopeId+localId]').equals([scopeId, localId]).delete();
  }

  destroy(localId: string): Promise<void> {
    const scopeId = this.connection.scopeId;
    const inFlight = this.purging.get(localId);
    if (inFlight) return inFlight;
    const promise = this.enqueue(async (generation) => {
      const note = await this.db.notes.get([scopeId, localId]);
      if (!note) return;
      if (note.current.meta.trashedAt === null) throw new Error('NOTE_NOT_TRASHED');
      if (this.connection.readOnly)
        throw Object.assign(new Error('READ_ONLY'), { failure: { code: 'FORBIDDEN' } });
      const key: [string, string] = [scopeId, localId];
      const entry = await this.db.outbox.get(key);
      const localOnly = !note.issueId && !note.issueNumber && !note.base && !note.lastSeenRemote;
      if (
        localOnly &&
        (!entry ||
          entry.kind !== 'create' ||
          entry.attemptStartedAt ||
          entry.attemptSnapshot ||
          entry.status === 'sending' ||
          entry.status === 'uncertain' ||
          note.syncStatus === 'uncertain' ||
          note.purgeStartedAt)
      )
        throw Object.assign(new Error('CREATE_NOT_CONFIRMED'), { failure: { code: 'NETWORK_UNCERTAIN' } });
      if (!localOnly) {
        // An earlier deleteIssue may have executed while its response was lost, leaving the
        // note purged-but-uncertain. Reconcile first, but never treat a single GET as proof:
        // GitHub also answers 404 for private resources the token can no longer see, so only
        // a completed full scan (in pull) may confirm the deletion and clean up locally.
        if (note.purgeStartedAt) {
          if (typeof navigator !== 'undefined' && !navigator.onLine)
            throw Object.assign(new Error('OFFLINE'), { failure: { code: 'NETWORK_UNCERTAIN' } });
          if (Date.now() < this.pausedUntil)
            throw Object.assign(new Error('RATE_LIMITED'), { failure: { code: 'RATE_LIMITED' } });
          this.assertActive(generation);
          try {
            await this.client.getIssue(this.connection, note.issueNumber!);
          } catch (error) {
            if (this.active(generation)) {
              // The outcome stays unknown, so every record is kept and the note remains
              // recoverable; the next completed full scan decides what happened.
              await this.db.notes.update(key, {
                error: failureOf(error),
                syncStatus: 'uncertain' as const,
              });
            }
            throw error;
          }
          // The Issue still exists, so the earlier mutation never executed. Clear the
          // attempt and the stale unavailability marker, then fall through to the
          // normal verified deletion path.
          await this.db.notes.update(key, { purgeStartedAt: undefined, remoteUnavailable: undefined });
          note.purgeStartedAt = undefined;
          note.remoteUnavailable = undefined;
          this.assertActive(generation);
        }
        if (
          !note.issueId ||
          !note.issueNumber ||
          !note.base ||
          note.duplicate ||
          note.conflictFields?.length ||
          note.remoteUnavailable
        )
          throw new Error('NOTE_NOT_PURGEABLE');
        if (typeof navigator !== 'undefined' && !navigator.onLine)
          throw Object.assign(new Error('OFFLINE'), { failure: { code: 'NETWORK_UNCERTAIN' } });
        if (Date.now() < this.pausedUntil)
          throw Object.assign(new Error('RATE_LIMITED'), { failure: { code: 'RATE_LIMITED' } });
        const remote = await this.client.getIssue(this.connection, note.issueNumber);
        this.assertActive(generation);
        const document = snapshotToDocument(remote);
        if (
          !document ||
          remote.id !== note.issueId ||
          remote.number !== note.issueNumber ||
          !remote.nodeId.trim() ||
          document.meta.id !== note.current.meta.id ||
          !this.sameRemoteContent(remote, note.base) ||
          remote.updatedAt !== note.base.updatedAt
        ) {
          await this.conflict(note, remote, ['remote-changed']);
          throw new Error('REMOTE_CHANGED');
        }
        await this.db.transaction('rw', this.db.notes, async () => {
          this.assertActive(generation);
          const fresh = await this.db.notes.get(key);
          if (
            !fresh ||
            fresh.localRevision !== note.localRevision ||
            !equal(fresh.current, note.current) ||
            fresh.current.meta.trashedAt === null
          )
            throw new Error('NOTE_CHANGED');
          await this.db.notes.update(key, { purgeStartedAt: now() });
          this.assertActive(generation);
        });
        this.assertActive(generation);
        this.lastAutoWrite = Date.now();
        try {
          await this.client.deleteIssue(this.connection, remote.nodeId);
        } catch (error) {
          if (this.active(generation)) {
            const failure = failureOf(error);
            this.pause(failure);
            await this.db.notes.update(key, {
              error: failure,
              ...(['NETWORK_UNCERTAIN', 'SERVER_ERROR', 'SESSION_EXPIRED'].includes(failure.code)
                ? { syncStatus: 'uncertain' as const }
                : { purgeStartedAt: undefined, syncStatus: 'error' as const }),
            });
          }
          throw error;
        }
        this.assertActive(generation);
      }
      await this.db.transaction(
        'rw',
        [
          this.db.notes,
          this.db.outbox,
          this.db.recovery,
          this.db.deletedIssues,
          this.db.unmanagedIssues,
          this.db.httpCache,
        ],
        async () => {
          this.assertActive(generation);
          const final = await this.db.notes.get(key);
          if (!final) return;
          if (final.localRevision !== note.localRevision || !equal(final.current, note.current))
            throw new Error('NOTE_CHANGED');
          if (localOnly) {
            const latestEntry = await this.db.outbox.get(key);
            if (
              latestEntry?.attemptStartedAt ||
              latestEntry?.status === 'sending' ||
              latestEntry?.status === 'uncertain'
            )
              throw new Error('CREATE_NOT_CONFIRMED');
          }
          if (final.issueId) await this.purgeLocalRecords(scopeId, localId, final.issueId);
          else await this.purgeLocalRecords(scopeId, localId);
          this.assertActive(generation);
        },
      );
      this.editingIds.delete(localId);
      this.emit();
    }, 10);
    this.purging.set(localId, promise);
    return promise.finally(() => {
      if (this.purging.get(localId) === promise) this.purging.delete(localId);
    });
  }

  async createLabel(name: string, color = '8b8b8b'): Promise<Label> {
    let result: Label | undefined;
    await this.enqueue(async (generation) => {
      if (this.connection.readOnly) throw new Error('READ_ONLY');
      result = await this.client.createLabel(this.connection, { name: name.trim(), color });
      this.assertActive(generation);
      await this.db.labels.put({ ...result, scopeId: this.connection.scopeId });
    }, 10);
    return result!;
  }

  /** User chooses the original; every other duplicate becomes an independent note. */
  resolveDuplicate(originalLocalId: string) {
    return this.enqueue(async (generation) => {
      const scopeId = this.connection.scopeId;
      const original = await this.db.notes.get([scopeId, originalLocalId]);
      if (!original?.duplicate) return;
      const originalIdentity = this.identity(original);
      const duplicates = await this.db.notes
        .where('scopeId')
        .equals(scopeId)
        .filter((note) => this.identity(note) === originalIdentity)
        .toArray();
      const snapshots = new Map<string, RawIssueSnapshot>();
      const mergedDocuments = new Map<string, { document: NoteDocument; conflicts: string[] }>();
      for (const note of duplicates) {
        if (!note.issueNumber) continue;
        const remote = await this.client.getIssue(this.connection, note.issueNumber);
        this.assertActive(generation);
        const document = snapshotToDocument(remote);
        if (!document || document.meta.id !== originalIdentity) throw new Error('DUPLICATE_CHANGED');
        const merged = mergeThreeWay(note.base, note.current, remote);
        snapshots.set(note.localId, remote);
        mergedDocuments.set(note.localId, merged);
      }
      await this.db.transaction('rw', this.db.notes, this.db.outbox, this.db.recovery, async () => {
        for (const note of duplicates) {
          const remote = snapshots.get(note.localId);
          const document = remote && snapshotToDocument(remote);
          await saveRecovery(this.db, note, 'duplicate-resolution');
          const isOriginal = note.localId === originalLocalId;
          const result = mergedDocuments.get(note.localId);
          const merged = result?.document || note.current;
          const conflicts = result?.conflicts || [];
          const current = {
            ...merged,
            meta: { ...merged.meta, id: isOriginal ? originalIdentity : crypto.randomUUID() },
          };
          const pending = !document || !this.sameContent(current, document);
          await this.db.notes.update([scopeId, note.localId], {
            current,
            base: conflicts.length ? note.base : remote || null,
            lastSeenRemote: remote || null,
            duplicate: false,
            conflictFields: conflicts.length ? conflicts : undefined,
            localRevision: note.localRevision + 1,
            syncStatus: conflicts.length ? 'conflict' : pending ? 'pending' : 'synced',
          });
          if (pending)
            await this.db.outbox.put({
              scopeId,
              localId: note.localId,
              operationId: crypto.randomUUID(),
              kind: remote ? 'update' : 'create',
              status: conflicts.length ? 'conflict' : 'pending',
            });
          else await this.db.outbox.delete([scopeId, note.localId]);
        }
      });
    }, 10);
  }
}
