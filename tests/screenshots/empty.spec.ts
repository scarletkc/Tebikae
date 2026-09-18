import { expect, test } from './fixtures';

test('empty-notes', async ({ page, openApp, capture }) => {
  await openApp({ issues: [] });
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await capture();
});
