import { expect, test, type Page } from '@playwright/test';
import { connect, mockGitHub, mockIssue } from './fixtures';

const seed = () =>
  Array.from({ length: 230 }, (_, i) =>
    mockIssue(i + 1, `Paged note ${i + 1}`, `Unique-${i + 1}-end. ` + `Entry ${i + 1}. `.repeat(30)),
  );
const cachedCount = (page: Page) =>
  page.evaluate(async () => {
    const modulePath = '/src/storage/db.ts';
    const { db } = await import(/* @vite-ignore */ modulePath);
    return db.notes.count() as Promise<number>;
  });

test('an initial page without managed notes does not trigger a repository-wide scan', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(
    context,
    seed().map((issue) => ({ ...issue, body: 'An ordinary GitHub Issue.' })),
  );
  await connect(page);
  await expect(page.locator('.note-card')).toHaveCount(0);
  await expect(page.locator('.load-more')).toBeEnabled();
  await page.waitForTimeout(300);
  expect(
    remote.requests.filter(
      (request) =>
        request.path.endsWith('/issues') && new URL(request.url).searchParams.get('per_page') === '100',
    ),
  ).toHaveLength(1);
});

test('initial 100 are cached, 25 rendered, next 100 prefetched before reaching the bottom', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context, seed());
  await connect(page);
  await expect(page.locator('.note-card')).toHaveCount(25);
  await expect.poll(() => cachedCount(page)).toBe(100);
  const requests = () =>
    remote.requests.filter(
      (request) =>
        request.path.endsWith('/issues') && new URL(request.url).searchParams.get('per_page') === '100',
    );
  expect(requests()).toHaveLength(1);
  expect(new URL(requests()[0]!.url).searchParams.get('direction')).toBe('desc');
  await expect(page.locator('.note-card').first()).toContainText('Paged note 230');
  await page.locator('.main-content').evaluate((area) => {
    area.scrollTop = Math.max(1, area.scrollHeight - area.clientHeight * 3);
  });
  await expect.poll(() => cachedCount(page)).toBe(200);
  await expect(page.locator('.note-card')).toHaveCount(25);
  expect(requests()).toHaveLength(2);
  await page.locator('.main-content').evaluate((area) => {
    area.scrollTop = area.scrollHeight;
  });
  await expect(page.locator('.note-card')).toHaveCount(50);
  expect(requests()).toHaveLength(2);
  await context.setOffline(true);
  await page.locator('.load-more').click();
  await expect(page.locator('.note-card')).toHaveCount(75);
});

test('search submits on blur/Enter only, finds uncached notes and does not repeat the same query', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context, seed());
  await connect(page);
  const search = page.getByLabel('Search your notes', { exact: true });
  const searches = () => remote.requests.filter((request) => request.path === '/search/issues');
  await search.fill('Paged note 1');
  await page.waitForTimeout(300);
  expect(searches()).toHaveLength(0);
  await expect(page.locator('.note-card')).toHaveCount(25);
  await search.press('Enter');
  await expect(search).not.toBeFocused();
  await expect.poll(() => searches().length).toBe(1);
  // A narrow phrase whose only match is outside the first loaded page.
  await search.fill('Unique-1-end');
  await search.blur();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-card')).toContainText('Paged note 1');
  const count = searches().length;
  await search.focus();
  await search.press('Enter');
  await page.waitForTimeout(200);
  expect(searches()).toHaveLength(count);
  await page.locator('.search-clear-button').click();
  await expect(page.locator('.note-card')).toHaveCount(25);
});

test('search prefetch buffers the next page and slow responses keep existing cards with bottom skeletons', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context, seed());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://api.github.com/search/issues?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('page') === '2') await gate;
    await route.fallback();
  });
  await connect(page);
  const search = page.getByLabel('Search your notes', { exact: true });
  await search.fill('Paged');
  await search.press('Enter');
  await expect(page.locator('.note-card')).toHaveCount(25);
  // The manual affordance uses exactly the same 25-card buffer as scrolling.
  for (const count of [50, 75, 100]) {
    await page.locator('.load-more').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator('.note-card')).toHaveCount(count);
  }
  await page.locator('.main-content').evaluate((area) => {
    area.scrollTop = area.scrollHeight;
  });
  await expect(page.locator('.feed-skeletons')).toBeVisible();
  await expect(page.locator('.note-card')).toHaveCount(100);
  await page.screenshot({ path: '.artifacts/pagination-search-slow.png' });
  release();
  await expect
    .poll(() => remote.requests.filter((request) => request.path === '/search/issues').length)
    .toBe(2);
  await expect(page.locator('.note-card')).toHaveCount(125);
  await expect(page.locator('.feed-skeletons')).toHaveCount(0);
});

test('superseded search responses cannot replace the current results', async ({ page, context }) => {
  await mockGitHub(context, seed());
  let started = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://api.github.com/search/issues?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q')?.includes('"Old"')) {
      started = true;
      await gate;
    }
    await route.fallback();
  });
  await connect(page);
  const search = page.getByLabel('Search your notes', { exact: true });
  await search.fill('Old');
  await search.press('Enter');
  await expect.poll(() => started).toBe(true);
  await search.fill('Unique-1-end');
  await search.press('Enter');
  // The cancelled fetch must free the adapter queue without waiting for the old response.
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-card')).toContainText('Paged note 1');
  release();
  await expect(page.locator('.note-card')).toHaveCount(1);
});
