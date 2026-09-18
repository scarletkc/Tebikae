import { expect, test } from './fixtures';

test('welcome', async ({ openApp, capture }) => {
  await openApp({ connected: false });
  await capture();
});

test('notes', async ({ page, openApp, capture }) => {
  await openApp();
  await expect(page.locator('.note-card')).toHaveCount(3);
  await capture();
});

test('editor', async ({ openEditor, capture }) => {
  await openEditor();
  await capture();
});

test('card-menu', async ({ page, openApp, text, capture }) => {
  await openApp();
  await page.locator('.note-card').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: text('Pin note', '置顶笔记'), exact: true })).toBeVisible();
  await capture();
});

test('multi-select', async ({ page, openApp, text, capture }) => {
  await openApp();
  const cards = page.locator('.note-card');
  await cards.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: text('Select', '选择'), exact: true }).click();
  await cards.nth(1).locator('.note-open').click();
  await expect(page.locator('.note-card.is-selected')).toHaveCount(2);
  await expect(page.getByRole('toolbar')).toBeVisible();
  await capture();
});

test('blank-menu', async ({ page, openApp, text, capture }) => {
  await openApp();
  // 键盘打开主区域菜单，不依赖桌面与窄屏各自的空白坐标。
  await page.locator('.main-content').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: text('New note', '新建笔记'), exact: true })).toBeVisible();
  await capture();
});

test('editor-menu', async ({ page, openEditor, text, capture }) => {
  const editor = await openEditor();
  await editor.locator('p').first().selectText();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Hello world text');
  // 让 ProseMirror 消化原生 selectionchange 后再读取菜单状态。
  await editor.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: text('Format', '格式'), exact: true })).toBeVisible();
  await capture();
});

test('editor-table', async ({ page, openEditor, text, capture }) => {
  const editor = await openEditor();
  await editor.locator('td').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: text('Table', '表格'), exact: true }).hover();
  await expect(
    page.getByRole('menuitem', { name: text('Add row below', '在下方插入行'), exact: true }),
  ).toBeVisible();
  await capture();
});

test('label-menu', async ({ page, openApp, text, capture }) => {
  await openApp();
  const mobile = page.viewportSize()!.width < 760;
  if (mobile) await page.locator('.mobile-menu').click();
  const navigation = page.locator(mobile ? '.mobile-drawer' : '.sidebar');
  await navigation.locator('.label-nav-row').first().getByRole('button').first().click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: text('Rename label', '重命名标签'), exact: true }),
  ).toBeVisible();
  await capture();
});

test('settings-update', async ({ page, openApp, text, capture }) => {
  await openApp();
  const mobile = page.viewportSize()!.width < 760;
  if (mobile) await page.locator('.mobile-menu').click();
  await page
    .locator(mobile ? '.mobile-drawer' : '.sidebar')
    .getByRole('link', { name: text('Settings', '设置'), exact: true })
    .click();
  const update = page.getByRole('button', { name: text('Update Tebikae', '更新 Tebikae'), exact: true });
  await update.scrollIntoViewIfNeeded();
  await expect(update).toBeVisible();
  await capture();
});
