// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, GITHUB_API_VERSION } from '../src/adapters/github/client';
import type { HttpCacheEntry } from '../src/domain/types';
import { createHttpCache } from '../src/storage/http-cache';
import { TebikaeDB } from '../src/storage/db';

let database: TebikaeDB;
const entry: HttpCacheEntry = {
  scopeId: 'github.com:1:2',
  url: 'https://api.github.com/repos/owner/notes/issues/1',
  accept: 'application/vnd.github+json',
  apiVersion: GITHUB_API_VERSION,
  etag: 'new',
  response: { title: 'New response' },
  link: null,
};
beforeEach(() => {
  database = new TebikaeDB(`http-cache-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

describe('transactional HTTP cache publication', () => {
  it.each(['NETWORK_UNCERTAIN', 'SESSION_EXPIRED'] as const)(
    'rolls back a replacement when %s occurs while the write is pending',
    async (code) => {
      const cache = createHttpCache(database);
      const old = { ...entry, etag: 'old', response: { title: 'Previously valid response' } };
      await cache.put(old, () => {});
      const put = database.httpCache.put.bind(database.httpCache);
      let active = true;
      vi.spyOn(database.httpCache, 'put').mockImplementationOnce((value) =>
        put(value).then((key) => {
          active = false;
          return key;
        }),
      );
      await expect(
        cache.put(entry, () => {
          if (!active) throw new ApiError({ code });
        }),
      ).rejects.toMatchObject({ code });
      expect(await cache.get(entry.scopeId, entry.url)).toEqual(old);
    },
  );

  it('leaves no new entry when cancellation is detected before commit', async () => {
    const cache = createHttpCache(database);
    const check = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementation(() => {
        throw new ApiError({ code: 'NETWORK_UNCERTAIN' });
      });
    await expect(cache.put(entry, check)).rejects.toMatchObject({ code: 'NETWORK_UNCERTAIN' });
    expect(check).toHaveBeenCalledTimes(2);
    expect(await cache.get(entry.scopeId, entry.url)).toBeUndefined();
  });

  it('does not start a write if the caller is already inactive', async () => {
    const put = vi.spyOn(database.httpCache, 'put');
    await expect(
      createHttpCache(database).put(entry, () => {
        throw new ApiError({ code: 'SESSION_EXPIRED' });
      }),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps a valid committed entry if the caller later cancels', async () => {
    const cache = createHttpCache(database);
    const controller = new AbortController();
    await cache.put(entry, () => controller.signal.throwIfAborted());
    controller.abort();
    expect(await cache.get(entry.scopeId, entry.url)).toEqual(entry);
    expect(await cache.get('github.com:2:2', entry.url)).toBeUndefined();
  });
});
