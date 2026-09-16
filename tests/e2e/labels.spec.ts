import { expect, test } from '@playwright/test';
import { closeDialog, connect, mockGitHub } from './fixtures';

test('creating a label preserves the selected color through GitHub and Dexie', async ({ page, context }) => {
  const state = await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'New label', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input:not([type="color"])').fill('Colored label');
  await dialog.locator('input[type="color"]').fill('#e12345');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    state.writes.find((write) => write.path.endsWith('/labels') && write.method === 'POST')?.body,
  ).toMatchObject({ name: 'Colored label', color: 'e12345' });
  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tebikae');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ name: string; color: string } | undefined>((resolve, reject) => {
        const request = database.transaction('labels').objectStore('labels').getAll();
        request.onsuccess = () =>
          resolve(
            (request.result as { name: string; color: string }[]).find(
              (label) => label.name === 'Colored label',
            ),
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
  expect(stored?.color).toBe('e12345');
});

for (const theme of ['light', 'dark'] as const) {
  test(`label options, filter chips and note selection show colors in ${theme} theme`, async ({
    page,
    context,
  }) => {
    await mockGitHub(context);
    await connect(page);
    await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), theme);
    await page.locator('.filter-button').click();
    const dialog = page.getByRole('dialog');
    const badge = dialog.locator('.label-badge').filter({ hasText: 'Ideas' });
    await expect(badge.locator('.label-dot')).toHaveCSS('background-color', 'rgb(177, 198, 176)');
    const textColor = await page.evaluate(() => getComputedStyle(document.documentElement).color);
    await expect(badge).toHaveCSS('color', textColor);
    await expect(badge).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await dialog.getByRole('checkbox', { name: 'Ideas', exact: true }).check();
    await closeDialog(page);
    const chip = page.locator('.filter-chips .chip-label');
    await expect(chip).toContainText('Ideas');
    await expect(chip.locator('.label-dot')).toHaveCSS('background-color', 'rgb(177, 198, 176)');
    await expect(chip).toHaveCSS('color', textColor);
    await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
    const noteBadge = page.locator('.note-properties .label-badge').filter({ hasText: 'Ideas' });
    await expect(noteBadge.locator('.label-dot')).toHaveCSS('background-color', 'rgb(177, 198, 176)');
    await expect(noteBadge).toHaveCSS('color', textColor);
    await expect(
      page.getByRole('dialog').getByRole('checkbox', { name: 'Ideas', exact: true }),
    ).toBeChecked();
    await closeDialog(page);
    await chip.click();
    await expect(page.locator('.filter-chips .chip-label')).toHaveCount(0);
  });
}
