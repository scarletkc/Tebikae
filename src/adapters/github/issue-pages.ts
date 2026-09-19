import type { RawIssueSnapshot } from '../../domain/types';

export interface IssuePage {
  issues: RawIssueSnapshot[];
  next?: string;
}

export interface SearchPage extends IssuePage {
  total: number;
}

export interface SearchRange {
  from: number;
  to: number;
  page: number;
}

/** A retryable, lazy traversal. Split ranges are disjoint at GitHub's second precision. */
export class IssueSearchPages {
  private ranges: SearchRange[];
  private seen = new Set<number>();

  constructor(
    private readonly fetchPage: (range: SearchRange, signal: AbortSignal) => Promise<SearchPage>,
    until = Date.now(),
  ) {
    this.ranges = [{ from: 0, to: Math.floor(until / 1000), page: 1 }];
  }

  async next(signal: AbortSignal): Promise<IssuePage> {
    while (this.ranges.length) {
      signal.throwIfAborted();
      const range = this.ranges[0]!;
      const result = await this.fetchPage(range, signal);
      signal.throwIfAborted();
      if (result.total > 1000) {
        if (range.from === range.to)
          throw Object.assign(new Error('SEARCH_RANGE_TOO_DENSE'), {
            failure: { code: 'VALIDATION_FAILED', detail: 'SEARCH_RANGE_TOO_DENSE' },
          });
        const middle = Math.floor((range.from + range.to) / 2);
        this.ranges.splice(
          0,
          1,
          { from: middle + 1, to: range.to, page: 1 },
          { from: range.from, to: middle, page: 1 },
        );
        continue;
      }
      if (range.page * 100 < result.total) this.ranges[0] = { ...range, page: range.page + 1 };
      else this.ranges.shift();
      const issues = result.issues.filter((issue) => {
        if (this.seen.has(issue.id)) return false;
        this.seen.add(issue.id);
        return true;
      });
      return { issues, next: this.ranges.length ? 'more' : undefined };
    }
    return { issues: [] };
  }
}
