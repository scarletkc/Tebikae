import { GITHUB_API_VERSION, type HttpCache } from '../adapters/github/client';
import { db, type TebikaeDB } from './db';

export function createHttpCache(database: TebikaeDB = db): HttpCache {
  return {
    get: (scopeId, url) =>
      database.httpCache.get([scopeId, url, 'application/vnd.github+json', GITHUB_API_VERSION]),
    put: (entry, checkActive) =>
      database.transaction('rw', database.httpCache, async () => {
        checkActive();
        await database.httpCache.put(entry);
        // This is the publication boundary: cancellation/session changes observed here
        // abort the transaction, restoring any previous entry. Cancellation after this
        // commit decision may reject the caller but does not revoke a valid cached response.
        checkActive();
      }),
  };
}
