import { describe, expect, it, vi } from 'vitest';
import { IssueSearchPages } from '../src/adapters/github/issue-pages';
import { IssueFeed } from '../src/features/notes/useIssueFeed';
import type { RawIssueSnapshot } from '../src/domain/types';

const issue = (id: number) => ({ id }) as RawIssueSnapshot;

describe('search time range pagination', () => {
  it('recursively partitions over 1000 results and lazily retrieves all pages', async () => {
    const records = Array.from({ length: 2305 }, (_, id) => ({ id, second: Math.floor(id / 300) }));
    const fetch = vi.fn(async ({ from, to, page }: { from: number; to: number; page: number }) => {
      const matches = records.filter((row) => row.second >= from && row.second <= to).reverse();
      return {
        total: matches.length,
        issues: matches.slice((page - 1) * 100, page * 100).map((row) => issue(row.id)),
      };
    });
    const pages = new IssueSearchPages(fetch, 7000);
    const signal = new AbortController().signal;
    const first = await pages.next(signal);
    expect(first.issues).toHaveLength(100);
    expect(fetch).toHaveBeenCalledTimes(3);
    const ids = first.issues.map((row) => row.id);
    let next = first.next;
    while (next) {
      const page = await pages.next(signal);
      ids.push(...page.issues.map((row) => row.id));
      next = page.next;
    }
    expect(ids).toHaveLength(2305);
    expect(new Set(ids).size).toBe(2305);
    expect(fetch.mock.calls.every(([range]) => range.page <= 10)).toBe(true);
  });

  it('deduplicates overlapping results and retries the same failed page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ total: 101, issues: [issue(1), issue(2)] })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ total: 101, issues: [issue(2), issue(3)] });
    const pages = new IssueSearchPages(fetch);
    const signal = new AbortController().signal;
    await pages.next(signal);
    await expect(pages.next(signal)).rejects.toThrow('network');
    expect((await pages.next(signal)).issues.map((row) => row.id)).toEqual([3]);
    expect(fetch.mock.calls[1]![0]).toEqual(fetch.mock.calls[2]![0]);
  });

  it('does not silently truncate an indivisible second and honors cancellation during splitting', async () => {
    const fetch = vi.fn(async () => ({ total: 1001, issues: [] }));
    const signal = new AbortController().signal;
    await expect(new IssueSearchPages(fetch, 0).next(signal)).rejects.toThrow('SEARCH_RANGE_TOO_DENSE');
    const controller = new AbortController();
    const cancelled = new IssueSearchPages(async () => {
      controller.abort();
      return { total: 1001, issues: [] };
    });
    await expect(cancelled.next(controller.signal)).rejects.toThrow();
  });
});

describe('feed request lifecycle', () => {
  it('shares an in-flight request and keeps prefetched data until ingestion succeeds', async () => {
    let release!: (value: { issues: RawIssueSnapshot[]; next: string }) => void;
    const fetch = vi.fn(
      () =>
        new Promise<{ issues: RawIssueSnapshot[]; next: string }>((resolve) => {
          release = resolve;
        }),
    );
    const ingest = vi.fn().mockRejectedValueOnce(new Error('database')).mockResolvedValue(undefined);
    const feed = new IssueFeed(fetch, ingest);
    const pending = feed.load();
    expect(feed.load()).toBe(pending);
    release({ issues: [issue(4)], next: 'page2' });
    await pending;
    expect(feed.snapshot().error).toBeDefined();
    expect(feed.snapshot().ids.size).toBe(0);
    await feed.load();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(feed.snapshot().ids.has(4)).toBe(true);
    expect(feed.snapshot().error).toBeUndefined();
  });

  it('aborts old searches and never ingests a late response', async () => {
    let release!: (value: { issues: RawIssueSnapshot[] }) => void;
    const fetch = vi.fn(
      (_next, signal: AbortSignal) =>
        new Promise<{ issues: RawIssueSnapshot[] }>((resolve) => {
          expect(signal.aborted).toBe(false);
          release = resolve;
        }),
    );
    const ingest = vi.fn();
    const feed = new IssueFeed(fetch, ingest);
    const pending = feed.load();
    feed.stop();
    release({ issues: [issue(1)] });
    await pending;
    expect(ingest).not.toHaveBeenCalled();
    expect(feed.snapshot().ids.size).toBe(0);
    expect(fetch.mock.calls[0]![1].aborted).toBe(true);
  });
});
