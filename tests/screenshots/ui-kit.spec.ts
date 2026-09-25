import { expect, test } from './fixtures';

// Development-only UI kit preview (src/ui/Gallery.tsx); needs no repository connection.
test('ui-kit', async ({ page, theme, capture }) => {
  await page.addInitScript((value) => localStorage.setItem('tebikae.theme', value), theme);
  await page.goto('/#/__ui');
  await expect(page.getByRole('heading', { name: 'Tebikae UI kit' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await capture('tokens');

  for (const section of ['Form controls', 'Menus', 'Card and setting rows']) {
    await page.getByRole('heading', { name: section }).scrollIntoViewIfNeeded();
    await capture(section.toLowerCase().replaceAll(' ', '-'));
  }

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await capture('menu-open');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Filter' })).toBeVisible();
  await capture('dialog-open');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Open confirm' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await capture('confirm-open');
});
