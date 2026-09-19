import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { GitHubClient } from '../../adapters/github/client';
import { IssueSearchPages, type IssuePage } from '../../adapters/github/issue-pages';
import type { ApiFailure, Connection } from '../../domain/types';
import type { SyncEngine } from '../../sync/engine';

interface FeedState {
  started: boolean;
  ids: Set<number>;
  loading: boolean;
  hasMore: boolean;
  error?: ApiFailure;
}

export class IssueFeed {
  private state: FeedState = { started: false, ids: new Set(), loading: false, hasMore: true };
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private pending?: Promise<void>;
  private nextUrl?: string;
  private prepared?: IssuePage;

  constructor(
    private readonly fetchPage: (next: string | undefined, signal: AbortSignal) => Promise<IssuePage>,
    private readonly ingest: (page: IssuePage, signal: AbortSignal) => Promise<void>,
  ) {}

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<FeedState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  stop = () => this.controller.abort();
  resume = () => {
    if (this.controller.signal.aborted) {
      this.controller = new AbortController();
      this.pending = undefined;
    }
  };
  load = (): Promise<void> => {
    if (this.pending) return this.pending;
    if (!this.state.hasMore || this.controller.signal.aborted) return Promise.resolve();
    this.update({ started: true, loading: true, error: undefined });
    const signal = this.controller.signal;
    this.pending = (async () => {
      try {
        const page = this.prepared ?? (await this.fetchPage(this.nextUrl, signal));
        signal.throwIfAborted();
        this.prepared = page;
        await this.ingest(this.prepared, signal);
        signal.throwIfAborted();
        const ids = new Set(this.state.ids);
        this.prepared.issues.forEach((issue) => ids.add(issue.id));
        this.nextUrl = this.prepared.next;
        this.prepared = undefined;
        this.update({ ids, hasMore: !!this.nextUrl });
      } catch (error) {
        if (!signal.aborted)
          this.update({
            error: (error as { failure?: ApiFailure })?.failure ?? { code: 'NETWORK_UNCERTAIN' },
          });
      } finally {
        if (signal === this.controller.signal) this.pending = undefined;
        if (!signal.aborted) this.update({ loading: false });
      }
    })();
    return this.pending;
  };
}

const offlineState: FeedState = { started: false, ids: new Set(), loading: false, hasMore: false };
const offlineSnapshot = () => offlineState;
const offlineSubscribe = () => () => {};

export function useIssueFeed(
  engine: SyncEngine | null,
  client: GitHubClient | null,
  connection: Connection,
  query: string,
  conditions: string,
  enabled: boolean,
) {
  const feed = useMemo(() => {
    if (!engine || !client || !enabled) return null;
    const search = query
      ? new IssueSearchPages((range, signal) => client.searchIssuesPage(connection, query, range, signal))
      : null;
    return new IssueFeed(
      (next, signal) => (search ? search.next(signal) : engine.loadIssuePage(next, signal)),
      (page, signal) => (search ? engine.ingestPage(page.issues, signal) : Promise.resolve()),
    );
    // Conditions intentionally restart the result set, including filters applied locally.
  }, [engine, client, connection, query, conditions, enabled]);
  useEffect(() => {
    if (!feed) return;
    // Defer start so StrictMode's setup/cleanup replay cannot dispatch an obsolete request.
    const timer = setTimeout(() => {
      feed.resume();
      void feed.load();
    }, 0);
    return () => {
      clearTimeout(timer);
      feed.stop();
    };
  }, [feed]);
  const state = useSyncExternalStore(feed?.subscribe ?? offlineSubscribe, feed?.snapshot ?? offlineSnapshot);
  return { ...state, remote: !!feed, load: feed?.load };
}
