import { expect, test } from '@playwright/test';
import { connect, mockGitHub } from './fixtures';

test('welcome language menu supports keyboard selection, dismissal and persistence', async ({ page }) => {
  await mockGitHub(page.context());
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Language, English', exact: true });
  await expect(trigger).toHaveText('English');
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const english = page.getByRole('menuitemradio', { name: 'English', exact: true });
  const chinese = page.getByRole('menuitemradio', { name: '简体中文', exact: true });
  await expect(english).toBeChecked();
  await expect(english).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(chinese).toBeFocused();
  await page.keyboard.press('Enter');
  const translatedTrigger = page.getByRole('button', { name: '界面语言, 简体中文', exact: true });
  await expect(translatedTrigger).toHaveText('简体中文');
  await expect(translatedTrigger).toBeFocused();
  await page.reload();
  await expect(translatedTrigger).toHaveText('简体中文');
  await translatedTrigger.press('Space');
  await expect(chinese).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(translatedTrigger).toBeFocused();
});

for (const mobile of [false, true]) {
  test(`sidebar icon controls share a row and remain functional (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }, testInfo) => {
    await mockGitHub(page.context());
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 844 });
    await connect(page);
    if (mobile) await page.locator('.mobile-menu').click();
    const sidebar = page.locator(mobile ? '.mobile-drawer' : '.sidebar');
    const row = sidebar.locator('.workspace-preferences');
    const settings = row.getByRole('link', { name: 'Settings', exact: true });
    await expect(settings).toHaveText('');
    const controls = row.locator('button, select, a');
    await expect(controls).toHaveCount(4);
    const boxes = await Promise.all((await controls.all()).map((control) => control.boundingBox()));
    for (const box of boxes) {
      expect(box).not.toBeNull();
      expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThanOrEqual(1);
    }
    await row.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitemradio', { name: '简体中文' }).click();
    await expect(row.getByRole('link', { name: '设置', exact: true })).toHaveText('');
    const language = row.getByRole('button', { name: '界面语言, 简体中文', exact: true });
    await expect(language).toHaveText('');
    await language.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: '简体中文' })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(language).toBeFocused();
    await row.getByRole('button').last().click();
    await row.getByRole('button').last().click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await language.click();
    await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sidebar-dark.png') });
    await page.keyboard.press('Escape');
    await row.getByRole('link', { name: '设置', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    if (mobile) await expect(page.locator('.mobile-drawer')).toHaveCount(0);
    else await expect(row.getByRole('link', { name: '设置', exact: true })).toHaveClass(/selected/);
  });
}
