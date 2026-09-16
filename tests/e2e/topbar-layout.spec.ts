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
      await page.mouse.wheel(0, 900);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
      expect((await topbar.boundingBox())!.y).toBe(0);
      await checkBounds();
      await page.screenshot({ path: testInfo.outputPath('scrolled.png') });
      await newNote.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await topbar.evaluate((element) => getComputedStyle(element).zIndex)).toBe('20');
    });
  }
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
  await expect(topbar.locator('.count-badge')).toHaveText('1');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await topbar.locator('select').selectOption('title');
  await expect(topbar.locator('select')).toHaveValue('title');
  await topbar.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.locator('.notes-list')).toBeVisible();
  await topbar.getByRole('button', { name: 'Grid view', exact: true }).click();
  await expect(page.locator('.notes-list')).toHaveCount(0);
  await page.getByRole('link', { name: 'Trash', exact: true }).click();
  await expect(topbar.locator('.new-note-button')).toHaveCount(0);
  await expect(topbar.locator('.filter-button')).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(topbar.locator('.topbar-note-actions')).toHaveCount(0);
  expect(remote.writes).toHaveLength(0);
});
