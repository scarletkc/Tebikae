import { expect, test, type Page } from '@playwright/test';
import { connect, mockGitHub, mockIssue } from './fixtures';

async function queued(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ status: string; retryAt?: string }[]>((resolve, reject) => {
        const request = indexedDB.open('tebikae');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('outbox');
          const all = transaction.objectStore('outbox').getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve(all.result);
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
  );
}

test('server cooldown survives reload and resumes pending changes automatically', async ({
  page,
  context,
}) => {
  const state = await mockGitHub(context, [mockIssue(81, 'Durable retry')]);
  await page.clock.install();
  await connect(page);
  let limited = false;
  await context.route('https://api.github.com/repos/scarletkc/Tebikae-dev/issues/81', async (route) => {
    if (route.request().method() === 'GET' && !limited) {
      limited = true;
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: {
          'retry-after': '90',
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'retry-after',
        },
        body: '{"message":"Rate limited"}',
      });
    }
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Edit note: Durable retry', exact: true }).click();
  await page.getByRole('button', { name: 'Sage', exact: true }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(async () => (await queued(page))[0]?.retryAt).toBeTruthy();
  const deadline = (await queued(page))[0]!.retryAt;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect((await queued(page))[0]?.retryAt).toBe(deadline);
  expect(state.writes).toHaveLength(0);
  await page.clock.fastForward(91_000);
  await expect.poll(async () => (await queued(page)).length).toBe(0);
  expect(state.writes.filter((write) => write.method === 'PATCH')).toHaveLength(1);
  expect(state.issues[0]!.body).toContain('"color":"green"');
});

test('transient preflight failures retry without another user action', async ({ page, context }) => {
  const state = await mockGitHub(context, [mockIssue(82, 'Temporary failure')]);
  await page.clock.install();
  await connect(page);
  let failed = false;
  await context.route('https://api.github.com/repos/scarletkc/Tebikae-dev/issues/82', async (route) => {
    if (route.request().method() === 'GET' && !failed) {
      failed = true;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"Unavailable"}',
      });
    }
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Edit note: Temporary failure', exact: true }).click();
  await page.getByRole('button', { name: 'Sage', exact: true }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(async () => (await queued(page))[0]?.retryAt).toBeTruthy();
  expect(state.writes).toHaveLength(0);
  await page.clock.fastForward(7_000);
  await expect.poll(async () => (await queued(page)).length).toBe(0);
  expect(state.writes.filter((write) => write.method === 'PATCH')).toHaveLength(1);
});
