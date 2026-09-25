import { expect, test } from './fixtures';
import { mockIssue, mockLabels } from '../e2e/fixtures';

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

test('editor-document', async ({ page, openApp, text, capture }) => {
  const title = text('A little room to think', '留一点空间，慢慢想');
  const body = text(
    'Small observations, unfinished ideas, and things worth coming back to.\n\n## A slower morning\n\nMake some tea. Open a window. Give the first thought of the day a little room.\n\n> There is no hurry to turn every thought into a plan.\n\n### Keep it simple\n\n- [x] Put the phone away\n- [ ] Read a few pages\n- [ ] Take the long way home\n\n```typescript\nconst today = { pace: "slow", curiosity: true };\n```\n\n| Keep | Let go |\n| --- | --- |\n| Good questions | Perfect answers |',
    '记下细小的发现、还没成形的想法，以及值得再次翻阅的片段。\n\n## 一个从容的早晨\n\n泡一杯茶，推开窗，让今天的第一个念头慢慢展开。\n\n> 不必急着把每一个想法都变成计划。\n\n### 从简单的事开始\n\n- [x] 暂时放下手机\n- [ ] 读几页喜欢的书\n- [ ] 绕一点远路回家\n\n```typescript\nconst today = { pace: "slow", curiosity: true };\n```\n\n| 留下 | 放下 |\n| --- | --- |\n| 好问题 | 完美答案 |',
  );
  await openApp({ issues: [mockIssue(81, title, body, { color: 'yellow' }, { labels: mockLabels })] });
  await page
    .getByRole('button', { name: text(`Edit note: ${title}`, `编辑笔记: ${title}`), exact: true })
    .click();
  await expect(page.locator('.editor-mode-toggle')).toBeEnabled();
  await expect(page.locator('.ProseMirror h2')).toBeVisible();
  await capture();
  await page.locator('.ProseMirror > p').first().selectText();
  await expect(page.locator('.editor-selection-toolbar')).toBeVisible();
  await capture('editor-selection');
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
  await expect(page.getByRole('menuitem', { name: text('Add row', '插入行'), exact: true })).toBeVisible();
  await capture();
});

test('label-menu', async ({ page, openApp, text, capture }) => {
  await openApp();
  const mobile = page.viewportSize()!.width < 760;
  if (mobile) await page.locator('.mobile-menu').click();
  const navigation = page.locator(mobile ? '.mobile-drawer' : '.sidebar');
  await navigation.locator('.label-nav-row').first().getByRole('button').first().click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: text('Rename', '重命名'), exact: true }),
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
