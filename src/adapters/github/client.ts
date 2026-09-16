import { z } from 'zod';
import type {
  ApiFailure,
  ApiFailureCode,
  Connection,
  HttpCacheEntry,
  Label,
  RawIssueSnapshot,
} from '../../domain/types';
import type { Credential, CredentialProvider } from '../../security/credentials';
import { parseRepository } from '../../security/urls';

export const GITHUB_API_VERSION = '2026-03-10';
export const GITHUB_API_ORIGIN = 'https://api.github.com';
const accept = 'application/vnd.github+json';
export class ApiError extends Error {
  readonly code: ApiFailureCode;
  constructor(public readonly failure: ApiFailure) {
    super(failure.code);
    this.name = 'ApiError';
    this.code = failure.code;
  }
}
export function asApiFailure(error: unknown): ApiFailure {
  return error instanceof ApiError ? error.failure : { code: 'SERVER_ERROR' };
}

export interface HttpCache {
  get(scopeId: string, url: string): Promise<HttpCacheEntry | undefined>;
  /** Check inside the write transaction before committing; a thrown error must roll back the write. */
  put(entry: HttpCacheEntry, checkActive: () => void): Promise<unknown>;
}
export interface GitHubClientOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  writeIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  cache?: HttpCache;
}
export interface IssueCreate {
  title: string;
  body: string;
  labels?: string[];
}
export interface IssueUpdate {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
}
type RequestResult = { data: unknown; link: string | null };
const labelSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  color: z.string(),
  description: z.string().nullable().optional(),
});
const issueSchema = z.object({
  id: z.number().int().positive(),
  node_id: z.string(),
  number: z.number().int().positive(),
  html_url: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(['open', 'closed']),
  state_reason: z.string().nullable().optional(),
  labels: z.array(labelSchema),
  created_at: z.string(),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
});

function mapLabel(value: unknown): Label {
  const label = labelSchema.safeParse(value);
  if (!label.success) throw new ApiError({ code: 'SERVER_ERROR', detail: 'Invalid label response' });
  return { ...label.data, description: label.data.description ?? null };
}
export function mapIssue(value: unknown): RawIssueSnapshot {
  const result = issueSchema.safeParse(value);
  if (!result.success || result.data.pull_request !== undefined)
    throw new ApiError({ code: 'SERVER_ERROR', detail: 'Invalid issue response' });
  const data = result.data;
  return {
    id: data.id,
    nodeId: data.node_id,
    number: data.number,
    url: data.html_url,
    title: data.title,
    body: data.body ?? '',
    state: data.state,
    stateReason: data.state_reason ?? null,
    labels: data.labels.map(mapLabel),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/** Pagination is constrained to the original resource, never an arbitrary authenticated URL. */
export function nextPage(link: string | null, endpoint: string): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(/,(?=\s*<)/u)) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/u.exec(part);
    if (!match || !match[2]!.split(/\s+/u).includes('next')) continue;
    let url: URL;
    try {
      url = new URL(match[1]!);
    } catch {
      throw new ApiError({ code: 'SERVER_ERROR', detail: 'Invalid pagination URL' });
    }
    if (
      url.origin !== GITHUB_API_ORIGIN ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== endpoint
    )
      throw new ApiError({ code: 'SERVER_ERROR', detail: 'Untrusted pagination URL' });
    return url.href;
  }
  return undefined;
}

function rateFailure(response: Response, now: number, fallbackDelay: number): ApiFailure {
  const status = response.status;
  const retry = response.headers.get('retry-after');
  const remaining = response.headers.get('x-ratelimit-remaining');
  const requestId = response.headers
    .get('x-github-request-id')
    ?.replace(/[^a-z\d:-]/giu, '')
    .slice(0, 128);
  const limited = status === 429 || (status === 403 && (retry !== null || remaining === '0'));
  const failure: ApiFailure = {
    code: limited
      ? 'RATE_LIMITED'
      : status === 401
        ? 'AUTH_REQUIRED'
        : status === 403
          ? 'FORBIDDEN'
          : status === 404
            ? 'NOT_FOUND_OR_INACCESSIBLE'
            : status === 400 || status === 422
              ? 'VALIDATION_FAILED'
              : 'SERVER_ERROR',
    status,
  };
  if (requestId) failure.requestId = requestId;
  if (limited) {
    const seconds = retry !== null && /^\d+(?:\.\d+)?$/u.test(retry.trim()) ? Number(retry) : NaN;
    const retryDate = retry ? Date.parse(retry) : NaN;
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1_000;
    const retryAt = Number.isFinite(seconds)
      ? now + seconds * 1_000
      : Number.isFinite(retryDate) && retryDate > now
        ? retryDate
        : remaining === '0' && reset > now
          ? reset
          : now + fallbackDelay;
    failure.retryAt = new Date(Math.max(now + 1_000, retryAt)).toISOString();
  }
  return failure;
}

export class GitHubClient {
  readonly #credential: () => Credential | null;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeout: number;
  readonly #writeInterval: number;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #cache?: HttpCache;
  readonly #memoryCache = new Map<string, HttpCacheEntry>();
  readonly #connectionGenerations = new WeakMap<Connection, number>();
  #tail: Promise<void> = Promise.resolve();
  #lastWrite = -Infinity;
  #blockedUntil = 0;
  #secondaryDelay = 60_000;
  #sessionGeneration: number | undefined;
  pollIntervalMs = 60_000;

  constructor(
    credentials: (() => Credential | null) | Pick<CredentialProvider, 'get'>,
    options: GitHubClientOptions = {},
  ) {
    this.#credential = typeof credentials === 'function' ? credentials : credentials.get;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeout = options.timeoutMs ?? 20_000;
    this.#writeInterval = options.writeIntervalMs ?? 1_000;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#cache = options.cache;
  }

  #path(connection: Connection): string {
    const generation = this.#connectionGenerations.get(connection);
    if (generation !== undefined && generation !== this.#credential()?.generation)
      throw new ApiError({ code: 'SESSION_EXPIRED' });
    return `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}`;
  }
  #issuePath(connection: Connection, number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) throw new ApiError({ code: 'VALIDATION_FAILED' });
    return `${this.#path(connection)}/issues/${number}`;
  }
  #checkSession(credential: Credential): void {
    const current = this.#credential();
    if (!current || current.generation !== credential.generation || current.token !== credential.token)
      throw new ApiError({ code: 'SESSION_EXPIRED' });
  }
  async #request(
    method: string,
    path: string,
    scopeId: string,
    payload?: unknown,
    signal?: AbortSignal,
  ): Promise<RequestResult> {
    const credential = this.#credential();
    if (!credential) throw new ApiError({ code: 'AUTH_REQUIRED' });
    const url = new URL(path, GITHUB_API_ORIGIN);
    if (url.origin !== GITHUB_API_ORIGIN || url.username || url.password || url.hash)
      throw new ApiError({ code: 'VALIDATION_FAILED' });
    const run = async (): Promise<RequestResult> => {
      this.#checkSession(credential);
      if (this.#sessionGeneration !== credential.generation) {
        this.#memoryCache.clear();
        this.#blockedUntil = 0;
        this.#secondaryDelay = 60_000;
        this.#sessionGeneration = credential.generation;
      }
      if (signal?.aborted) throw new ApiError({ code: 'NETWORK_UNCERTAIN' });
      if (this.#blockedUntil > this.#now())
        throw new ApiError({ code: 'RATE_LIMITED', retryAt: new Date(this.#blockedUntil).toISOString() });
      const write = method !== 'GET';
      if (write) {
        const delay = this.#lastWrite + this.#writeInterval - this.#now();
        if (delay > 0) await this.#sleep(delay);
        this.#checkSession(credential);
        if (signal?.aborted) throw new ApiError({ code: 'NETWORK_UNCERTAIN' });
      }
      const cacheKey = `${scopeId}\n${url.href}`;
      const persistentCache = scopeId.startsWith('github.com:') ? this.#cache : undefined;
      let cached: HttpCacheEntry | undefined;
      if (!write) {
        try {
          cached = persistentCache
            ? await persistentCache.get(scopeId, url.href)
            : this.#memoryCache.get(cacheKey);
        } catch {
          /* A cache failure must not block authenticated network reads. */
        }
        if (cached?.accept !== accept || cached.apiVersion !== GITHUB_API_VERSION) cached = undefined;
      }
      this.#checkSession(credential);
      // Cache reads may yield before the fetch abort listener is registered.
      if (signal?.aborted) throw new ApiError({ code: 'NETWORK_UNCERTAIN' });
      const headers: Record<string, string> = {
        Accept: accept,
        Authorization: `Bearer ${credential.token}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      };
      if (payload !== undefined) headers['Content-Type'] = 'application/json';
      if (cached) headers['If-None-Match'] = cached.etag;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const checkActive = () => {
        this.#checkSession(credential);
        if (controller.signal.aborted) throw new ApiError({ code: 'NETWORK_UNCERTAIN' });
      };
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, this.#timeout);
      try {
        if (write) this.#lastWrite = this.#now();
        const response = await this.#fetch(url.href, {
          method,
          headers,
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
        });
        checkActive();
        const poll = Number(response.headers.get('x-poll-interval'));
        if (poll > 0) this.pollIntervalMs = Math.max(60_000, poll * 1_000);
        if (response.status === 304 && cached)
          return { data: structuredClone(cached.response), link: cached.link };
        if (!response.ok) {
          let failure = rateFailure(response, this.#now(), this.#secondaryDelay);
          // Secondary limits can arrive without exposed rate-limit headers; inspect only the message and never persist it.
          if (response.status === 403 && failure.code === 'FORBIDDEN') {
            const errorData = (await response.json().catch(() => null)) as { message?: unknown } | null;
            checkActive();
            if (
              typeof errorData?.message === 'string' &&
              /(?:secondary rate|rate limit|abuse detection)/iu.test(errorData.message)
            ) {
              failure = {
                ...failure,
                code: 'RATE_LIMITED',
                retryAt: new Date(this.#now() + this.#secondaryDelay).toISOString(),
              };
            }
          }
          if (failure.code === 'RATE_LIMITED') {
            this.#blockedUntil = Date.parse(failure.retryAt!);
            this.#secondaryDelay = Math.min(this.#secondaryDelay * 2, 3_600_000);
          }
          throw new ApiError(failure);
        }
        const data: unknown = response.status === 204 ? null : await response.json();
        checkActive();
        // The network deadline covers receiving and parsing, not optional local storage.
        // Caller cancellation and session checks remain active until the request returns.
        clearTimeout(timer);
        this.#secondaryDelay = 60_000;
        const link = response.headers.get('link');
        const etag = response.headers.get('etag');
        if (!write && etag) {
          const entry: HttpCacheEntry = {
            scopeId,
            url: url.href,
            accept,
            apiVersion: GITHUB_API_VERSION,
            etag,
            response: data,
            link,
          };
          try {
            if (persistentCache) await persistentCache.put(entry, checkActive);
          } catch {
            /* Offline note persistence is separate from optional HTTP caching. */
          }
          checkActive();
          this.#memoryCache.set(cacheKey, entry);
        }
        return { data, link };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        this.#checkSession(credential);
        throw new ApiError({ code: 'NETWORK_UNCERTAIN' });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    };
    const pending = this.#tail.then(run, run);
    this.#tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async connect(repository: string, signal?: AbortSignal): Promise<Connection> {
    const session = this.#credential();
    if (!session) throw new ApiError({ code: 'AUTH_REQUIRED' });
    let parsed: ReturnType<typeof parseRepository>;
    try {
      parsed = parseRepository(repository);
    } catch {
      throw new ApiError({ code: 'VALIDATION_FAILED' });
    }
    const viewer = z
      .object({ id: z.number().int().positive(), login: z.string() })
      .safeParse((await this.#request('GET', '/user', 'identity', undefined, signal)).data);
    this.#checkSession(session);
    if (!viewer.success) throw new ApiError({ code: 'SERVER_ERROR' });
    const result = z
      .object({
        id: z.number().int().positive(),
        name: z.string(),
        owner: z.object({ id: z.number(), login: z.string(), type: z.string().optional() }),
        private: z.boolean(),
        archived: z.boolean(),
        has_issues: z.boolean(),
        permissions: z.object({ push: z.boolean().optional() }).optional(),
      })
      .safeParse(
        (
          await this.#request(
            'GET',
            `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
            `viewer:${viewer.data.id}`,
            undefined,
            signal,
          )
        ).data,
      );
    this.#checkSession(session);
    if (!result.success) throw new ApiError({ code: 'SERVER_ERROR' });
    const repo = result.data;
    if (!repo.private) throw new ApiError({ code: 'PRIVATE_REQUIRED' });
    if (repo.owner.id !== viewer.data.id || repo.owner.type === 'Organization')
      throw new ApiError({ code: 'OWNER_REQUIRED' });
    if (!repo.has_issues) throw new ApiError({ code: 'ISSUES_DISABLED' });
    if (repo.archived) throw new ApiError({ code: 'ARCHIVED_REPOSITORY' });
    const connection: Connection = {
      scopeId: `github.com:${viewer.data.id}:${repo.id}`,
      viewerId: viewer.data.id,
      login: viewer.data.login,
      repoId: repo.id,
      owner: repo.owner.login,
      repo: repo.name,
      lastConnectedAt: new Date(this.#now()).toISOString(),
      readOnly: repo.permissions?.push === false,
    };
    this.#connectionGenerations.set(connection, session.generation);
    await this.#request(
      'GET',
      `${this.#path(connection)}/issues?state=all&per_page=1`,
      connection.scopeId,
      undefined,
      signal,
    );
    this.#checkSession(session);
    return connection;
  }

  async getAnchor(connection: Connection, signal?: AbortSignal): Promise<string | undefined> {
    const { data } = await this.#request(
      'GET',
      `${this.#path(connection)}/issues?state=all&sort=updated&direction=desc&per_page=1`,
      connection.scopeId,
      undefined,
      signal,
    );
    if (!Array.isArray(data)) throw new ApiError({ code: 'SERVER_ERROR' });
    const first = data[0] as { updated_at?: unknown } | undefined;
    return typeof first?.updated_at === 'string' && Number.isFinite(Date.parse(first.updated_at))
      ? first.updated_at
      : undefined;
  }
  async *listIssues(
    connection: Connection,
    options: { since?: string; signal?: AbortSignal } = {},
  ): AsyncGenerator<RawIssueSnapshot[]> {
    const session = this.#credential();
    if (!session) throw new ApiError({ code: 'AUTH_REQUIRED' });
    const endpoint = `${this.#path(connection)}/issues`;
    const query = new URLSearchParams({ state: 'all', sort: 'created', direction: 'asc', per_page: '100' });
    if (options.since) query.set('since', options.since);
    let url: string | undefined = `${GITHUB_API_ORIGIN}${endpoint}?${query}`;
    const seenPages = new Set<string>(),
      seenIssues = new Set<number>();
    while (url) {
      this.#checkSession(session);
      if (seenPages.has(url)) throw new ApiError({ code: 'SERVER_ERROR', detail: 'Repeated pagination URL' });
      seenPages.add(url);
      const { data, link } = await this.#request('GET', url, connection.scopeId, undefined, options.signal);
      if (!Array.isArray(data)) throw new ApiError({ code: 'SERVER_ERROR' });
      const issues: RawIssueSnapshot[] = [];
      for (const item of data as unknown[]) {
        if (typeof item === 'object' && item !== null && 'pull_request' in item) continue;
        const issue = mapIssue(item);
        if (!seenIssues.has(issue.id)) {
          issues.push(issue);
          seenIssues.add(issue.id);
        }
      }
      yield issues;
      url = nextPage(link, endpoint);
    }
  }
  async getIssue(connection: Connection, number: number, signal?: AbortSignal): Promise<RawIssueSnapshot> {
    return mapIssue(
      (await this.#request('GET', this.#issuePath(connection, number), connection.scopeId, undefined, signal))
        .data,
    );
  }
  async createIssue(
    connection: Connection,
    payload: IssueCreate,
    signal?: AbortSignal,
  ): Promise<RawIssueSnapshot> {
    return mapIssue(
      (
        await this.#request(
          'POST',
          `${this.#path(connection)}/issues`,
          connection.scopeId,
          { title: payload.title, body: payload.body, ...(payload.labels ? { labels: payload.labels } : {}) },
          signal,
        )
      ).data,
    );
  }
  async updateIssue(
    connection: Connection,
    number: number,
    payload: IssueUpdate,
    signal?: AbortSignal,
  ): Promise<RawIssueSnapshot> {
    const allowed: IssueUpdate = {};
    for (const key of ['title', 'body', 'state', 'state_reason'] as const)
      if (payload[key] !== undefined)
        Object.defineProperty(allowed, key, { value: payload[key], enumerable: true });
    return mapIssue(
      (await this.#request('PATCH', this.#issuePath(connection, number), connection.scopeId, allowed, signal))
        .data,
    );
  }
  async listLabels(connection: Connection, signal?: AbortSignal): Promise<Label[]> {
    const session = this.#credential();
    if (!session) throw new ApiError({ code: 'AUTH_REQUIRED' });
    const endpoint = `${this.#path(connection)}/labels`,
      labels = new Map<number, Label>(),
      seen = new Set<string>();
    let url: string | undefined = `${GITHUB_API_ORIGIN}${endpoint}?per_page=100`;
    while (url) {
      this.#checkSession(session);
      if (seen.has(url)) throw new ApiError({ code: 'SERVER_ERROR' });
      seen.add(url);
      const { data, link } = await this.#request('GET', url, connection.scopeId, undefined, signal);
      if (!Array.isArray(data)) throw new ApiError({ code: 'SERVER_ERROR' });
      for (const item of data as unknown[]) {
        const label = mapLabel(item);
        labels.set(label.id, label);
      }
      url = nextPage(link, endpoint);
    }
    return [...labels.values()];
  }
  async createLabel(
    connection: Connection,
    payload: { name: string; color?: string; description?: string },
    signal?: AbortSignal,
  ): Promise<Label> {
    return mapLabel(
      (
        await this.#request(
          'POST',
          `${this.#path(connection)}/labels`,
          connection.scopeId,
          {
            name: payload.name,
            color: payload.color ?? '6b7280',
            ...(payload.description === undefined ? {} : { description: payload.description }),
          },
          signal,
        )
      ).data,
    );
  }
  async addLabels(
    connection: Connection,
    number: number,
    labels: string[],
    signal?: AbortSignal,
  ): Promise<Label[]> {
    const { data } = await this.#request(
      'POST',
      `${this.#issuePath(connection, number)}/labels`,
      connection.scopeId,
      { labels },
      signal,
    );
    if (!Array.isArray(data)) throw new ApiError({ code: 'SERVER_ERROR' });
    return (data as unknown[]).map(mapLabel);
  }
  async removeLabel(
    connection: Connection,
    number: number,
    name: string,
    signal?: AbortSignal,
  ): Promise<Label[]> {
    const { data } = await this.#request(
      'DELETE',
      `${this.#issuePath(connection, number)}/labels/${encodeURIComponent(name)}`,
      connection.scopeId,
      undefined,
      signal,
    );
    if (data === null) return [];
    if (!Array.isArray(data)) throw new ApiError({ code: 'SERVER_ERROR' });
    return (data as unknown[]).map(mapLabel);
  }
}
