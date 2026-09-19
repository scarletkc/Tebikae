import { expect, test, type Page } from '@playwright/test';
import { closeDialog, mockIssue, mockGitHub, connect } from './fixtures';

const notes = Array.from({ length: 30 }, (_, i) =>
  mockIssue(100 + i, `合成笔记 ${i + 1}`, `第 ${i + 1} 条合成内容，用于检查列表滚动。`.repeat(3), {
    color: (['default', 'yellow', 'green', 'blue', 'purple', 'red'] as const)[i % 6],
    pinned: i === 3,
  }),
);

async function setPreferences(page: Page, language: string, theme: string) {
  await page.evaluate(
    ({ language, theme }) => {
      for (const [name, value] of Object.entries({ language, theme })) {
        const key = `tebikae.${name}`;
        localStorage.setItem(key, value);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
      }
    },
    { language, theme },
  );
}

for (const width of [320, 390, 768, 1100, 1280]) {
  for (const language of ['en', 'zh-CN']) {
    test(`sticky topbar stays reachable at ${width}px in ${language}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await mockGitHub(page.context(), notes);
      await connect(page);
      await setPreferences(page, language, language === 'en' ? 'light' : 'dark');
      const topbar = page.locator('.app-topbar');
      const newNote = topbar.getByRole('button', {
        name: language === 'en' ? 'New note' : '新建笔记',
        exact: true,
      });
      await expect(newNote).toBeVisible();
      await expect(page.locator('.note-card')).toHaveCount(30);
      const controls = topbar.locator('button:visible, input, select');
      const checkBounds = async () => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        for (const control of await controls.all()) {
          const box = (await control.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThan(250);
        }
      };
      await checkBounds();
      await page.screenshot({ path: testInfo.outputPath('top.png') });
      await page.locator('.main-content').hover();
      await page.mouse.wheel(0, 900);
      await expect
        .poll(() => page.locator('.main-content').evaluate((element) => element.scrollTop))
        .toBeGreaterThan(300);
      expect((await topbar.boundingBox())!.y).toBe(0);
      await checkBounds();
      await topbar.locator('.search-box input').fill('合成');
      await topbar.locator('.filter-open-button').click();
      await page.getByRole('dialog').locator('.color-choice.note-yellow input').check();
      await page.getByRole('dialog').locator('.dialog-header button').click();
      await expect(topbar.locator('.search-clear-button')).toBeVisible();
      await checkBounds();
      await topbar.locator('.search-clear-button').click();
      await expect(page.locator('.note-card')).toHaveCount(30);
      await page.screenshot({ path: testInfo.outputPath('scrolled.png') });
      await newNote.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await topbar.evaluate((element) => getComputedStyle(element).zIndex)).toBe('20');
    });
  }
}

test('trash card deletion supports cancel, offline protection, failure and retry', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context, [
    mockIssue(1, 'Trashed note', 'Remove me', { trashedAt: '2026-09-16T08:00:00Z' }),
  ]);
  await connect(page);
  await page.getByRole('link', { name: 'Trash', exact: true }).click();
  const card = page.locator('.note-card');
  const purge = card.getByRole('button', { name: /deleteForever|Delete forever/i });
  await expect(purge).toBeEnabled();
  await context.setOffline(true);
  await expect(purge).toBeDisabled();
  await context.setOffline(false);
  await expect(purge).toBeEnabled();
  await purge.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toHaveCount(1);
  expect(remote.writes.filter((write) => write.path === '/graphql')).toHaveLength(0);
  remote.failNextDeleteIssue = true;
  await purge.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete forever/i })
    .click();
  await expect.poll(() => remote.writes.filter((write) => write.path === '/graphql').length).toBe(1);
  await expect(purge).toBeEnabled();
  await expect(card).toHaveCount(1);
  await expect(page.locator('.workspace-status')).toHaveClass(/status-error/);
  await purge.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete forever/i })
    .click();
  await expect(card).toHaveCount(0);
  expect(remote.issues).toHaveLength(0);
  await page.reload();
  await expect(page.locator('.workspace-status')).toHaveAttribute('data-loading', 'false');
  await expect(card).toHaveCount(0);
});

for (const scenario of [
  { name: 'query only', query: 'Weekend', filters: {} },
  { name: 'labels only', query: '', filters: { labelIds: [11, 12] } },
  { name: 'unlabeled only', query: '', filters: { unlabeledOnly: true } },
  { name: 'color only', query: '', filters: { colors: ['yellow'] } },
  { name: 'kind only', query: '', filters: { kinds: ['markdown'] } },
  { name: 'pinned only', query: '', filters: { pinned: 'pinned' } },
  { name: 'unsynced only', query: '', filters: { unsyncedOnly: true } },
  ...['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'].map((key) => ({
    name: key,
    query: '',
    filters: { [key]: '2026-09-15' },
  })),
  {
    name: 'query and every filter',
    query: 'Weekend',
    filters: {
      labelIds: [11, 12],
      labelMatch: 'any',
      unlabeledOnly: true,
      colors: ['yellow'],
      kinds: ['markdown'],
      pinned: 'unpinned',
      unsyncedOnly: true,
      createdFrom: '2026-09-01',
      createdTo: '2026-09-30',
      updatedFrom: '2026-09-01',
      updatedTo: '2026-09-30',
    },
  },
]) {
  test(`search X clears ${scenario.name} while preserving sort and views`, async ({ page, context }) => {
    await mockGitHub(context);
    await connect(page);
    const topbar = page.locator('.app-topbar');
    await expect(topbar.locator('.search-clear-button')).toHaveCount(0);
    await topbar.locator('select').selectOption('title');
    await topbar.getByRole('button', { name: 'List view', exact: true }).click();
    await page.getByRole('link', { name: 'Archive', exact: true }).click();
    await page.evaluate((scenario) => {
      const key = Object.keys(sessionStorage).find((key) => key.startsWith('tebikae.filters.'))!;
      const filters = JSON.parse(sessionStorage.getItem(key)!);
      sessionStorage.setItem(
        key,
        JSON.stringify({ ...filters, ...scenario.filters, query: scenario.query, view: 'archive' }),
      );
    }, scenario);
    await page.reload();
    const clear = topbar.locator('.search-clear-button');
    await expect(clear).toBeVisible();
    await expect(clear).toHaveAccessibleName('Clear search and filters');
    await expect(topbar.locator('.filter-open-button')).toHaveText('');
    if (scenario.name !== 'query only')
      await expect(topbar.locator('.filter-open-button')).toHaveClass(/is-active/);
    await expect(page.locator('.filter-chips > button:not(.chip)')).toHaveCount(0);
    await clear.click();
    await expect(clear).toHaveCount(0);
    await expect(topbar.locator('.search-box input')).toHaveValue('');
    await expect(topbar.locator('.filter-open-button')).not.toHaveClass(/is-active/);
    await expect(page.locator('.filter-chips')).toHaveCount(0);
    await expect(topbar.locator('select')).toHaveValue('title');
    await expect(page).toHaveURL(/#\/archive$/);
    await expect(topbar.getByRole('button', { name: 'List view', exact: true })).toHaveClass(/selected/);
    await expect(page.locator('.notes-list .note-card')).toHaveCount(1);
    expect(
      await page.evaluate(() => {
        const key = Object.keys(sessionStorage).find((key) => key.startsWith('tebikae.filters.'))!;
        return JSON.parse(sessionStorage.getItem(key)!);
      }),
    ).toEqual({
      view: 'archive',
      query: '',
      labelIds: [],
      labelMatch: 'all',
      unlabeledOnly: false,
      colors: [],
      kinds: [],
      pinned: 'all',
      unsyncedOnly: false,
      sort: 'title',
    });
  });
}

test('topbar actions preserve filtering, sorting, views and route-specific controls', async ({ page }) => {
  const remote = await mockGitHub(page.context());
  await connect(page);
  const topbar = page.locator('.app-topbar');
  await expect(topbar.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
  await expect(page.locator('.main-content .filter-button')).toHaveCount(0);
  await expect(page.locator('.main-content .new-note-button')).toHaveCount(0);
  await topbar.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Personal', { exact: true }).check();
  await closeDialog(page);
  await expect(topbar.locator('.search-box .filter-open-button')).toHaveClass(/is-active/);
  await expect(topbar.locator('.filter-open-button')).toHaveText('');
  await expect(topbar.locator('.count-badge')).toHaveCount(0);
  await expect(page.locator('.filter-chips > button:not(.chip)')).toHaveCount(0);
  await expect(page.locator('.note-card')).toHaveCount(1);
  await topbar.locator('select').selectOption('title');
  await expect(topbar.locator('select')).toHaveValue('title');
  await topbar.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.locator('.notes-list')).toBeVisible();
  await topbar.getByRole('button', { name: 'Grid view', exact: true }).click();
  await expect(page.locator('.notes-list')).toHaveCount(0);
  await page.getByRole('link', { name: 'Trash', exact: true }).click();
  await expect(topbar.locator('.new-note-button')).toHaveCount(0);
  await expect(topbar.locator('.filter-open-button')).toBeVisible();
  await expect(topbar.locator('.filter-clear-button')).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(topbar.locator('.topbar-note-actions')).toHaveCount(0);
  expect(remote.writes).toHaveLength(0);
});
