import { expect, test } from './fixtures';
import { mockIssue, mockLabels } from '../e2e/fixtures';

test('welcome', async ({ openApp, capture }) => {
  await openApp({ connected: false });
  await capture();
});

test('connect-dialog', async ({ page, openApp, capture }) => {
  await openApp();
  const mobile = page.viewportSize()!.width < 760;
  if (mobile) await page.locator('.mobile-menu').click();
  await page
    .locator(mobile ? '.mobile-drawer' : '.sidebar')
    .locator('.repository-pill')
    .click();
  await expect(page.locator('.connect-dialog')).toBeVisible();
  await capture();
});

test('notes', async ({ page, openApp, capture }) => {
  await openApp();
  await expect(page.locator('.note-card')).toHaveCount(3);
  await capture();
});

test('search-active', async ({ page, openApp, capture }) => {
  await openApp();
  await page.locator('.search-box input').fill('plan');
  await expect(page.locator('.search-clear-button')).toBeVisible();
  await capture();
});

test('editor', async ({ openEditor, capture }) => {
  await openEditor();
  await capture();
});

test('editor-source', async ({ page, openEditor, text, capture }) => {
  await openEditor();
  await page.locator('.editor-mode-toggle').click();
  const source = page.locator('.editor-source');
  await source.fill(
    text(
      'Source mode keeps Markdown readable.\n\n- [ ] Read a chapter\n\n```ts\nconst x = 1;\n```',
      '源码模式里的 Markdown 也要好读。\n\n- [ ] 读一章书\n\n```ts\nconst x = 1;\n```',
    ),
  );
  await source.blur();
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

test('editor-tools', async ({ page, openEditor, text, capture }) => {
  const editor = await openEditor();
  await editor.locator('p').first().click();
  await page.getByRole('button', { name: text('Text style', '文字样式'), exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: text('Heading 2', '2 级标题'), exact: true }),
  ).toBeVisible();
  await capture('editor-text-style');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: text('More formatting options', '更多格式选项'), exact: true })
    .click();
  await page.locator('.editor-table-actions').click();
  await expect(
    page.getByRole('menuitem', { name: text('Delete table', '删除表格'), exact: true }),
  ).toBeVisible();
  await capture('editor-more-tools');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: text('Insert or edit link', '插入或修改链接'), exact: true })
    .click();
  await page.getByLabel(text('Link address', '链接地址'), { exact: true }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: text('Apply link', '应用链接'), exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture('editor-link-form');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: text('More actions', '更多操作'), exact: true })
    .click();
  await expect(page.locator('.note-actions-menu')).toBeVisible();
  await capture('note-actions-menu');
});

test('filters-and-status', async ({ page, openApp, text, capture }) => {
  await openApp();
  await page.locator('.filter-open-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture('filters-dialog');
  // A Select is named by its label and current value.
  await page.getByRole('button', { name: text('Pinned, Any', '置顶, 全部'), exact: true }).click();
  await expect(page.getByRole('menuitemradio').first()).toBeVisible();
  await capture('filters-select-open');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').locator('.dialog-header button').click();
  await page.locator('.workspace-status').click();
  await expect(page.locator('.workspace-status-menu')).toBeVisible();
  await capture('status-panel');
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
  await expect(page.getByRole('menuitem', { name: text('Rename', '重命名'), exact: true })).toBeVisible();
  await capture();
});

test('issues', async ({ page, openApp, text, capture }) => {
  const plain = (number: number, title: string, body: string) => ({ ...mockIssue(number, title), body });
  await openApp({
    issues: [
      mockIssue(1, 'Weekend ideas', 'Visit the bookshop.', { color: 'yellow' }),
      plain(
        4,
        text('Login button does nothing on phones', '手机上登录按钮没有反应'),
        text('Open the page on a phone and tap Log in.', '在手机上打开页面，点击登录。'),
      ),
      plain(
        5,
        text('Add a dark theme', '增加深色主题'),
        text('Follow the system setting by default.', '默认跟随系统设置。'),
      ),
    ],
  });
  await page.goto('/#/issues');
  await expect(page.locator('.note-card')).toHaveCount(2);
  await capture();
});

test('settings', async ({ page, openApp, text, capture }) => {
  await openApp();
  await page.goto('/#/settings');
  await expect(page.locator('.settings-page')).toBeVisible();
  // Settings has no note search: the topbar shows the page title.
  await expect(
    page.locator('.app-topbar').getByRole('heading', { name: text('Settings', '设置') }),
  ).toBeVisible();
  await expect(page.locator('.search-box')).toHaveCount(0);
  await capture('settings-top');
  await page.locator('#language-setting').click();
  await expect(page.getByRole('menuitemradio', { name: 'English', exact: true })).toBeVisible();
  await capture('settings-language-open');
  await page.keyboard.press('Escape');
  await page.locator('#theme-setting').click();
  await expect(page.getByRole('menuitemradio', { name: text('Follow system', '跟随系统') })).toBeVisible();
  await capture('settings-theme-open');
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
