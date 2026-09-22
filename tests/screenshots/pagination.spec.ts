import { expect, test } from './fixtures';
import { mockIssue } from '../e2e/fixtures';

const issues = Array.from({ length: 230 }, (_, i) =>
  mockIssue(i + 1, `Paged note ${i + 1}`, 'A cached thought. '.repeat(25)),
);

test('paginated-notes', async ({ page, openApp, capture }) => {
  await openApp({ issues });
  await expect(page.locator('.note-card')).toHaveCount(25);
  await capture();
});

test('search-waiting-with-cached-cards', async ({ page, context, openApp, capture, text }) => {
  await openApp({ issues });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://api.github.com/search/issues?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('page') === '2') await gate;
    await route.fallback();
  });
  try {
    const search = page.getByLabel(text('Search your notes', '搜索笔记'), { exact: true });
    await search.fill('Paged');
    await search.press('Enter');
    await expect(page.locator('.note-card')).toHaveCount(25);
    for (const count of [50, 75, 100]) {
      await page.locator('.load-more').evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.locator('.note-card')).toHaveCount(count);
    }
    await page.locator('.main-content').evaluate((area) => {
      area.scrollTop = area.scrollHeight;
    });
    await expect(page.locator('.feed-skeletons')).toBeVisible();
    await capture();
  } finally {
    release();
  }
});

test('repository-label-delete-confirm', async ({ page, openApp, capture, text }) => {
  await openApp();
  const mobile = page.viewportSize()!.width < 760;
  if (mobile) await page.locator('.mobile-menu').click();
  const sidebar = page.locator(mobile ? '.mobile-drawer' : '.sidebar');
  await sidebar.locator('.label-nav-row').first().getByRole('button').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: text('Delete', '删除'), exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('GitHub');
  await capture();
});

test('search-error-keeps-retry', async ({ page, context, openApp, capture, text }) => {
  await openApp();
  await context.route('https://api.github.com/search/issues?**', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'access-control-allow-origin': '*' },
      json: { message: 'Synthetic failure' },
    }),
  );
  const search = page.getByLabel(text('Search your notes', '搜索笔记'), { exact: true });
  await search.fill('Paged');
  await search.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.load-more')).toBeEnabled();
  await capture();
});
