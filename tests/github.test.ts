// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ApiError, GitHubClient, GITHUB_API_VERSION, nextPage } from '../src/adapters/github/client';
import { CredentialProvider } from '../src/security/credentials';
import type { Connection, HttpCacheEntry } from '../src/domain/types';

const origin = 'https://api.github.com';
const issuePath = '/repos/scarletkc/Tebikae-dev/issues';
const connection: Connection = {
  scopeId: 'github.com:1:2',
  viewerId: 1,
  login: 'scarletkc',
  repoId: 2,
  owner: 'scarletkc',
  repo: 'Tebikae-dev',
  lastConnectedAt: '2026-09-16T00:00:00Z',
};
const issue = (number = 1) => ({
  id: 100 + number,
  number,
  node_id: `I_${number}`,
  html_url: `https://github.com/scarletkc/Tebikae-dev/issues/${number}`,
  title: `Note ${number}`,
  body: 'body',
  state: 'open',
  labels: [],
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-16T00:00:00Z',
});
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());
function client(options: ConstructorParameters<typeof GitHubClient>[1] = {}) {
  const credentials = new CredentialProvider();
  credentials.set('test-token-runtime-only');
  return { credentials, api: new GitHubClient(credentials, { writeIntervalMs: 0, ...options }) };
}

describe('GitHub adapter', () => {
  it('deletes an Issue through GraphQL using its node ID, never REST DELETE or close', async () => {
    const requests: unknown[] = [];
    server.use(
      http.post(`${origin}/graphql`, async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ data: { deleteIssue: { clientMutationId: null } } });
      }),
    );
    await client().api.deleteIssue(connection, 'I_1');
    expect(requests).toEqual([
      {
        query: expect.stringContaining('deleteIssue(input: $input)'),
        variables: { input: { issueId: 'I_1' } },
      },
    ]);
  });

  it.each([
    [
      { errors: [{ type: 'FORBIDDEN', message: 'private diagnostics' }], data: { deleteIssue: null } },
      'FORBIDDEN',
    ],
    [{ errors: [{ type: 'NOT_FOUND' }] }, 'NOT_FOUND_OR_INACCESSIBLE'],
    [{ errors: [{ type: 'RATE_LIMITED' }] }, 'RATE_LIMITED'],
    [
      { errors: [{ message: 'private diagnostics' }], data: { deleteIssue: { clientMutationId: null } } },
      'SERVER_ERROR',
    ],
    [{ data: { deleteIssue: null } }, 'SERVER_ERROR'],
    [{}, 'SERVER_ERROR'],
  ])('rejects unsuccessful HTTP 200 GraphQL deletion responses %o', async (body, code) => {
    server.use(http.post(`${origin}/graphql`, () => HttpResponse.json(body)));
    const failure = await client()
      .api.deleteIssue(connection, 'I_1')
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code });
    expect(JSON.stringify(failure)).not.toContain('private diagnostics');
  });

  it('rejects read-only and empty node ID deletions without dispatch', async () => {
    const fetch = vi.fn();
    const { api } = client({ fetch });
    await expect(api.deleteIssue({ ...connection, readOnly: true }, 'I_1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(api.deleteIssue(connection, '')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('connects using only GET, scope identity, the explicit API version, and no cookie/referrer credentials', async () => {
    const calls: string[] = [];
    server.use(
      http.get(`${origin}/user`, ({ request }) => {
        calls.push(request.method);
        expect(request.headers.get('authorization')).toBe('Bearer test-token-runtime-only');
        expect(request.headers.get('x-github-api-version')).toBe(GITHUB_API_VERSION);
        expect(request.headers.has('content-type')).toBe(false);
        expect(request.credentials).toBe('omit');
        return HttpResponse.json({ id: 1, login: 'scarletkc' });
      }),
      http.get(`${origin}/repos/scarletkc/Tebikae-dev`, () => {
        calls.push('GET');
        return HttpResponse.json({
          id: 2,
          name: 'Tebikae-dev',
          owner: { id: 1, login: 'scarletkc', type: 'User' },
          private: true,
          archived: false,
          has_issues: true,
          permissions: { push: true },
        });
      }),
      http.get(`${origin}${issuePath}`, () => {
        calls.push('GET');
        return HttpResponse.json([]);
      }),
    );
    const { api } = client();
    const result = await api.connect('scarletkc/Tebikae-dev');
    expect(result.scopeId).toBe('github.com:1:2');
    expect(result.readOnly).toBe(false);
    expect(calls).toEqual(['GET', 'GET', 'GET']);
  });
  it.each([
    [{ private: false }, 'PRIVATE_REQUIRED'],
    [{ archived: true }, 'ARCHIVED_REPOSITORY'],
    [{ has_issues: false }, 'ISSUES_DISABLED'],
    [{ owner: { id: 9, login: 'other' } }, 'OWNER_REQUIRED'],
  ])('rejects unsupported repository settings %o', async (patch, code) => {
    server.use(
      http.get(`${origin}/user`, () => HttpResponse.json({ id: 1, login: 'scarletkc' })),
      http.get(`${origin}/repos/scarletkc/Tebikae-dev`, () =>
        HttpResponse.json({
          id: 2,
          name: 'Tebikae-dev',
          owner: { id: 1, login: 'scarletkc' },
          private: true,
          archived: false,
          has_issues: true,
          ...patch,
        }),
      ),
    );
    await expect(client().api.connect('scarletkc/Tebikae-dev')).rejects.toMatchObject({ code });
  });
  it('follows every page on a 304 first page, filters PRs, and deduplicates issue identities', async () => {
    let firstReads = 0,
      secondReads = 0;
    const link = `<${origin}${issuePath}?page=2>; rel="next"`;
    server.use(
      http.get(`${origin}${issuePath}`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('page') === '2') {
          secondReads++;
          return HttpResponse.json([issue(1), issue(2)], { headers: { etag: '"second"' } });
        }
        firstReads++;
        expect(url.searchParams.get('sort')).toBe('created');
        expect(url.searchParams.get('direction')).toBe('asc');
        expect(url.searchParams.get('state')).toBe('all');
        if (request.headers.get('if-none-match')) return new HttpResponse(null, { status: 304 });
        return HttpResponse.json([issue(1), { ...issue(3), pull_request: {} }], {
          headers: { etag: '"first"', link },
        });
      }),
    );
    const { api } = client();
    for (let run = 0; run < 2; run++) {
      const pages = [];
      for await (const page of api.listIssues(connection)) pages.push(...page);
      expect(pages.map((item) => item.number)).toEqual([1, 2]);
    }
    expect(firstReads).toBe(2);
    expect(secondReads).toBe(2);
  });
  it('uses a separate beginning-of-pull anchor and passes the caller overlap since timestamp', async () => {
    const calls: string[] = [];
    server.use(
      http.get(`${origin}${issuePath}`, ({ request }) => {
        calls.push(request.url);
        return HttpResponse.json([issue()]);
      }),
    );
    const { api } = client();
    expect(await api.getAnchor(connection)).toBe('2026-09-16T00:00:00Z');
    for await (const _page of api.listIssues(connection, { since: '2026-09-15T23:59:00Z' })) {
      /* iterate */
    }
    expect(calls[0]).toContain('sort=updated&direction=desc&per_page=1');
    expect(new URL(calls[1]!).searchParams.get('since')).toBe('2026-09-15T23:59:00Z');
  });
  it.each([
    'https://evil.example/repos/scarletkc/Tebikae-dev/issues?page=2',
    'https://api.github.com/user?page=2',
    'https://token@api.github.com/repos/scarletkc/Tebikae-dev/issues?page=2',
  ])('does not follow untrusted pagination %s', (url) => {
    expect(() => nextPage(`<${url}>; rel="next"`, issuePath)).toThrow(ApiError);
  });
  it('never includes labels in a body PATCH and encodes label path components', async () => {
    let patch: unknown;
    server.use(
      http.patch(`${origin}${issuePath}/1`, async ({ request }) => {
        patch = await request.json();
        return HttpResponse.json(issue());
      }),
      http.delete(`${origin}${issuePath}/1/labels/:label`, ({ request }) => {
        expect(request.url).toContain('/labels/space%20%2F%20slash');
        return HttpResponse.json([]);
      }),
    );
    const { api } = client();
    await api.updateIssue(connection, 1, { body: 'new', labels: ['stale'] } as Parameters<
      GitHubClient['updateIssue']
    >[2]);
    await api.removeLabel(connection, 1, 'space / slash');
    expect(patch).toEqual({ body: 'new' });
  });
  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND_OR_INACCESSIBLE'],
    [422, 'VALIDATION_FAILED'],
    [500, 'SERVER_ERROR'],
  ])('maps HTTP %i without leaking private diagnostics', async (status, code) => {
    server.use(
      http.get(`${origin}${issuePath}/1`, () =>
        HttpResponse.json(
          { message: 'private note body and test-token-runtime-only' },
          { status: status as number, headers: { 'x-github-request-id': 'REQUEST:123' } },
        ),
      ),
    );
    const failure = await client()
      .api.getIssue(connection, 1)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code, failure: { requestId: 'REQUEST:123' } });
    expect(JSON.stringify(failure)).not.toContain('test-token');
    expect(JSON.stringify(failure)).not.toContain('private note');
  });
  it('honors Retry-After and blocks reads and writes during a rate-limit pause', async () => {
    let requests = 0;
    server.use(
      http.get(`${origin}${issuePath}/1`, () => {
        requests++;
        return HttpResponse.json({}, { status: 429, headers: { 'retry-after': '90' } });
      }),
    );
    const now = Date.parse('2026-09-16T00:00:00Z');
    const { api } = client({ now: () => now });
    await expect(api.getIssue(connection, 1)).rejects.toMatchObject({
      failure: { code: 'RATE_LIMITED', retryAt: '2026-09-16T00:01:30.000Z' },
    });
    await expect(api.createIssue(connection, { title: 'New', body: 'body' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(requests).toBe(1);
  });
  it('recognizes secondary limits with missing CORS headers and primary reset timestamps', async () => {
    const now = Date.parse('2026-09-16T00:00:00Z');
    server.use(
      http.get(`${origin}${issuePath}/1`, () =>
        HttpResponse.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403 }),
      ),
    );
    await expect(client({ now: () => now }).api.getIssue(connection, 1)).rejects.toMatchObject({
      failure: { code: 'RATE_LIMITED', retryAt: '2026-09-16T00:01:00.000Z' },
    });
    server.use(
      http.get(`${origin}${issuePath}/1`, () =>
        HttpResponse.json(
          {},
          {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 180) },
          },
        ),
      ),
    );
    await expect(client({ now: () => now }).api.getIssue(connection, 1)).rejects.toMatchObject({
      failure: { code: 'RATE_LIMITED', retryAt: '2026-09-16T00:03:00.000Z' },
    });
  });
  it('serializes all requests and spaces real writes by one second', async () => {
    let now = 0,
      active = 0,
      maximum = 0;
    const starts: number[] = [];
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      active++;
      maximum = Math.max(maximum, active);
      if (init?.method !== 'GET') starts.push(now);
      await Promise.resolve();
      active--;
      return new Response(JSON.stringify(issue()), { status: 200 });
    });
    const { api } = client({
      fetch: fakeFetch as typeof fetch,
      writeIntervalMs: 1000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await Promise.all([
      api.createIssue(connection, { title: 'a', body: 'a' }),
      api.getIssue(connection, 1),
      api.updateIssue(connection, 1, { body: 'b' }),
    ]);
    expect(maximum).toBe(1);
    expect(starts).toEqual([0, 1000]);
  });
  it('reports uncertain creation once after response loss and never automatically retries', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new TypeError('response lost');
    });
    await expect(
      client({ fetch: fakeFetch }).api.createIssue(connection, { title: 'a', body: 'a' }),
    ).rejects.toMatchObject({ code: 'NETWORK_UNCERTAIN' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
  it('aborts timed-out writes as uncertain without losing their semantic distinction', async () => {
    const fakeFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
        }),
    );
    await expect(
      client({ fetch: fakeFetch, timeoutMs: 5 }).api.createIssue(connection, { title: 'a', body: 'a' }),
    ).rejects.toMatchObject({ code: 'NETWORK_UNCERTAIN' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch a read cancelled while its persistent cache is loading', async () => {
    const controller = new AbortController();
    let finishCache!: () => void;
    let cacheStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      cacheStarted = resolve;
    });
    const cache = {
      get: vi.fn(() => {
        cacheStarted();
        return new Promise<undefined>((resolve) => {
          finishCache = () => resolve(undefined);
        });
      }),
      put: vi.fn(async () => undefined),
    };
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify(issue())));
    const { api } = client({ cache, fetch: fakeFetch });
    const pending = api.getIssue(connection, 1, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'NETWORK_UNCERTAIN' });
    await started;
    controller.abort();
    finishCache();
    await rejected;
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('rejects a response that completes after cancellation and releases the request queue', async () => {
    const controller = new AbortController();
    const fakeFetch = vi.fn(async () => {
      controller.abort();
      return new Response(JSON.stringify(issue()), { headers: { etag: 'cancelled' } });
    });
    const cache = { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    const { api } = client({ cache, fetch: fakeFetch });
    await expect(api.getIssue(connection, 1, controller.signal)).rejects.toMatchObject({
      code: 'NETWORK_UNCERTAIN',
    });
    expect(cache.put).not.toHaveBeenCalled();
    expect((await api.getIssue(connection, 1)).number).toBe(1);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });
  it('does not cache a response cancelled while its body is being read', async () => {
    const controller = new AbortController();
    const response = new Response(null, { headers: { etag: 'cancelled-body' } });
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort();
      return issue();
    });
    const cache = { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    const { api } = client({ cache, fetch: vi.fn(async () => response) });
    await expect(api.getIssue(connection, 1, controller.signal)).rejects.toMatchObject({
      code: 'NETWORK_UNCERTAIN',
    });
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('treats a write response arriving after its timeout as uncertain without retrying', async () => {
    const fakeFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          init?.signal?.addEventListener('abort', () => resolve(new Response(JSON.stringify(issue()))));
        }),
    );
    await expect(
      client({ fetch: fakeFetch, timeoutMs: 5 }).api.createIssue(connection, { title: 'a', body: 'a' }),
    ).rejects.toMatchObject({ code: 'NETWORK_UNCERTAIN' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
  it('does not apply the network deadline to optional cache persistence', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    let started!: () => void;
    const persisting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cache = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {
        started();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }),
    };
    const { api } = client({
      cache,
      timeoutMs: 20,
      fetch: vi.fn(async () => new Response(JSON.stringify(issue()), { headers: { etag: 'valid' } })),
    });
    const pending = api.getIssue(connection, 1);
    const result = expect(pending).resolves.toMatchObject({ number: 1 });
    await persisting;
    await vi.advanceTimersByTimeAsync(100);
    finish();
    await result;
  });
  it('still enforces the network deadline while the response body is pending', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    let started!: () => void;
    const parsing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const response = new Response(null, { headers: { etag: 'late' } });
    vi.spyOn(response, 'json').mockImplementation(async () => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return issue();
    });
    const cache = { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    const { api } = client({ cache, timeoutMs: 20, fetch: vi.fn(async () => response) });
    const result = expect(api.getIssue(connection, 1)).rejects.toMatchObject({ code: 'NETWORK_UNCERTAIN' });
    await parsing;
    await vi.advanceTimersByTimeAsync(100);
    finish();
    await result;
    expect(cache.put).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'session'] as const)(
    'does not publish cache entries on %s during persistence',
    async (reason) => {
      const controller = new AbortController();
      let finish!: () => void;
      let started!: () => void;
      let published: HttpCacheEntry | undefined;
      const persisting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const cache = {
        get: vi.fn(async () => published),
        put: vi.fn(async (entry: HttpCacheEntry, checkActive?: () => void) => {
          started();
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          checkActive?.();
          published = entry;
        }),
      };
      const { api, credentials } = client({
        cache,
        fetch: vi.fn(async () => new Response(JSON.stringify(issue()), { headers: { etag: 'cancelled' } })),
      });
      const pending = api.getIssue(connection, 1, controller.signal);
      const result = expect(pending).rejects.toMatchObject({
        code: reason === 'cancel' ? 'NETWORK_UNCERTAIN' : 'SESSION_EXPIRED',
      });
      await persisting;
      if (reason === 'cancel') controller.abort();
      else credentials.set('replacement-token');
      finish();
      await result;
      expect(published).toBeUndefined();
    },
  );
  it('rejects old-session responses before writing cached data', async () => {
    let complete!: (response: Response) => void;
    const fetched = new Promise<void>((resolve) => {
      server.use(
        http.get(`${origin}${issuePath}/1`, () => {
          resolve();
          return new Promise<Response>((done) => {
            complete = done;
          });
        }),
      );
    });
    const cache = { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    const { api, credentials } = client({ cache });
    const pending = api.getIssue(connection, 1);
    await fetched;
    credentials.clear();
    credentials.set('another-user-token');
    complete(HttpResponse.json(issue(), { headers: { etag: 'old' } }));
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('stops an old paginated iterator after the credentials change between pages', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify([issue()]), {
          headers: { link: `<${origin}${issuePath}?page=2>; rel="next"` },
        }),
    );
    const { api, credentials } = client({ fetch: fakeFetch });
    const iterator = api.listIssues(connection);
    await iterator.next();
    credentials.set('different-user');
    await expect(iterator.next()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
  it('does not persist bootstrap identity responses before repository scope is known', async () => {
    server.use(
      http.get(`${origin}/user`, () =>
        HttpResponse.json({ id: 1, login: 'scarletkc' }, { headers: { etag: 'identity' } }),
      ),
      http.get(`${origin}/repos/scarletkc/Tebikae-dev`, () =>
        HttpResponse.json(
          {
            id: 2,
            name: 'Tebikae-dev',
            owner: { id: 1, login: 'scarletkc' },
            private: true,
            archived: false,
            has_issues: true,
          },
          { headers: { etag: 'repository' } },
        ),
      ),
      http.get(`${origin}${issuePath}`, () => HttpResponse.json([], { headers: { etag: 'issues' } })),
    );
    const cache = { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    const { api, credentials } = client({ cache });
    const connected = await api.connect('scarletkc/Tebikae-dev');
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: connected.scopeId }),
      expect.any(Function),
    );
    credentials.set('new-account');
    await expect(api.getIssue(connected, 1)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
  it('keeps a fresh account connection and its conditional cache separate from the previous actor', async () => {
    let actor = 1;
    server.use(
      http.get(`${origin}/user`, () => HttpResponse.json({ id: actor, login: `person${actor}` })),
      http.get(`${origin}/repos/:owner/notes`, ({ params }) =>
        HttpResponse.json({
          id: 100 + actor,
          name: 'notes',
          owner: { id: actor, login: params.owner },
          private: true,
          archived: false,
          has_issues: true,
        }),
      ),
      http.get(`${origin}/repos/:owner/notes/issues`, () => HttpResponse.json([])),
      http.get(`${origin}/repos/:owner/notes/issues/1`, ({ request }) => {
        expect(request.headers.has('if-none-match')).toBe(false);
        return HttpResponse.json(
          { ...issue(), title: `Private content for ${actor}` },
          { headers: { etag: `actor-${actor}` } },
        );
      }),
    );
    const cache = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async (_entry: { scopeId: string }) => undefined),
    };
    const { api, credentials } = client({ cache });
    const first = await api.connect('person1/notes');
    expect((await api.getIssue(first, 1)).title).toBe('Private content for 1');
    actor = 2;
    credentials.set('second-actor');
    const second = await api.connect('person2/notes');
    expect((await api.getIssue(second, 1)).title).toBe('Private content for 2');
    expect(first.scopeId).toBe('github.com:1:101');
    expect(second.scopeId).toBe('github.com:2:102');
    expect(cache.put.mock.calls.map(([entry]) => entry.scopeId)).toEqual([
      'github.com:1:101',
      'github.com:2:102',
    ]);
    await expect(api.getIssue(first, 1)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
